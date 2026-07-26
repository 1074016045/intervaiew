import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";
import {
  MAX_DATABASE_BYTES,
  MAX_MANIFEST_BYTES,
  parseBackupManifestJson,
  type BackupManifest,
} from "./backup-manifest";
import { maintenanceError } from "./maintenance-error";

export type SqliteBackupMetadata = Readonly<{
  sqliteUserVersion: number;
  migrationCount: number;
  latestMigrationHash: string | null;
}>;

export type ValidatedBackup = Readonly<{
  manifest: BackupManifest;
  manifestPath: string;
  databasePath: string;
  metadata: SqliteBackupMetadata;
}>;

type BackupFileKind = "manifest" | "database";
type FileIdentity = Readonly<{ dev: number; ino: number }>;

function sameIdentity(first: FileIdentity, second: FileIdentity): boolean {
  return first.dev === second.dev && first.ino === second.ino;
}

async function assertRegularNonSymlink(path: string, kind: BackupFileKind) {
  let stats;
  try {
    stats = await lstat(path);
  } catch (cause) {
    throw maintenanceError(
      kind === "manifest"
        ? "BACKUP_MANIFEST_MISSING"
        : "BACKUP_DATABASE_MISSING",
      `Backup ${kind} file is missing.`,
      cause,
    );
  }
  if (stats.isSymbolicLink())
    throw maintenanceError(
      kind === "manifest"
        ? "BACKUP_MANIFEST_SYMLINK"
        : "BACKUP_DATABASE_SYMLINK",
      `Backup ${kind} symlinks are not allowed.`,
    );
  if (!stats.isFile())
    throw maintenanceError(
      kind === "manifest"
        ? "BACKUP_MANIFEST_NOT_FILE"
        : "BACKUP_DATABASE_NOT_FILE",
      `Backup ${kind} must be a regular file.`,
    );
  return stats;
}

async function openRegularNonSymlink(
  path: string,
  kind: BackupFileKind,
): Promise<{ handle: FileHandle; identity: FileIdentity; size: number }> {
  const before = await assertRegularNonSymlink(path, kind);
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat();
    if (!opened.isFile() || !sameIdentity(before, opened))
      throw maintenanceError(
        kind === "manifest"
          ? "BACKUP_MANIFEST_CHANGED"
          : "BACKUP_DATABASE_CHANGED",
        `Backup ${kind} changed while it was being inspected.`,
      );
    return { handle, identity: opened, size: opened.size };
  } catch (cause) {
    await handle?.close().catch(() => undefined);
    if (cause instanceof Error && cause.name === "DatabaseMaintenanceError")
      throw cause;
    throw maintenanceError(
      kind === "manifest"
        ? "BACKUP_MANIFEST_READ_FAILED"
        : "BACKUP_DATABASE_READ_FAILED",
      `Backup ${kind} could not be read safely.`,
      cause,
    );
  }
}

async function assertPathIdentity(
  path: string,
  kind: BackupFileKind,
  expected: FileIdentity,
): Promise<void> {
  const current = await assertRegularNonSymlink(path, kind);
  if (!sameIdentity(current, expected))
    throw maintenanceError(
      kind === "manifest"
        ? "BACKUP_MANIFEST_CHANGED"
        : "BACKUP_DATABASE_CHANGED",
      `Backup ${kind} changed while it was being inspected.`,
    );
}

async function assertStandaloneSidecarsAbsent(path: string): Promise<void> {
  for (const sidecar of [`${path}-wal`, `${path}-shm`]) {
    try {
      await lstat(sidecar);
      throw maintenanceError(
        "BACKUP_DATABASE_SIDECAR_PRESENT",
        "Standalone backup databases must not have SQLite sidecars.",
      );
    } catch (cause) {
      if (cause instanceof Error && cause.name === "DatabaseMaintenanceError")
        throw cause;
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT")
        throw maintenanceError(
          "BACKUP_DATABASE_SIDECAR_INSPECTION_FAILED",
          "Backup database sidecars could not be inspected safely.",
          cause,
        );
    }
  }
}

async function readDatabaseHeader(
  path: string,
  expected: FileIdentity,
): Promise<Buffer> {
  const { handle, identity } = await openRegularNonSymlink(path, "database");
  try {
    if (!sameIdentity(identity, expected))
      throw maintenanceError(
        "BACKUP_DATABASE_CHANGED",
        "Backup database changed while it was being inspected.",
      );
    const header = Buffer.alloc(100);
    const result = await handle.read(header, 0, header.length, 0);
    return header.subarray(0, result.bytesRead);
  } finally {
    await handle.close().catch(() => undefined);
  }
}

