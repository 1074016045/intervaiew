import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { discoverBackupArtifacts } from "./retention-service";

const transcriptionStatuses = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;
const MAX_STATUS_DATABASE_BYTES = 512 * 1024 * 1024;

type TranscriptionStatus = (typeof transcriptionStatuses)[number];
type MutableJobCounts = Record<TranscriptionStatus, number> & {
  expiredRunning: number;
};

export type OperationsStatusSnapshot = Readonly<{
  formatVersion: 1;
  status: "ok" | "degraded";
  database: Readonly<{
    reachable: boolean;
    quickCheckOk: boolean;
    foreignKeyViolationCount: number;
    sqliteUserVersion: number | null;
    migrationCount: number | null;
  }>;
  backups: Readonly<{
    directoryReadable: boolean;
    validPairCount: number;
    invalidEntryCount: number;
    incompletePairCount: number;
  }>;
  transcriptionJobs: Readonly<
    Record<TranscriptionStatus, number> & { expiredRunning: number }
  >;
  deletionBatches: Readonly<{
    planned: number;
    metadataDeleted: number;
  }>;
  retention: Readonly<{
    maxAgeDays: number;
    keepLatest: number;
  }>;
}>;

export type OperationsStatusOptions = Readonly<{
  databasePath: string;
  backupDirectory: string;
  maxAgeDays: number;
  keepLatest: number;
}>;

export type OperationsStatusDependencies = Readonly<{
  now: () => Date;
  inspectBackups: typeof discoverBackupArtifacts;
  inspectDatabase: typeof inspectOperationsDatabase;
}>;

const defaultDependencies: OperationsStatusDependencies = {
  now: () => new Date(),
  inspectBackups: discoverBackupArtifacts,
  inspectDatabase: inspectOperationsDatabase,
};

function safeCount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

function tableExists(connection: Database.Database, name: string): boolean {
  return Boolean(
    connection
      .prepare("select 1 from sqlite_master where type = 'table' and name = ?")
      .get(name),
  );
}

function countRows(
  connection: Database.Database,
  statement: string,
  ...parameters: Array<string | number>
): number {
  const row = connection.prepare(statement).get(...parameters) as
    { count: unknown } | undefined;
  return safeCount(row?.count);
}

function emptyJobCounts(): MutableJobCounts {
  return {
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    expiredRunning: 0,
  };
}

