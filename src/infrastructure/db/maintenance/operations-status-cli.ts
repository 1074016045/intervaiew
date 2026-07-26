import {
  argumentFlag,
  argumentString,
  parseStrictArguments,
} from "./cli-arguments";
import {
  parseBackupRetentionConfig,
  type MaintenanceEnvironment,
} from "./maintenance-config";
import type { CliIo } from "./maintenance-cli";
import {
  safeMaintenanceCode,
  safeMaintenanceMessage,
} from "./maintenance-error";
import {
  getOperationsStatus,
  type OperationsStatusSnapshot,
} from "./operations-status-service";
import { operationalEventLogger } from "../../logging/safe-operational-event";

const processIo: CliIo = {
  out: (message) => console.log(message),
  error: (message) => console.error(message),
  event: operationalEventLogger,
};

export const OPERATIONS_STATUS_USAGE = `Usage: pnpm --silent ops:status -- [options]

Options:
  --database <path>          Database to inspect read-only
  --backup-directory <path> Direct-child backup directory
  --json                    Emit one machine-readable snapshot on stdout
  --help                    Show this help`;

function renderStatusText(io: CliIo, snapshot: OperationsStatusSnapshot): void {
  io.out(`Operations status: ${snapshot.status}`);
  io.out(`Database reachable: ${snapshot.database.reachable}`);
  io.out(`Database quick check: ${snapshot.database.quickCheckOk}`);
  io.out(
    `Foreign-key violations: ${snapshot.database.foreignKeyViolationCount}`,
  );
  io.out(
    `SQLite user version: ${snapshot.database.sqliteUserVersion ?? "unavailable"}`,
  );
  io.out(
    `Migration count: ${snapshot.database.migrationCount ?? "unavailable"}`,
  );
  io.out(`Backup directory readable: ${snapshot.backups.directoryReadable}`);
  io.out(`Valid backup pairs: ${snapshot.backups.validPairCount}`);
  io.out(`Invalid backup entries: ${snapshot.backups.invalidEntryCount}`);
  io.out(`Incomplete backup pairs: ${snapshot.backups.incompletePairCount}`);
  io.out(`Queued transcription jobs: ${snapshot.transcriptionJobs.queued}`);
  io.out(`Running transcription jobs: ${snapshot.transcriptionJobs.running}`);
  io.out(
    `Completed transcription jobs: ${snapshot.transcriptionJobs.completed}`,
  );
  io.out(`Failed transcription jobs: ${snapshot.transcriptionJobs.failed}`);
  io.out(
    `Cancelled transcription jobs: ${snapshot.transcriptionJobs.cancelled}`,
  );
  io.out(`Expired running jobs: ${snapshot.transcriptionJobs.expiredRunning}`);
  io.out(`Planned deletion batches: ${snapshot.deletionBatches.planned}`);
  io.out(
    `Metadata-deleted batches: ${snapshot.deletionBatches.metadataDeleted}`,
  );
  io.out(`Retention max age days: ${snapshot.retention.maxAgeDays}`);
  io.out(`Retention keep latest: ${snapshot.retention.keepLatest}`);
}

export async function runOperationsStatusCli(
  arguments_: readonly string[],
  io: CliIo = processIo,
  environment: MaintenanceEnvironment = process.env,
): Promise<number> {
  const startedAt = Date.now();
  let json = arguments_.includes("--json");
  try {
    const parsed = parseStrictArguments(arguments_, [
      { name: "database", kind: "value" },
      { name: "backup-directory", kind: "value" },
      { name: "json", kind: "flag" },
      { name: "help", kind: "flag" },
    ]);
    json = argumentFlag(parsed, "json");
    if (argumentFlag(parsed, "help")) {
      io.out(OPERATIONS_STATUS_USAGE);
      return 0;
    }
    const retention = parseBackupRetentionConfig(environment, {
      directory: argumentString(parsed, "backup-directory"),
    });
    const snapshot = await getOperationsStatus({
      databasePath:
        argumentString(parsed, "database") ??
        environment.DATABASE_PATH ??
        "./data/intervaiew.db",
      backupDirectory: retention.directory,
      maxAgeDays: retention.maxAgeDays,
      keepLatest: retention.keepLatest,
    });
    if (json) io.out(JSON.stringify(snapshot));
    else renderStatusText(io, snapshot);
    const degraded = snapshot.status === "degraded";
    io.event?.emit({
      level: degraded ? "error" : "info",
      event: degraded
        ? "maintenance.status.failed"
        : "maintenance.status.completed",
      operation: "status",
      outcome: degraded ? "degraded" : "succeeded",
      durationMs: Math.max(0, Date.now() - startedAt),
      validPairCount: snapshot.backups.validPairCount,
      invalidEntryCount: snapshot.backups.invalidEntryCount,
      incompletePairCount: snapshot.backups.incompletePairCount,
      foreignKeyViolationCount: snapshot.database.foreignKeyViolationCount,
      queuedJobCount: snapshot.transcriptionJobs.queued,
      runningJobCount: snapshot.transcriptionJobs.running,
      failedJobCount: snapshot.transcriptionJobs.failed,
      expiredRunningJobCount: snapshot.transcriptionJobs.expiredRunning,
      plannedDeletionBatchCount: snapshot.deletionBatches.planned,
      metadataDeletedBatchCount: snapshot.deletionBatches.metadataDeleted,
    });
    return degraded ? 1 : 0;
  } catch (error) {
    const errorCode = safeMaintenanceCode(error);
    io.event?.emit({
      level: "error",
      event: "maintenance.status.failed",
      operation: "status",
      outcome: "failed",
      errorCode,
      durationMs: Math.max(0, Date.now() - startedAt),
    });
    if (json)
      io.out(JSON.stringify({ formatVersion: 1, status: "error", errorCode }));
    else io.error(`Error: ${safeMaintenanceMessage(error)}`);
    return 1;
  }
}
