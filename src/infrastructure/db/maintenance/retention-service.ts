import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  link,
  lstat,
  open,
  readdir,
  realpath,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { isSafeBackupDatabaseFile } from "./backup-manifest";
import { validateBackupPair } from "./backup-validation";
import { maintenanceError } from "./maintenance-error";
import { selectBackupRetentionCandidates } from "./retention-policy";

const RETENTION_LOCK_NAME = ".intervaiew-retention.lock";
const RETENTION_RECOVERY_PREFIX = ".intervaiew-retention-recovery-";

type FileIdentity = Readonly<{ dev: number; ino: number }>;

export type DiscoveredBackupPair = Readonly<{
  createdAt: string;
  tieBreaker: string;
  databasePath: string;
  manifestPath: string;
  databaseBytes: number;
  manifestBytes: number;
  databaseIdentity: FileIdentity;
  manifestIdentity: FileIdentity;
}>;

export type BackupArtifactInventory = Readonly<{
  directory: string;
  scannedEntryCount: number;
  validPairs: readonly DiscoveredBackupPair[];
  invalidEntryCount: number;
  incompletePairCount: number;
}>;

export type BackupRetentionResult = Readonly<{
  formatVersion: 1;
  mode: "dry_run" | "apply";
  status: "ok";
  scannedEntryCount: number;
  validPairCount: number;
  invalidEntryCount: number;
  incompletePairCount: number;
  retainedByAgeCount: number;
  retainedByKeepLatestCount: number;
  eligiblePairCount: number;
  deletedPairCount: number;
  eligibleByteCount: number;
  deletedByteCount: number;
  durationMs: number;
}>;

export type BackupRetentionOptions = Readonly<{
  directory: string;
  maxAgeDays: number;
  keepLatest: number;
  mode: "dry_run" | "apply";
}>;

type RetentionByteCandidate = Readonly<{
  databaseBytes: number;
  manifestBytes: number;
}>;

export type RetentionDependencies = Readonly<{
  chmod: typeof chmod;
  link: typeof link;
  lstat: typeof lstat;
  open: typeof open;
  readdir: typeof readdir;
  realpath: typeof realpath;
  unlink: typeof unlink;
  validatePair: typeof validateBackupPair;
  now: () => Date;
  randomId: () => string;
  afterLockAcquired?: () => void | Promise<void>;
  afterOwnershipOpen?: () => void | Promise<void>;
  beforeDatabaseMutation?: () => void | Promise<void>;
  afterDatabaseStaged?: () => void | Promise<void>;
  beforeManifestMutation?: () => void | Promise<void>;
  afterManifestStaged?: () => void | Promise<void>;
}>;

const defaultDependencies: RetentionDependencies = {
  chmod,
  link,
  lstat,
  open,
  readdir,
  realpath,
  unlink,
  validatePair: validateBackupPair,
  now: () => new Date(),
  randomId: randomUUID,
};

function checkedByteAddition(total: number, value: number): number {
  if (
    !Number.isSafeInteger(total) ||
    total < 0 ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    total > Number.MAX_SAFE_INTEGER - value
  )
    throw maintenanceError(
      "BACKUP_RETENTION_BYTE_TOTAL_UNSAFE",
      "Backup retention byte totals exceed the supported safe range.",
    );
  return total + value;
}

export function calculateBackupPairByteTotal(
  pairs: readonly RetentionByteCandidate[],
): number {
  let total = 0;
  for (const pair of pairs) {
    total = checkedByteAddition(total, pair.databaseBytes);
    total = checkedByteAddition(total, pair.manifestBytes);
  }
  return total;
}

function sameIdentity(first: FileIdentity, second: FileIdentity): boolean {
  return first.dev === second.dev && first.ino === second.ino;
}

function safeBaseFromDatabase(name: string): string | undefined {
  if (!isSafeBackupDatabaseFile(name)) return undefined;
  return name.slice(0, -".sqlite".length);
}

function safeBaseFromManifest(name: string): string | undefined {
  if (!name.endsWith(".manifest.json")) return undefined;
  const base = name.slice(0, -".manifest.json".length);
  return isSafeBackupDatabaseFile(`${base}.sqlite`) ? base : undefined;
}

