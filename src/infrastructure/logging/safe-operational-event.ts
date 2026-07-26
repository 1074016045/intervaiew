export const maintenanceEventNames = [
  "maintenance.backup.completed",
  "maintenance.backup.failed",
  "maintenance.validation.completed",
  "maintenance.validation.failed",
  "maintenance.restore.dry_run_completed",
  "maintenance.restore.completed",
  "maintenance.restore.failed",
  "maintenance.retention.completed",
  "maintenance.retention.failed",
  "maintenance.status.completed",
  "maintenance.status.failed",
] as const;

export type MaintenanceEventName = (typeof maintenanceEventNames)[number];
export type MaintenanceOperation =
  "backup" | "validation" | "restore" | "retention" | "status";
export type MaintenanceOutcome =
  "succeeded" | "failed" | "dry_run_succeeded" | "degraded";

export type OperationalEventInput = Readonly<{
  level: "info" | "error";
  event: MaintenanceEventName;
  operation: MaintenanceOperation;
  outcome: MaintenanceOutcome;
  errorCode?: string;
  durationMs: number;
  scannedEntryCount?: number;
  validPairCount?: number;
  invalidEntryCount?: number;
  incompletePairCount?: number;
  eligiblePairCount?: number;
  deletedPairCount?: number;
  eligibleByteCount?: number;
  deletedByteCount?: number;
  databaseByteCount?: number;
  foreignKeyViolationCount?: number;
  queuedJobCount?: number;
  runningJobCount?: number;
  failedJobCount?: number;
  expiredRunningJobCount?: number;
  plannedDeletionBatchCount?: number;
  metadataDeletedBatchCount?: number;
}>;

export type OperationalEvent = Readonly<
  OperationalEventInput & {
    formatVersion: 1;
    timestamp: string;
  }
>;

export type OperationalEventLogger = Readonly<{
  emit: (event: OperationalEventInput) => boolean;
}>;

const eventNameSet = new Set<string>(maintenanceEventNames);
const operations = new Set<string>([
  "backup",
  "validation",
  "restore",
  "retention",
  "status",
]);
const outcomes = new Set<string>([
  "succeeded",
  "failed",
  "dry_run_succeeded",
  "degraded",
]);
const allowedInputFields = new Set<string>([
  "level",
  "event",
  "operation",
  "outcome",
  "errorCode",
  "durationMs",
  "scannedEntryCount",
  "validPairCount",
  "invalidEntryCount",
  "incompletePairCount",
  "eligiblePairCount",
  "deletedPairCount",
  "eligibleByteCount",
  "deletedByteCount",
  "databaseByteCount",
  "foreignKeyViolationCount",
  "queuedJobCount",
  "runningJobCount",
  "failedJobCount",
  "expiredRunningJobCount",
  "plannedDeletionBatchCount",
  "metadataDeletedBatchCount",
]);

function safeCount(value: number | undefined): boolean {
  return (
    value === undefined ||
    (Number.isSafeInteger(value) &&
      value >= 0 &&
      value <= Number.MAX_SAFE_INTEGER)
  );
}

function validInput(input: OperationalEventInput): boolean {
  if (
    !Object.keys(input).every((key) => allowedInputFields.has(key)) ||
    !eventNameSet.has(input.event) ||
    !operations.has(input.operation) ||
    !outcomes.has(input.outcome) ||
    !["info", "error"].includes(input.level) ||
    !safeCount(input.durationMs) ||
    (input.errorCode !== undefined &&
      !/^[A-Z0-9_]{1,80}$/.test(input.errorCode))
  )
    return false;
  return [
    input.scannedEntryCount,
    input.validPairCount,
    input.invalidEntryCount,
    input.incompletePairCount,
    input.eligiblePairCount,
    input.deletedPairCount,
    input.eligibleByteCount,
    input.deletedByteCount,
    input.databaseByteCount,
    input.foreignKeyViolationCount,
    input.queuedJobCount,
    input.runningJobCount,
    input.failedJobCount,
    input.expiredRunningJobCount,
    input.plannedDeletionBatchCount,
    input.metadataDeletedBatchCount,
  ].every(safeCount);
}

export function createOperationalEventLogger(
  write: (line: string) => unknown = (line) => process.stderr.write(line),
  clock: () => Date = () => new Date(),
): OperationalEventLogger {
  return Object.freeze({
    emit(input: OperationalEventInput): boolean {
      try {
        if (!validInput(input)) return false;
        const event: OperationalEvent = {
          formatVersion: 1,
          timestamp: clock().toISOString(),
          ...input,
        };
        write(`${JSON.stringify(event)}\n`);
        return true;
      } catch {
        return false;
      }
    },
  });
}

export const operationalEventLogger = createOperationalEventLogger();
