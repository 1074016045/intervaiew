import { basename } from "node:path";
import { z } from "zod";
import { maintenanceError } from "./maintenance-error";

export const BACKUP_FORMAT_VERSION = 1 as const;
export const BACKUP_APPLICATION = "intervaiew" as const;
export const MAX_MANIFEST_BYTES = 64 * 1024;
export const MAX_DATABASE_BYTES = 16 * 1024 * 1024 * 1024;

const safeInteger = z.number().int().nonnegative().safe();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

function isCanonicalUtcTimestamp(value: string): boolean {
  if (value.length !== 24 || !value.endsWith("Z")) return false;
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) && date.toISOString() === value;
}

export function isSafeBackupDatabaseFile(value: string): boolean {
  const windowsReservedName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
  return (
    value.length >= 8 &&
    value.length <= 120 &&
    basename(value) === value &&
    !value.includes("..") &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    !value.includes(":") &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*\.sqlite$/.test(value) &&
    !windowsReservedName.test(value)
  );
}

export const backupManifestSchema = z
  .object({
    formatVersion: z.literal(BACKUP_FORMAT_VERSION),
    application: z.literal(BACKUP_APPLICATION),
    createdAt: z.string().max(32).refine(isCanonicalUtcTimestamp),
    databaseFile: z.string().refine(isSafeBackupDatabaseFile),
    databaseBytes: safeInteger.max(MAX_DATABASE_BYTES),
    databaseSha256: sha256,
    sqliteUserVersion: safeInteger,
    migrationCount: safeInteger,
    latestMigrationHash: sha256.nullable(),
  })
  .strict();

export type BackupManifest = z.infer<typeof backupManifestSchema>;

export function parseBackupManifest(value: unknown): BackupManifest {
  const result = backupManifestSchema.safeParse(value);
  if (!result.success)
    throw maintenanceError(
      "BACKUP_MANIFEST_INVALID",
      "Backup manifest is invalid or unsupported.",
      result.error,
    );
  return result.data;
}

export function parseBackupManifestJson(value: string): BackupManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (cause) {
    throw maintenanceError(
      "BACKUP_MANIFEST_JSON_INVALID",
      "Backup manifest JSON is invalid.",
      cause,
    );
  }
  return parseBackupManifest(parsed);
}

export function serializeBackupManifest(manifest: BackupManifest): string {
  return `${JSON.stringify(parseBackupManifest(manifest), null, 2)}\n`;
}

export function isSafeBackupName(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= 80 &&
    !value.includes("..") &&
    /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)
  );
}

export function assertSafeBackupName(value: string): void {
  if (!isSafeBackupName(value))
    throw maintenanceError(
      "BACKUP_NAME_INVALID",
      "Backup name must be 1-80 safe filename characters.",
    );
}