export async function sha256File(
  path: string,
  maximumBytes = MAX_DATABASE_BYTES,
): Promise<string> {
  const { handle, identity } = await openRegularNonSymlink(path, "database");
  const hash = createHash("sha256");
  let bytesRead = 0;
  try {
    const stream = handle.createReadStream({ autoClose: false, start: 0 });
    for await (const chunk of stream) {
      bytesRead += chunk.length;
      if (bytesRead > maximumBytes)
        throw maintenanceError(
          "BACKUP_DATABASE_SIZE_INVALID",
          "Backup database size is outside the allowed range.",
        );
      hash.update(chunk);
    }
    await assertPathIdentity(path, "database", identity);
    return hash.digest("hex");
  } catch (cause) {
    if (cause instanceof Error && cause.name === "DatabaseMaintenanceError")
      throw cause;
    throw maintenanceError(
      "BACKUP_DATABASE_READ_FAILED",
      "Backup database could not be read.",
      cause,
    );
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function readSafeInteger(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw maintenanceError(code, "Backup database metadata is invalid.");
  return value;
}

const requiredApplicationSchema = {
  interview_sessions: ["id", "resume_text", "job_description", "status"],
  interview_questions: ["id", "session_id", "question"],
  transcript_items: ["id", "session_id", "text"],
  interview_actions: ["id", "session_id", "action_id"],
} as const;

function validateApplicationSchema(connection: Database.Database): void {
  for (const [table, requiredColumns] of Object.entries(
    requiredApplicationSchema,
  )) {
    const found = connection
      .prepare(
        "select name from sqlite_master where type = 'table' and name = ?",
      )
      .get(table) as { name: string } | undefined;
    const columns = found
      ? new Set(
          (
            connection.pragma(`table_info(${table})`) as Array<{
              name: string;
            }>
          ).map((column) => column.name),
        )
      : new Set<string>();
    if (!found || !requiredColumns.every((column) => columns.has(column)))
      throw maintenanceError(
        "BACKUP_DATABASE_APPLICATION_SCHEMA_MISSING",
        "Backup database application schema is missing.",
      );
  }
}

export async function validateSqliteDatabase(
  path: string,
  maximumBytes = MAX_DATABASE_BYTES,
): Promise<SqliteBackupMetadata> {
  const stats = await assertRegularNonSymlink(path, "database");
  if (stats.size <= 0 || stats.size > maximumBytes)
    throw maintenanceError(
      "BACKUP_DATABASE_SIZE_INVALID",
      "Backup database size is outside the allowed range.",
    );
  await assertStandaloneSidecarsAbsent(path);
  const header = await readDatabaseHeader(path, stats);
  if (
    header.length < 100 ||
    header.subarray(0, 16).toString("binary") !== "SQLite format 3\0" ||
    header[18] !== 1 ||
    header[19] !== 1
  )
    throw maintenanceError(
      "BACKUP_DATABASE_INVALID",
      "Backup database is not a valid IntervAIew SQLite database for standalone backup.",
    );

  let connection: Database.Database | undefined;
  try {
    connection = new Database(path, {
      readonly: true,
      fileMustExist: true,
      timeout: 5_000,
    });
    const quickCheck = connection.pragma("quick_check") as Array<
      Record<string, unknown>
    >;
    if (
      quickCheck.length !== 1 ||
      Object.values(quickCheck[0] ?? {}).length !== 1 ||
      Object.values(quickCheck[0] ?? {})[0] !== "ok"
    )
      throw maintenanceError(
        "BACKUP_DATABASE_INTEGRITY_FAILED",
        "Backup database integrity validation failed.",
      );

    const foreignKeyRows = connection.pragma("foreign_key_check") as unknown[];
    if (foreignKeyRows.length !== 0)
      throw maintenanceError(
        "BACKUP_DATABASE_FOREIGN_KEY_FAILED",
        "Backup database foreign-key validation failed.",
      );

    const migrationTable = connection
      .prepare(
        "select name from sqlite_master where type = 'table' and name = '__drizzle_migrations'",
      )
      .get() as { name: string } | undefined;
    if (!migrationTable)
      throw maintenanceError(
        "BACKUP_DATABASE_MIGRATIONS_MISSING",
        "Backup database migration metadata is missing.",
      );
    const migrationColumns = new Set(
      (
        connection.pragma("table_info(__drizzle_migrations)") as Array<{
          name: string;
        }>
      ).map((column) => column.name),
    );
    if (!["hash", "created_at"].every((name) => migrationColumns.has(name)))
      throw maintenanceError(
        "BACKUP_DATABASE_MIGRATIONS_INVALID",
        "Backup database migration metadata is invalid.",
      );

    validateApplicationSchema(connection);

    const migrationRows = connection
      .prepare(
        "select rowid, hash, created_at as createdAt from __drizzle_migrations order by created_at desc, rowid desc",
      )
      .all() as Array<{
      rowid: unknown;
      hash: unknown;
      createdAt: unknown;
    }>;
    const migrationCount = readSafeInteger(
      migrationRows.length,
      "BACKUP_DATABASE_MIGRATION_COUNT_INVALID",
    );
    if (migrationCount === 0)
      throw maintenanceError(
        "BACKUP_DATABASE_MIGRATIONS_EMPTY",
        "Backup database has no application migrations.",
      );
    for (const row of migrationRows) {
      readSafeInteger(row.rowid, "BACKUP_DATABASE_MIGRATION_ROW_INVALID");
      readSafeInteger(
        row.createdAt,
        "BACKUP_DATABASE_MIGRATION_TIMESTAMP_INVALID",
      );
      if (typeof row.hash !== "string" || !/^[a-f0-9]{64}$/.test(row.hash))
        throw maintenanceError(
          "BACKUP_DATABASE_MIGRATION_HASH_INVALID",
          "Backup database migration metadata is invalid.",
        );
    }

    const userVersion = readSafeInteger(
      connection.pragma("user_version", { simple: true }),
      "BACKUP_DATABASE_USER_VERSION_INVALID",
    );
    return {
      sqliteUserVersion: userVersion,
      migrationCount,
      latestMigrationHash: migrationRows[0]!.hash as string,
    };
  } catch (cause) {
    if (cause instanceof Error && cause.name === "DatabaseMaintenanceError")
      throw cause;
    throw maintenanceError(
      "BACKUP_DATABASE_INVALID",
      "Backup database is not a valid IntervAIew SQLite database.",
      cause,
    );
  } finally {
    try {
      connection?.close();
    } catch {
      // Identity and sidecar checks below remain mandatory.
    }
    await assertPathIdentity(path, "database", stats);
    await assertStandaloneSidecarsAbsent(path);
  }
}

async function canonicalDirectory(path: string): Promise<string> {
  try {
    const canonical = await realpath(path);
    const stats = await lstat(canonical);
    if (!stats.isDirectory()) throw new Error("not-directory");
    return canonical;
  } catch (cause) {
    throw maintenanceError(
      "BACKUP_DIRECTORY_INVALID",
      "Backup directory is unavailable.",
      cause,
    );
  }
}

export async function validateBackupPair(
  manifestInputPath: string,
): Promise<ValidatedBackup> {
  const resolvedManifestPath = resolve(manifestInputPath);
  const directory = await canonicalDirectory(dirname(resolvedManifestPath));
  const manifestPath = join(directory, basename(resolvedManifestPath));
  const openedManifest = await openRegularNonSymlink(manifestPath, "manifest");
  let manifestText: string;
  try {
    if (openedManifest.size <= 0 || openedManifest.size > MAX_MANIFEST_BYTES)
      throw maintenanceError(
        "BACKUP_MANIFEST_SIZE_INVALID",
        "Backup manifest size is outside the allowed range.",
      );
    const buffer = Buffer.alloc(MAX_MANIFEST_BYTES + 1);
    let total = 0;
    while (total < buffer.length) {
      const result = await openedManifest.handle.read(
        buffer,
        total,
        buffer.length - total,
        total,
      );
      if (result.bytesRead === 0) break;
      total += result.bytesRead;
    }
    if (total > MAX_MANIFEST_BYTES)
      throw maintenanceError(
        "BACKUP_MANIFEST_SIZE_INVALID",
        "Backup manifest size is outside the allowed range.",
      );
    const afterRead = await openedManifest.handle.stat();
    if (afterRead.size !== total)
      throw maintenanceError(
        "BACKUP_MANIFEST_CHANGED",
        "Backup manifest changed while it was being inspected.",
      );
    manifestText = buffer.subarray(0, total).toString("utf8");
    await assertPathIdentity(manifestPath, "manifest", openedManifest.identity);
  } finally {
    await openedManifest.handle.close().catch(() => undefined);
  }

  const manifest = parseBackupManifestJson(manifestText);
  const databasePath = join(directory, manifest.databaseFile);
  if (dirname(databasePath) !== directory)
    throw maintenanceError(
      "BACKUP_DATABASE_PATH_UNSAFE",
      "Backup database filename is unsafe.",
    );
  const databaseStats = await assertRegularNonSymlink(databasePath, "database");
  if (databaseStats.size !== manifest.databaseBytes)
    throw maintenanceError(
      "BACKUP_DATABASE_SIZE_MISMATCH",
      "Backup database size does not match its manifest.",
    );
  const hashBeforeValidation = await sha256File(databasePath);
  if (hashBeforeValidation !== manifest.databaseSha256)
    throw maintenanceError(
      "BACKUP_DATABASE_HASH_MISMATCH",
      "Backup database hash does not match its manifest.",
    );
  const metadata = await validateSqliteDatabase(databasePath);
  const hashAfterValidation = await sha256File(databasePath);
  if (hashAfterValidation !== manifest.databaseSha256)
    throw maintenanceError(
      "BACKUP_DATABASE_CHANGED",
      "Backup database changed while it was being validated.",
    );
  if (
    metadata.sqliteUserVersion !== manifest.sqliteUserVersion ||
    metadata.migrationCount !== manifest.migrationCount ||
    metadata.latestMigrationHash !== manifest.latestMigrationHash
  )
    throw maintenanceError(
      "BACKUP_DATABASE_METADATA_MISMATCH",
      "Backup database metadata does not match its manifest.",
    );
  return { manifest, manifestPath, databasePath, metadata };
}