async function safeRetentionDirectory(
  input: string,
  dependencies: RetentionDependencies,
): Promise<string> {
  const resolved = resolve(input);
  try {
    const before = await dependencies.lstat(resolved);
    if (before.isSymbolicLink() || !before.isDirectory())
      throw maintenanceError(
        "BACKUP_RETENTION_DIRECTORY_UNSAFE",
        "Backup retention directory is unavailable or unsafe.",
      );
    const canonical = await dependencies.realpath(resolved);
    const after = await dependencies.lstat(canonical);
    if (!after.isDirectory() || !sameIdentity(before, after))
      throw maintenanceError(
        "BACKUP_RETENTION_DIRECTORY_CHANGED",
        "Backup retention directory changed during inspection.",
      );
    return canonical;
  } catch (cause) {
    if (cause instanceof Error && cause.name === "DatabaseMaintenanceError")
      throw cause;
    throw maintenanceError(
      "BACKUP_RETENTION_DIRECTORY_UNAVAILABLE",
      "Backup retention directory is unavailable or unsafe.",
      cause,
    );
  }
}

async function regularArtifact(
  path: string,
  dependencies: RetentionDependencies,
): Promise<{ identity: FileIdentity; size: number } | undefined> {
  try {
    const stats = await dependencies.lstat(path);
    if (stats.isSymbolicLink() || !stats.isFile()) return undefined;
    return { identity: stats, size: stats.size };
  } catch {
    return undefined;
  }
}

export async function discoverBackupArtifacts(
  directoryInput: string,
  dependencyOverrides: Partial<RetentionDependencies> = {},
): Promise<BackupArtifactInventory> {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  const directory = await safeRetentionDirectory(directoryInput, dependencies);
  let entries;
  try {
    entries = await dependencies.readdir(directory, { withFileTypes: true });
  } catch (cause) {
    throw maintenanceError(
      "BACKUP_RETENTION_DIRECTORY_UNREADABLE",
      "Backup retention directory cannot be read safely.",
      cause,
    );
  }
  const names = entries.map((entry) => entry.name).sort();
  if (names.some((name) => name.startsWith(RETENTION_RECOVERY_PREFIX)))
    throw maintenanceError(
      "BACKUP_RETENTION_RECOVERY_RESIDUE",
      "A prior retention operation left recovery residue; manual inspection is required.",
    );

  const nameSet = new Set(names);
  const candidateBases = new Set<string>();
  const recognizedNames = new Set<string>();
  for (const name of names) {
    const base = safeBaseFromDatabase(name) ?? safeBaseFromManifest(name);
    if (base) candidateBases.add(base);
  }

  const validPairs: DiscoveredBackupPair[] = [];
  let invalidEntryCount = 0;
  let incompletePairCount = 0;
  for (const base of [...candidateBases].sort()) {
    const databaseName = `${base}.sqlite`;
    const manifestName = `${base}.manifest.json`;
    const hasDatabase = nameSet.has(databaseName);
    const hasManifest = nameSet.has(manifestName);
    if (hasDatabase) recognizedNames.add(databaseName);
    if (hasManifest) recognizedNames.add(manifestName);
    if (!hasDatabase || !hasManifest) {
      incompletePairCount += 1;
      continue;
    }
    const databasePath = join(directory, databaseName);
    const manifestPath = join(directory, manifestName);
    const [database, manifest] = await Promise.all([
      regularArtifact(databasePath, dependencies),
      regularArtifact(manifestPath, dependencies),
    ]);
    if (!database || !manifest) {
      invalidEntryCount += 2;
      continue;
    }
    try {
      const validated = await dependencies.validatePair(manifestPath);
      if (
        validated.databasePath !== databasePath ||
        validated.manifestPath !== manifestPath ||
        validated.manifest.databaseFile !== databaseName
      )
        throw maintenanceError(
          "BACKUP_RETENTION_PAIR_CHANGED",
          "Backup pair changed during retention inspection.",
        );
      const [databaseAfter, manifestAfter] = await Promise.all([
        regularArtifact(databasePath, dependencies),
        regularArtifact(manifestPath, dependencies),
      ]);
      if (
        !databaseAfter ||
        !manifestAfter ||
        !sameIdentity(database.identity, databaseAfter.identity) ||
        !sameIdentity(manifest.identity, manifestAfter.identity)
      )
        throw maintenanceError(
          "BACKUP_RETENTION_PAIR_CHANGED",
          "Backup pair changed during retention inspection.",
        );
      validPairs.push(
        Object.freeze({
          createdAt: validated.manifest.createdAt,
          tieBreaker: base,
          databasePath,
          manifestPath,
          databaseBytes: databaseAfter.size,
          manifestBytes: manifestAfter.size,
          databaseIdentity: databaseAfter.identity,
          manifestIdentity: manifestAfter.identity,
        }),
      );
    } catch {
      invalidEntryCount += 2;
    }
  }
  invalidEntryCount += names.filter(
    (name) => !recognizedNames.has(name),
  ).length;
  return Object.freeze({
    directory,
    scannedEntryCount: names.length,
    validPairs: Object.freeze(validPairs),
    invalidEntryCount,
    incompletePairCount,
  });
}

