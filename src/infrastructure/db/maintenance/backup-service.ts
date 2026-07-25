import { randomBytes, randomUUID } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  realpath,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";
import {
  assertSafeBackupName,
  BACKUP_APPLICATION,
  BACKUP_FORMAT_VERSION,
  serializeBackupManifest,
  type BackupManifest,
} from "./backup-manifest";
import {
  sha256File,
  validateSqliteDatabase,
  type SqliteBackupMetadata,
} from "./backup-validation";
import { maintenanceError } from "./maintenance-error";

export type CreateBackupOptions = Readonly<{
  databasePath: string;
  outputDirectory: string;
  name?: string;
  now?: Date;
}>;

export type CreatedBackup = Readonly<{
  name: string;
  databasePath: string;
  manifestPath: string;
  manifest: BackupManifest;
}>;

export type BackupDependencies = Readonly<{
  link: typeof link;
  open: typeof open;
  unlink: typeof unlink;
  writeFile: typeof writeFile;
  afterLockAcquired?: () => void | Promise<void>;
  afterDatabasePublication?: () => void | Promise<void>;
}>;

const defaultDependencies: BackupDependencies = {
  link,
  open,
  unlink,
  writeFile,
};

type FileIdentity = Readonly<{ dev: number; ino: number }>;

function sameIdentity(first: FileIdentity, second: FileIdentity): boolean {
  return first.dev === second.dev && first.ino === second.ino;
}

export function generateBackupName(now = new Date()): string {
  const timestamp = now.toISOString().replace(/[-:]/g, "").replace(".", "-");
  return `intervaiew-${timestamp}-${randomBytes(8).toString("hex")}`;
}

async function ensureSafeDirectory(path: string): Promise<string> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const canonical = await realpath(path);
  const stats = await lstat(canonical);
  if (stats.isSymbolicLink() || !stats.isDirectory())
    throw maintenanceError(
      "BACKUP_OUTPUT_DIRECTORY_INVALID",
      "Backup output directory is unsafe.",
    );
  await chmod(canonical, 0o700).catch(() => undefined);
  return canonical;
}

async function canonicalSourcePath(path: string): Promise<string> {
  const resolved = resolve(path);
  let canonicalDirectory: string;
  try {
    canonicalDirectory = await realpath(dirname(resolved));
  } catch (cause) {
    throw maintenanceError(
      "BACKUP_SOURCE_MISSING",
      "Source database does not exist.",
      cause,
    );
  }
  return join(canonicalDirectory, basename(resolved));
}

async function assertSource(path: string) {
  let stats;
  try {
    stats = await lstat(path);
  } catch (cause) {
    throw maintenanceError(
      "BACKUP_SOURCE_MISSING",
      "Source database does not exist.",
      cause,
    );
  }
  if (stats.isSymbolicLink() || !stats.isFile())
    throw maintenanceError(
      "BACKUP_SOURCE_INVALID",
      "Source database must be a regular non-symlink file.",
    );
  return stats;
}

async function unlinkOwned(
  path: string,
  identity: FileIdentity | undefined,
  unlinkFile: typeof unlink,
): Promise<boolean> {
  if (!identity) return false;
  try {
    const current = await lstat(path);
    if (!sameIdentity(current, identity)) return false;
    await unlinkFile(path);
    return true;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return true;
    return false;
  }
}

async function normalizeOwnedSnapshot(path: string): Promise<void> {
  let connection: Database.Database | undefined;
  try {
    connection = new Database(path, { fileMustExist: true, timeout: 5_000 });
    const mode = connection.pragma("journal_mode = DELETE", {
      simple: true,
    });
    if (mode !== "delete")
      throw maintenanceError(
        "BACKUP_SNAPSHOT_NORMALIZATION_FAILED",
        "Backup snapshot could not be prepared for safe validation.",
      );
  } catch (cause) {
    if (cause instanceof Error && cause.name === "DatabaseMaintenanceError")
      throw cause;
    throw maintenanceError(
      "BACKUP_SNAPSHOT_NORMALIZATION_FAILED",
      "Backup snapshot could not be prepared for safe validation.",
      cause,
    );
  } finally {
    try {
      connection?.close();
    } catch {
      // Cleanup below must still run if SQLite reports a close failure.
    }
  }
}

