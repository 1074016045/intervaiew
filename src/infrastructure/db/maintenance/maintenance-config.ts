import { maintenanceError } from "./maintenance-error";

export const DEFAULT_BACKUP_RETENTION_DIRECTORY = "./data/backups";
export const DEFAULT_BACKUP_RETENTION_MAX_AGE_DAYS = 30;
export const DEFAULT_BACKUP_RETENTION_KEEP_LATEST = 3;
export const MAX_BACKUP_RETENTION_AGE_DAYS = 36_500;
export const MAX_BACKUP_RETENTION_KEEP_LATEST = 10_000;

export type BackupRetentionConfig = Readonly<{
  directory: string;
  maxAgeDays: number;
  keepLatest: number;
}>;

export type BackupRetentionConfigOverrides = Readonly<{
  directory?: string;
  maxAgeDays?: string | number;
  keepLatest?: string | number;
}>;
export type MaintenanceEnvironment = Readonly<
  Record<string, string | undefined>
>;

function strictInteger(
  value: string | number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  code: string,
): number {
  const candidate = value ?? fallback;
  if (
    (typeof candidate === "string" && !/^(?:0|[1-9][0-9]*)$/.test(candidate)) ||
    (typeof candidate !== "string" && typeof candidate !== "number")
  )
    throw maintenanceError(code, "Backup retention configuration is invalid.");
  const parsed = typeof candidate === "number" ? candidate : Number(candidate);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum)
    throw maintenanceError(code, "Backup retention configuration is invalid.");
  return parsed;
}

function directoryValue(value: string | undefined): string {
  const candidate = value ?? DEFAULT_BACKUP_RETENTION_DIRECTORY;
  if (candidate.trim().length === 0 || candidate.length > 4_096)
    throw maintenanceError(
      "BACKUP_RETENTION_DIRECTORY_INVALID",
      "Backup retention directory configuration is invalid.",
    );
  return candidate;
}

export function parseBackupRetentionConfig(
  environment: MaintenanceEnvironment = process.env,
  overrides: BackupRetentionConfigOverrides = {},
): BackupRetentionConfig {
  return Object.freeze({
    directory: directoryValue(
      overrides.directory ?? environment.BACKUP_RETENTION_DIRECTORY,
    ),
    maxAgeDays: strictInteger(
      overrides.maxAgeDays ?? environment.BACKUP_RETENTION_MAX_AGE_DAYS,
      DEFAULT_BACKUP_RETENTION_MAX_AGE_DAYS,
      1,
      MAX_BACKUP_RETENTION_AGE_DAYS,
      "BACKUP_RETENTION_MAX_AGE_INVALID",
    ),
    keepLatest: strictInteger(
      overrides.keepLatest ?? environment.BACKUP_RETENTION_KEEP_LATEST,
      DEFAULT_BACKUP_RETENTION_KEEP_LATEST,
      1,
      MAX_BACKUP_RETENTION_KEEP_LATEST,
      "BACKUP_RETENTION_KEEP_LATEST_INVALID",
    ),
  });
}
