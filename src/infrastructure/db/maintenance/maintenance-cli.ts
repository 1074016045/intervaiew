import { basename } from "node:path";
import { createDatabaseBackup } from "./backup-service";
import { validateBackupPair } from "./backup-validation";
import {
  argumentFlag,
  argumentString,
  parseStrictArguments,
} from "./cli-arguments";
import {
  maintenanceError,
  safeMaintenanceCode,
  safeMaintenanceMessage,
} from "./maintenance-error";
import { restoreDatabase } from "./restore-service";
import {
  operationalEventLogger,
  type OperationalEventInput,
  type OperationalEventLogger,
} from "../../logging/safe-operational-event";

export type CliIo = Readonly<{
  out: (message: string) => void;
  error: (message: string) => void;
  event?: OperationalEventLogger;
}>;

const processIo: CliIo = {
  out: (message) => console.log(message),
  error: (message) => console.error(message),
  event: operationalEventLogger,
};

function emit(io: CliIo, event: OperationalEventInput): void {
  io.event?.emit(event);
}

export const BACKUP_USAGE = `Usage: pnpm --silent db:backup -- [options]

Options:
  --database <path>       Source database (default: DATABASE_PATH or ./data/intervaiew.db)
  --output-dir <path>     Artifact directory (default: ./data/backups)
  --name <safe-name>      Explicit artifact basename
  --help                  Show this help`;

export const VALIDATE_USAGE = `Usage: pnpm --silent db:backup:validate -- --manifest <path> [--json]

Options:
  --manifest <path>       Manifest to validate (required)
  --json                  Emit only machine-readable validation output
  --help                  Show this help`;

export const RESTORE_USAGE = `Usage: pnpm --silent db:restore -- --manifest <path> [options]

Options:
  --manifest <path>                 Manifest to restore (required)
  --database <path>                 Destination (default: DATABASE_PATH or ./data/intervaiew.db)
  --dry-run                         Validate without writing
  --replace                         Permit replacement of an existing database
  --confirm-offline                 Assert application and worker are stopped
  --pre-restore-backup-dir <path>   Safety-backup directory
  --help                            Show this help`;

export async function runBackupCli(
  arguments_: readonly string[],
  io: CliIo = processIo,
): Promise<number> {
  const startedAt = Date.now();
  try {
    const parsed = parseStrictArguments(arguments_, [
      { name: "database", kind: "value" },
      { name: "output-dir", kind: "value" },
      { name: "name", kind: "value" },
      { name: "help", kind: "flag" },
    ]);
    if (argumentFlag(parsed, "help")) {
      io.out(BACKUP_USAGE);
      return 0;
    }
    const result = await createDatabaseBackup({
      databasePath:
        argumentString(parsed, "database") ??
        process.env.DATABASE_PATH ??
        "./data/intervaiew.db",
      outputDirectory: argumentString(parsed, "output-dir") ?? "./data/backups",
      name: argumentString(parsed, "name"),
    });
    io.out(`Backup created: ${basename(result.databasePath)}`);
    io.out(`Bytes: ${result.manifest.databaseBytes}`);
    io.out(`SHA-256: ${result.manifest.databaseSha256}`);
    io.out("Validation: valid");
    emit(io, {
      level: "info",
      event: "maintenance.backup.completed",
      operation: "backup",
      outcome: "succeeded",
      durationMs: Math.max(0, Date.now() - startedAt),
      databaseByteCount: result.manifest.databaseBytes,
    });
    return 0;
  } catch (error) {
    emit(io, {
      level: "error",
      event: "maintenance.backup.failed",
      operation: "backup",
      outcome: "failed",
      errorCode: safeMaintenanceCode(error),
      durationMs: Math.max(0, Date.now() - startedAt),
    });
    io.error(`Error: ${safeMaintenanceMessage(error)}`);
    return 1;
  }
}