export async function inspectOperationsDatabase(
  databasePath: string,
  now: Date,
): Promise<{
  database: OperationsStatusSnapshot["database"];
  transcriptionJobs: OperationsStatusSnapshot["transcriptionJobs"];
  deletionBatches: OperationsStatusSnapshot["deletionBatches"];
  degraded: boolean;
}> {
  const unavailable = {
    database: {
      reachable: false,
      quickCheckOk: false,
      foreignKeyViolationCount: 0,
      sqliteUserVersion: null,
      migrationCount: null,
    },
    transcriptionJobs: emptyJobCounts(),
    deletionBatches: { planned: 0, metadataDeleted: 0 },
    degraded: true,
  } as const;
  const path = resolve(databasePath);
  let connection: Database.Database | undefined;
  try {
    const stats = await lstat(path);
    if (
      stats.isSymbolicLink() ||
      !stats.isFile() ||
      stats.size <= 0 ||
      stats.size > MAX_STATUS_DATABASE_BYTES
    )
      return unavailable;
    for (const sidecarPath of [`${path}-wal`, `${path}-shm`])
      try {
        await lstat(sidecarPath);
        return unavailable;
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "ENOENT")
          return unavailable;
      }
    const handle = await open(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    let databaseBytes: Buffer;
    try {
      const opened = await handle.stat();
      if (
        !opened.isFile() ||
        opened.dev !== stats.dev ||
        opened.ino !== stats.ino ||
        opened.size !== stats.size
      )
        return unavailable;
      databaseBytes = await handle.readFile();
      const afterRead = await handle.stat();
      const current = await lstat(path);
      if (
        afterRead.size !== databaseBytes.length ||
        current.dev !== opened.dev ||
        current.ino !== opened.ino ||
        current.size !== opened.size
      )
        return unavailable;
    } finally {
      await handle.close().catch(() => undefined);
    }
    for (const sidecarPath of [`${path}-wal`, `${path}-shm`])
      try {
        await lstat(sidecarPath);
        return unavailable;
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "ENOENT")
          return unavailable;
      }
    const inspectionBytes = Buffer.from(databaseBytes);
    if (
      inspectionBytes.length < 100 ||
      inspectionBytes.subarray(0, 16).toString("binary") !== "SQLite format 3\0"
    )
      return unavailable;
    inspectionBytes[18] = 1;
    inspectionBytes[19] = 1;
    connection = new Database(inspectionBytes as unknown as string);
    connection.pragma("query_only = ON");
    const quickCheckRows = connection.pragma("quick_check") as Array<
      Record<string, unknown>
    >;
    const quickCheckOk =
      quickCheckRows.length === 1 &&
      Object.values(quickCheckRows[0] ?? {}).length === 1 &&
      Object.values(quickCheckRows[0] ?? {})[0] === "ok";
    const foreignKeyViolationCount = safeCount(
      (connection.pragma("foreign_key_check") as unknown[]).length,
    );
    const sqliteUserVersionValue = connection.pragma("user_version", {
      simple: true,
    });
    const sqliteUserVersion = Number.isSafeInteger(sqliteUserVersionValue)
      ? (sqliteUserVersionValue as number)
      : null;
    const migrationCount = tableExists(connection, "__drizzle_migrations")
      ? countRows(
          connection,
          "select count(*) as count from __drizzle_migrations",
        )
      : null;

    const transcriptionJobs = emptyJobCounts();
    let jobsAvailable = false;
    if (tableExists(connection, "uploaded_audio_transcription_jobs")) {
      jobsAvailable = true;
      for (const status of transcriptionStatuses)
        transcriptionJobs[status] = countRows(
          connection,
          "select count(*) as count from uploaded_audio_transcription_jobs where status = ?",
          status,
        );
      transcriptionJobs.expiredRunning = countRows(
        connection,
        "select count(*) as count from uploaded_audio_transcription_jobs where status = 'running' and lease_expires_at <= ?",
        now.valueOf(),
      );
    }

    const deletionBatches = { planned: 0, metadataDeleted: 0 };
    let deletionsAvailable = false;
    if (tableExists(connection, "uploaded_audio_deletion_batches")) {
      deletionsAvailable = true;
      deletionBatches.planned = countRows(
        connection,
        "select count(*) as count from uploaded_audio_deletion_batches where status = 'planned'",
      );
      deletionBatches.metadataDeleted = countRows(
        connection,
        "select count(*) as count from uploaded_audio_deletion_batches where status = 'metadata_deleted'",
      );
    }
    return {
      database: {
        reachable: true,
        quickCheckOk,
        foreignKeyViolationCount,
        sqliteUserVersion,
        migrationCount,
      },
      transcriptionJobs,
      deletionBatches,
      degraded:
        !quickCheckOk ||
        foreignKeyViolationCount > 0 ||
        sqliteUserVersion === null ||
        migrationCount === null ||
        !jobsAvailable ||
        !deletionsAvailable,
    };
  } catch {
    return unavailable;
  } finally {
    try {
      connection?.close();
    } catch {
      // The fixed degraded result above is returned for inspection failures.
    }
  }
}

export async function getOperationsStatus(
  options: OperationsStatusOptions,
  dependencyOverrides: Partial<OperationsStatusDependencies> = {},
): Promise<OperationsStatusSnapshot> {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  const now = dependencies.now();
  const [databaseInspection, backupInspection] = await Promise.all([
    dependencies.inspectDatabase(options.databasePath, now),
    dependencies
      .inspectBackups(options.backupDirectory)
      .then((inventory) => ({
        backups: {
          directoryReadable: true,
          validPairCount: inventory.validPairs.length,
          invalidEntryCount: inventory.invalidEntryCount,
          incompletePairCount: inventory.incompletePairCount,
        },
        degraded:
          inventory.invalidEntryCount > 0 || inventory.incompletePairCount > 0,
      }))
      .catch(() => ({
        backups: {
          directoryReadable: false,
          validPairCount: 0,
          invalidEntryCount: 0,
          incompletePairCount: 0,
        },
        degraded: true,
      })),
  ]);
  return Object.freeze({
    formatVersion: 1,
    status:
      databaseInspection.degraded || backupInspection.degraded
        ? "degraded"
        : "ok",
    database: Object.freeze(databaseInspection.database),
    backups: Object.freeze(backupInspection.backups),
    transcriptionJobs: Object.freeze(databaseInspection.transcriptionJobs),
    deletionBatches: Object.freeze(databaseInspection.deletionBatches),
    retention: Object.freeze({
      maxAgeDays: options.maxAgeDays,
      keepLatest: options.keepLatest,
    }),
  });
}
