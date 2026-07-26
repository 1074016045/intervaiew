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
  maintenanceError,
  safeMaintenanceCode,
  safeMaintenanceMessage,
} from "./maintenance-error";
import {
  applyBackupRetention,
  type BackupRetentionResult,
} from "./retention-service";
import { operationalEventLogger } from "../../logging/safe-operational-event";

const processIo: CliIo = {
  out: (message) => console.log(message),
  error: (message) => console.error(message),
  event: operationalEventLogger,
};

export const RETENTION_USAGE = `Usage: pnpm --silent db:backup:retention -- [options]

Options:
  --directory <path>       Direct-child artifact directory
  --max-age-days <days>    Positive integer, maximum 36500
  --keep-latest <count>    Integer 1-10000
  --dry-run                Inspect and select without deletion (default)
  --apply                  Apply selected pair deletion
  --confirm-delete         Required together with --apply
  --json                   Emit one machine-readable result on stdout
  --help                   Show this help`;

function renderRetentionText(io: CliIo, result: BackupRetentionResult): void {
  io.out(`Retention mode: ${result.mode}`);
  io.out(`Status: ${result.status}`);
  io.out(`Scanned entries: ${result.scannedEntryCount}`);
  io.out(`Valid pairs: ${result.validPairCount}`);
  io.out(`Invalid entries: ${result.invalidEntryCount}`);
  io.out(`Incomplete pairs: ${result.incompletePairCount}`);
  io.out(`Retained by age: ${result.retainedByAgeCount}`);
  io.out(`Retained as newest: ${result.retainedByKeepLatestCount}`);
  io.out(`Eligible pairs: ${result.eligiblePairCount}`);
  io.out(`Deleted pairs: ${result.deletedPairCount}`);
  io.out(`Eligible bytes: ${result.eligibleByteCount}`);
  io.out(`Deleted bytes: ${result.deletedByteCount}`);
  io.out(`Duration ms: ${result.durationMs}`);
}

export async function runRetentionCli(
  arguments_: readonly string[],
  io: CliIo = processIo,
  environment: MaintenanceEnvironment = process.env,
): Promise<number> {
  const startedAt = Date.now();
  let json = arguments_.includes("--json");
  try {
    const parsed = parseStrictArguments(arguments_, [
      { name: "directory", kind: "value" },
      { name: "max-age-days", kind: "value" },
      { name: "keep-latest", kind: "value" },
      { name: "dry-run", kind: "flag" },
      { name: "apply", kind: "flag" },
      { name: "confirm-delete", kind: "flag" },
      { name: "json", kind: "flag" },
      { name: "help", kind: "flag" },
    ]);
    json = argumentFlag(parsed, "json");
    if (argumentFlag(parsed, "help")) {
      io.out(RETENTION_USAGE);
      return 0;
    }
    const dryRun = argumentFlag(parsed, "dry-run");
    const apply = argumentFlag(parsed, "apply");
    const confirmDelete = argumentFlag(parsed, "confirm-delete");
    if (dryRun && apply)
      throw maintenanceError(
        "BACKUP_RETENTION_MODE_CONFLICT",
        "--dry-run and --apply are mutually exclusive.",
      );
    if (apply && !confirmDelete)
      throw maintenanceError(
        "BACKUP_RETENTION_CONFIRMATION_REQUIRED",
        "--apply requires --confirm-delete.",
      );
    if (confirmDelete && !apply)
      throw maintenanceError(
        "BACKUP_RETENTION_CONFIRMATION_INVALID",
        "--confirm-delete is valid only with --apply.",
      );
    const config = parseBackupRetentionConfig(environment, {
      directory: argumentString(parsed, "directory"),
      maxAgeDays: argumentString(parsed, "max-age-days"),
      keepLatest: argumentString(parsed, "keep-latest"),
    });
    const result = await applyBackupRetention({
      ...config,
      mode: apply ? "apply" : "dry_run",
    });
    if (json) io.out(JSON.stringify(result));
    else renderRetentionText(io, result);
    io.event?.emit({
      level: "info",
      event: "maintenance.retention.completed",
      operation: "retention",
      outcome: result.mode === "dry_run" ? "dry_run_succeeded" : "succeeded",
      durationMs: result.durationMs,
      scannedEntryCount: result.scannedEntryCount,
      validPairCount: result.validPairCount,
      invalidEntryCount: result.invalidEntryCount,
      incompletePairCount: result.incompletePairCount,
      eligiblePairCount: result.eligiblePairCount,
      deletedPairCount: result.deletedPairCount,
      eligibleByteCount: result.eligibleByteCount,
      deletedByteCount: result.deletedByteCount,
    });
    return 0;
  } catch (error) {
    const errorCode = safeMaintenanceCode(error);
    io.event?.emit({
      level: "error",
      event: "maintenance.retention.failed",
      operation: "retention",
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