async function openOwnedArtifact(
  path: string,
  expectedIdentity: FileIdentity,
  dependencies: RetentionDependencies,
): Promise<FileHandle> {
  let handle: FileHandle | undefined;
  try {
    handle = await dependencies.open(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const opened = await handle.stat();
    if (!opened.isFile() || !sameIdentity(opened, expectedIdentity))
      throw maintenanceError(
        "BACKUP_RETENTION_ARTIFACT_CHANGED",
        "Backup artifact changed before retention could own it safely.",
      );
    return handle;
  } catch (cause) {
    await handle?.close().catch(() => undefined);
    if (cause instanceof Error && cause.name === "DatabaseMaintenanceError")
      throw cause;
    throw maintenanceError(
      "BACKUP_RETENTION_ARTIFACT_OWNERSHIP_FAILED",
      "Backup artifact ownership could not be retained safely.",
      cause,
    );
  }
}

async function assertOwnedPath(
  path: string,
  handle: FileHandle,
  dependencies: RetentionDependencies,
): Promise<void> {
  try {
    const [owned, current] = await Promise.all([
      handle.stat(),
      dependencies.lstat(path),
    ]);
    if (
      !owned.isFile() ||
      current.isSymbolicLink() ||
      !current.isFile() ||
      !sameIdentity(owned, current)
    )
      throw new Error("identity-mismatch");
  } catch (cause) {
    throw maintenanceError(
      "BACKUP_RETENTION_ARTIFACT_CHANGED",
      "Backup artifact changed immediately before retention mutation.",
      cause,
    );
  }
}

async function unlinkOwnedPath(
  path: string,
  handle: FileHandle | undefined,
  dependencies: RetentionDependencies,
): Promise<boolean> {
  if (!handle) return false;
  try {
    await assertOwnedPath(path, handle, dependencies);
    await dependencies.unlink(path);
    return true;
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === "ENOENT";
  }
}

async function stageOwnedLink(
  source: string,
  target: string,
  handle: FileHandle,
  dependencies: RetentionDependencies,
): Promise<void> {
  await assertOwnedPath(source, handle, dependencies);
  await dependencies.link(source, target);
  const [owned, staged] = await Promise.all([
    handle.stat(),
    dependencies.lstat(target),
  ]);
  if (!staged.isFile() || !sameIdentity(owned, staged))
    throw maintenanceError(
      "BACKUP_RETENTION_STAGING_FAILED",
      "Backup artifact could not be staged safely.",
    );
}

async function restoreOwnedLink(
  recoveryPath: string,
  originalPath: string,
  handle: FileHandle,
  dependencies: RetentionDependencies,
): Promise<boolean> {
  try {
    await assertOwnedPath(recoveryPath, handle, dependencies);
    await dependencies.link(recoveryPath, originalPath);
    await assertOwnedPath(originalPath, handle, dependencies);
    return true;
  } catch {
    return false;
  }
}

type OwnedPathState = "owned" | "missing" | "other";

async function ownedPathState(
  path: string,
  handle: FileHandle,
  dependencies: RetentionDependencies,
): Promise<OwnedPathState> {
  let owned;
  try {
    owned = await handle.stat();
    if (!owned.isFile()) return "other";
  } catch {
    return "other";
  }
  let current;
  try {
    current = await dependencies.lstat(path);
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === "ENOENT"
      ? "missing"
      : "other";
  }
  return current.isFile() &&
    !current.isSymbolicLink() &&
    sameIdentity(owned, current)
    ? "owned"
    : "other";
}

async function ensureOwnedOriginalPath(
  originalPath: string,
  recoveryPath: string,
  recoveryCreated: boolean,
  handle: FileHandle | undefined,
  dependencies: RetentionDependencies,
): Promise<boolean> {
  if (!handle) return false;
  const originalState = await ownedPathState(
    originalPath,
    handle,
    dependencies,
  );
  if (originalState === "owned") return true;
  if (originalState !== "missing" || !recoveryCreated) return false;
  if ((await ownedPathState(recoveryPath, handle, dependencies)) !== "owned")
    return false;
  return restoreOwnedLink(recoveryPath, originalPath, handle, dependencies);
}

async function deleteOwnedPair(
  pair: DiscoveredBackupPair,
  directory: string,
  dependencies: RetentionDependencies,
): Promise<void> {
  let databaseHandle: FileHandle | undefined;
  let manifestHandle: FileHandle | undefined;
  const suffix = dependencies.randomId();
  const databaseRecoveryPath = join(
    directory,
    `${RETENTION_RECOVERY_PREFIX}${suffix}.database`,
  );
  const manifestRecoveryPath = join(
    directory,
    `${RETENTION_RECOVERY_PREFIX}${suffix}.manifest`,
  );
  let databaseRecoveryCreated = false;
  let manifestRecoveryCreated = false;
  let recoveryCleanupStarted = false;

  try {
    databaseHandle = await openOwnedArtifact(
      pair.databasePath,
      pair.databaseIdentity,
      dependencies,
    );
    manifestHandle = await openOwnedArtifact(
      pair.manifestPath,
      pair.manifestIdentity,
      dependencies,
    );
    await dependencies.afterOwnershipOpen?.();
    await stageOwnedLink(
      pair.databasePath,
      databaseRecoveryPath,
      databaseHandle,
      dependencies,
    );
    databaseRecoveryCreated = true;
    await stageOwnedLink(
      pair.manifestPath,
      manifestRecoveryPath,
      manifestHandle,
      dependencies,
    );
    manifestRecoveryCreated = true;

    await dependencies.beforeDatabaseMutation?.();
    await assertOwnedPath(pair.databasePath, databaseHandle, dependencies);
    await dependencies.unlink(pair.databasePath);
    await dependencies.afterDatabaseStaged?.();
    await dependencies.beforeManifestMutation?.();
    await assertOwnedPath(pair.manifestPath, manifestHandle, dependencies);
    await dependencies.unlink(pair.manifestPath);
    await dependencies.afterManifestStaged?.();

    recoveryCleanupStarted = true;
    if (
      !(await unlinkOwnedPath(
        databaseRecoveryPath,
        databaseHandle,
        dependencies,
      ))
    )
      throw maintenanceError(
        "BACKUP_RETENTION_RECOVERY_CLEANUP_FAILED",
        "Backup pair deletion left recovery residue for manual inspection.",
      );
    databaseRecoveryCreated = false;
    if (
      !(await unlinkOwnedPath(
        manifestRecoveryPath,
        manifestHandle,
        dependencies,
      ))
    )
      throw maintenanceError(
        "BACKUP_RETENTION_RECOVERY_CLEANUP_FAILED",
        "Backup pair deletion left recovery residue for manual inspection.",
      );
    manifestRecoveryCreated = false;
  } catch (cause) {
    if (
      !recoveryCleanupStarted &&
      (databaseRecoveryCreated || manifestRecoveryCreated)
    ) {
      const databaseRestored = await ensureOwnedOriginalPath(
        pair.databasePath,
        databaseRecoveryPath,
        databaseRecoveryCreated,
        databaseHandle,
        dependencies,
      );
      const manifestRestored = await ensureOwnedOriginalPath(
        pair.manifestPath,
        manifestRecoveryPath,
        manifestRecoveryCreated,
        manifestHandle,
        dependencies,
      );
      if (databaseRestored && manifestRestored) {
        if (databaseRecoveryCreated)
          databaseRecoveryCreated = !(await unlinkOwnedPath(
            databaseRecoveryPath,
            databaseHandle,
            dependencies,
          ));
        if (manifestRecoveryCreated)
          manifestRecoveryCreated = !(await unlinkOwnedPath(
            manifestRecoveryPath,
            manifestHandle,
            dependencies,
          ));
      }
      if (!databaseRestored || !manifestRestored)
        throw maintenanceError(
          "BACKUP_RETENTION_ROLLBACK_FAILED",
          "Backup pair rollback could not be completed; recovery residue requires manual inspection.",
          cause,
        );
      if (databaseRecoveryCreated || manifestRecoveryCreated)
        throw maintenanceError(
          "BACKUP_RETENTION_RECOVERY_CLEANUP_FAILED",
          "Backup pair rollback left recovery residue for manual inspection.",
          cause,
        );
    }
    if (cause instanceof Error && cause.name === "DatabaseMaintenanceError")
      throw cause;
    throw maintenanceError(
      "BACKUP_RETENTION_DELETE_FAILED",
      "Backup pair deletion failed safely.",
      cause,
    );
  } finally {
    await manifestHandle?.close().catch(() => undefined);
    await databaseHandle?.close().catch(() => undefined);
  }
}

async function cleanupLock(
  path: string,
  handle: FileHandle | undefined,
  dependencies: RetentionDependencies,
): Promise<boolean> {
  if (!handle) return true;
  const removed = await unlinkOwnedPath(path, handle, dependencies);
  await handle.close().catch(() => undefined);
  return removed;
}

export async function applyBackupRetention(
  options: BackupRetentionOptions,
  dependencyOverrides: Partial<RetentionDependencies> = {},
): Promise<BackupRetentionResult> {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  const startedAt = dependencies.now();
  let lockHandle: FileHandle | undefined;
  let lockPath: string | undefined;
  let inventory: BackupArtifactInventory;
  let deletedPairCount = 0;
  let deletedByteCount = 0;
  let operationError: unknown;

  try {
    const directory = await safeRetentionDirectory(
      options.directory,
      dependencies,
    );
    if (options.mode === "apply") {
      lockPath = join(directory, RETENTION_LOCK_NAME);
      try {
        lockHandle = await dependencies.open(lockPath, "wx", 0o600);
        await dependencies.chmod(lockPath, 0o600).catch(() => undefined);
      } catch (cause) {
        throw maintenanceError(
          "BACKUP_RETENTION_IN_PROGRESS_OR_INTERRUPTED",
          "A retention operation is active or its operation lock requires inspection.",
          cause,
        );
      }
      await dependencies.afterLockAcquired?.();
    }
    inventory = await discoverBackupArtifacts(directory, dependencies);
    if (options.mode === "apply")
      inventory = Object.freeze({
        ...inventory,
        scannedEntryCount: Math.max(0, inventory.scannedEntryCount - 1),
        invalidEntryCount: Math.max(0, inventory.invalidEntryCount - 1),
      });
    const selection = selectBackupRetentionCandidates(inventory.validPairs, {
      maxAgeDays: options.maxAgeDays,
      keepLatest: options.keepLatest,
      now: startedAt,
    });
    const eligibleByteCount = calculateBackupPairByteTotal(selection.eligible);
    if (options.mode === "apply") {
      for (const pair of selection.eligible) {
        await deleteOwnedPair(pair, inventory.directory, dependencies);
        deletedPairCount += 1;
        deletedByteCount = checkedByteAddition(
          deletedByteCount,
          calculateBackupPairByteTotal([pair]),
        );
      }
    }
    const durationMs = Math.max(
      0,
      dependencies.now().valueOf() - startedAt.valueOf(),
    );
    const result: BackupRetentionResult = Object.freeze({
      formatVersion: 1,
      mode: options.mode,
      status: "ok",
      scannedEntryCount: inventory.scannedEntryCount,
      validPairCount: inventory.validPairs.length,
      invalidEntryCount: inventory.invalidEntryCount,
      incompletePairCount: inventory.incompletePairCount,
      retainedByAgeCount: selection.retainedByAge.length,
      retainedByKeepLatestCount: selection.retainedByKeepLatest.length,
      eligiblePairCount: selection.eligible.length,
      deletedPairCount,
      eligibleByteCount,
      deletedByteCount,
      durationMs,
    });
    return result;
  } catch (cause) {
    operationError = cause;
    throw cause instanceof Error && cause.name === "DatabaseMaintenanceError"
      ? cause
      : maintenanceError(
          "BACKUP_RETENTION_FAILED",
          "Backup retention failed safely.",
          cause,
        );
  } finally {
    if (lockPath && lockHandle) {
      const cleaned = await cleanupLock(lockPath, lockHandle, dependencies);
      lockHandle = undefined;
      if (!cleaned && operationError === undefined)
        throw maintenanceError(
          "BACKUP_RETENTION_LOCK_CLEANUP_FAILED",
          "Retention completed, but operation-lock cleanup failed safely.",
        );
    }
  }
}