export async function createDatabaseBackup(
  options: CreateBackupOptions,
  dependencyOverrides: Partial<BackupDependencies> = {},
): Promise<CreatedBackup> {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  const sourcePath = await canonicalSourcePath(options.databasePath);
  const name = options.name ?? generateBackupName(options.now);
  assertSafeBackupName(name);
  const sourceIdentity = await assertSource(sourcePath);
  const outputDirectory = await ensureSafeDirectory(
    resolve(options.outputDirectory),
  );

  const databasePath = join(outputDirectory, `${name}.sqlite`);
  const manifestPath = join(outputDirectory, `${name}.manifest.json`);
  const suffix = randomUUID();
  const temporaryDatabasePath = join(
    outputDirectory,
    `.${name}.${suffix}.sqlite.tmp`,
  );
  const temporaryManifestPath = join(
    outputDirectory,
    `.${name}.${suffix}.manifest.tmp`,
  );
  const lockPath = join(outputDirectory, `.${name}.backup.lock`);
  let lockHandle: Awaited<ReturnType<typeof open>> | undefined;
  let connection: Database.Database | undefined;
  let lockIdentity: FileIdentity | undefined;
  let temporaryDatabaseIdentity: FileIdentity | undefined;
  let temporaryManifestIdentity: FileIdentity | undefined;
  let databasePublishedIdentity: FileIdentity | undefined;
  let manifestPublishedIdentity: FileIdentity | undefined;
  let completed = false;

  try {
    try {
      lockHandle = await dependencies.open(lockPath, "wx", 0o600);
      lockIdentity = await lockHandle.stat();
    } catch (cause) {
      throw maintenanceError(
        "BACKUP_NAME_IN_USE",
        "A backup with this name is already being created.",
        cause,
      );
    }
    await dependencies.afterLockAcquired?.();
    for (const finalPath of [databasePath, manifestPath]) {
      try {
        await lstat(finalPath);
        throw maintenanceError(
          "BACKUP_ARTIFACT_EXISTS",
          "Backup artifact already exists.",
        );
      } catch (cause) {
        if (cause instanceof Error && cause.name === "DatabaseMaintenanceError")
          throw cause;
        if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
      }
    }

    const temporaryHandle = await dependencies.open(
      temporaryDatabasePath,
      "wx",
      0o600,
    );
    temporaryDatabaseIdentity = await temporaryHandle.stat();
    await temporaryHandle.close();

    connection = new Database(sourcePath, {
      readonly: true,
      fileMustExist: true,
      timeout: 5_000,
    });
    await connection.backup(temporaryDatabasePath);
    connection.close();
    connection = undefined;
    const sourceAfterSnapshot = await assertSource(sourcePath);
    if (!sameIdentity(sourceIdentity, sourceAfterSnapshot))
      throw maintenanceError(
        "BACKUP_SOURCE_CHANGED",
        "Source database changed identity during backup.",
      );
    temporaryDatabaseIdentity = await lstat(temporaryDatabasePath);
    await chmod(temporaryDatabasePath, 0o600).catch(() => undefined);
    await normalizeOwnedSnapshot(temporaryDatabasePath);

    const metadata: SqliteBackupMetadata = await validateSqliteDatabase(
      temporaryDatabasePath,
    );
    const stats = await lstat(temporaryDatabasePath);
    const databaseSha256 = await sha256File(temporaryDatabasePath);
    const manifest: BackupManifest = {
      formatVersion: BACKUP_FORMAT_VERSION,
      application: BACKUP_APPLICATION,
      createdAt: (options.now ?? new Date()).toISOString(),
      databaseFile: `${name}.sqlite`,
      databaseBytes: stats.size,
      databaseSha256,
      sqliteUserVersion: metadata.sqliteUserVersion,
      migrationCount: metadata.migrationCount,
      latestMigrationHash: metadata.latestMigrationHash,
    };
    const manifestJson = serializeBackupManifest(manifest);
    await dependencies.writeFile(temporaryManifestPath, manifestJson, {
      flag: "wx",
      mode: 0o600,
    });
    temporaryManifestIdentity = await lstat(temporaryManifestPath);

    await dependencies.link(temporaryDatabasePath, databasePath);
    databasePublishedIdentity = temporaryDatabaseIdentity;
    if (
      !(await unlinkOwned(
        temporaryDatabasePath,
        temporaryDatabaseIdentity,
        dependencies.unlink,
      ))
    )
      throw maintenanceError(
        "BACKUP_TEMPORARY_CLEANUP_FAILED",
        "Backup temporary-file cleanup failed safely.",
      );
    temporaryDatabaseIdentity = undefined;
    await dependencies.afterDatabasePublication?.();
    await dependencies.link(temporaryManifestPath, manifestPath);
    manifestPublishedIdentity = temporaryManifestIdentity;
    if (
      !(await unlinkOwned(
        temporaryManifestPath,
        temporaryManifestIdentity,
        dependencies.unlink,
      ))
    )
      throw maintenanceError(
        "BACKUP_TEMPORARY_CLEANUP_FAILED",
        "Backup temporary-file cleanup failed safely.",
      );
    temporaryManifestIdentity = undefined;
    await lockHandle.close();
    lockHandle = undefined;
    if (!(await unlinkOwned(lockPath, lockIdentity, dependencies.unlink)))
      throw maintenanceError(
        "BACKUP_LOCK_CLEANUP_FAILED",
        "Backup lock cleanup failed safely.",
      );
    lockIdentity = undefined;
    completed = true;
    return { name, databasePath, manifestPath, manifest };
  } catch (cause) {
    if (cause instanceof Error && cause.name === "DatabaseMaintenanceError")
      throw cause;
    throw maintenanceError(
      "BACKUP_CREATE_FAILED",
      "Database backup could not be created safely.",
      cause,
    );
  } finally {
    try {
      connection?.close();
    } catch {
      // Owned files and the lock still require cleanup.
    }
    await lockHandle?.close().catch(() => undefined);
    if (!completed) {
      await unlinkOwned(
        manifestPath,
        manifestPublishedIdentity,
        dependencies.unlink,
      );
      await unlinkOwned(
        databasePath,
        databasePublishedIdentity,
        dependencies.unlink,
      );
    }
    await unlinkOwned(
      temporaryManifestPath,
      temporaryManifestIdentity,
      dependencies.unlink,
    );
    await unlinkOwned(
      temporaryDatabasePath,
      temporaryDatabaseIdentity,
      dependencies.unlink,
    );
    await unlinkOwned(lockPath, lockIdentity, dependencies.unlink);
  }
}