export async function runValidateBackupCli(
  arguments_: readonly string[],
  io: CliIo = processIo,
): Promise<number> {
  const startedAt = Date.now();
  let json = arguments_.includes("--json");
  try {
    const parsed = parseStrictArguments(arguments_, [
      { name: "manifest", kind: "value" },
      { name: "json", kind: "flag" },
      { name: "help", kind: "flag" },
    ]);
    json = argumentFlag(parsed, "json");
    if (argumentFlag(parsed, "help")) {
      io.out(VALIDATE_USAGE);
      return 0;
    }
    const manifestPath = argumentString(parsed, "manifest");
    if (!manifestPath)
      throw maintenanceError(
        "CLI_MANIFEST_REQUIRED",
        "--manifest is required.",
      );
    const result = await validateBackupPair(manifestPath);
    if (json)
      io.out(
        JSON.stringify({
          valid: true,
          formatVersion: result.manifest.formatVersion,
          databaseBytes: result.manifest.databaseBytes,
          databaseSha256: result.manifest.databaseSha256,
          migrationCount: result.manifest.migrationCount,
        }),
      );
    else {
      io.out(`Backup valid: ${basename(result.manifestPath)}`);
      io.out(`Bytes: ${result.manifest.databaseBytes}`);
      io.out(`SHA-256: ${result.manifest.databaseSha256}`);
      io.out(`Migrations: ${result.manifest.migrationCount}`);
    }
    emit(io, {
      level: "info",
      event: "maintenance.validation.completed",
      operation: "validation",
      outcome: "succeeded",
      durationMs: Math.max(0, Date.now() - startedAt),
      databaseByteCount: result.manifest.databaseBytes,
    });
    return 0;
  } catch (error) {
    emit(io, {
      level: "error",
      event: "maintenance.validation.failed",
      operation: "validation",
      outcome: "failed",
      errorCode: safeMaintenanceCode(error),
      durationMs: Math.max(0, Date.now() - startedAt),
    });
    const message = safeMaintenanceMessage(error);
    if (json) io.out(JSON.stringify({ valid: false, error: message }));
    else io.error(`Error: ${message}`);
    return 1;
  }
}

export async function runRestoreCli(
  arguments_: readonly string[],
  io: CliIo = processIo,
): Promise<number> {
  const startedAt = Date.now();
  try {
    const parsed = parseStrictArguments(arguments_, [
      { name: "manifest", kind: "value" },
      { name: "database", kind: "value" },
      { name: "dry-run", kind: "flag" },
      { name: "replace", kind: "flag" },
      { name: "confirm-offline", kind: "flag" },
      { name: "pre-restore-backup-dir", kind: "value" },
      { name: "help", kind: "flag" },
    ]);
    if (argumentFlag(parsed, "help")) {
      io.out(RESTORE_USAGE);
      return 0;
    }
    const manifestPath = argumentString(parsed, "manifest");
    if (!manifestPath)
      throw maintenanceError(
        "CLI_MANIFEST_REQUIRED",
        "--manifest is required.",
      );
    const result = await restoreDatabase({
      manifestPath,
      databasePath:
        argumentString(parsed, "database") ??
        process.env.DATABASE_PATH ??
        "./data/intervaiew.db",
      dryRun: argumentFlag(parsed, "dry-run"),
      replace: argumentFlag(parsed, "replace"),
      confirmOffline: argumentFlag(parsed, "confirm-offline"),
      preRestoreBackupDirectory: argumentString(
        parsed,
        "pre-restore-backup-dir",
      ),
    });
    if (result.dryRun) io.out("Restore dry-run: valid; no files changed.");
    else {
      io.out(
        result.replaced
          ? "Database replaced safely."
          : "Database restored safely.",
      );
      if (result.preRestoreBackup)
        io.out(`Pre-restore backup: ${result.preRestoreBackup.name}`);
      io.out("Restore validation: valid");
      io.out(
        "Migrations were not run. Run pnpm db:migrate separately only for an intentional upgrade.",
      );
    }
    emit(io, {
      level: "info",
      event: result.dryRun
        ? "maintenance.restore.dry_run_completed"
        : "maintenance.restore.completed",
      operation: "restore",
      outcome: result.dryRun ? "dry_run_succeeded" : "succeeded",
      durationMs: Math.max(0, Date.now() - startedAt),
      databaseByteCount: result.databaseBytes,
    });
    return 0;
  } catch (error) {
    emit(io, {
      level: "error",
      event: "maintenance.restore.failed",
      operation: "restore",
      outcome: "failed",
      errorCode: safeMaintenanceCode(error),
      durationMs: Math.max(0, Date.now() - startedAt),
    });
    io.error(`Error: ${safeMaintenanceMessage(error)}`);
    return 1;
  }
}
