import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  copyFile,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  unlink,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { createDatabaseBackup, type CreatedBackup } from "./backup-service";
import {
  sha256File,
  validateBackupPair,
  validateSqliteDatabase,
  type SqliteBackupMetadata,
  type ValidatedBackup,
} from "./backup-validation";
import { maintenanceError } from "./maintenance-error";

export type RestoreDatabaseOptions = Readonly<{
  manifestPath: string;
  databasePath: string;
  dryRun?: boolean;
  replace?: boolean;
  confirmOffline?: boolean;
  preRestoreBackupDirectory?: string;
}>;

export type RestoreDatabaseResult = Readonly<{
  dryRun: boolean;
  replaced: boolean;
  databaseBytes: number;
  databaseSha256: string;
  migrationCount: number;
  preRestoreBackup?: CreatedBackup;
}>;

export type RestoreDependencies = Readonly<{
  validateBackupPair: typeof validateBackupPair;
  validateDatabase: typeof validateSqliteDatabase;
  createBackup: typeof createDatabaseBackup;
  copyFile: typeof copyFile;
  link: typeof link;
  open: typeof open;
  unlink: typeof unlink;
  beforeCandidatePublication?: () => void | Promise<void>;
  afterOriginalMoved?: () => void | Promise<void>;
  afterReplacement?: () => void | Promise<void>;
}>;

const defaultDependencies: RestoreDependencies = {
  validateBackupPair,
  validateDatabase: validateSqliteDatabase,
  createBackup: createDatabaseBackup,
  copyFile,
  link,
  open,
  unlink,
};

type FileIdentity = Readonly<{ dev: number; ino: number }>;

function sameIdentity(first: FileIdentity, second: FileIdentity): boolean {
  return first.dev === second.dev && first.ino === second.ino;
}

async function inspectDestination(path: string) {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink())
      throw maintenanceError(
        "RESTORE_DESTINATION_SYMLINK",
        "Restore destination symlinks are not allowed.",
      );
    if (!stats.isFile())
      throw maintenanceError(
        "RESTORE_DESTINATION_INVALID",
        "Restore destination must be a regular file.",
      );
    return stats;
  } catch (cause) {
    if (cause instanceof Error && cause.name === "DatabaseMaintenanceError")
      throw cause;
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw maintenanceError(
      "RESTORE_DESTINATION_INSPECTION_FAILED",
      "Restore destination could not be inspected.",
      cause,
    );
  }
}

function assertDestinationName(path: string): void {
  const name = basename(path);
  if (
    name.length === 0 ||
    name.includes("\0") ||
    name.endsWith("-wal") ||
    name.endsWith("-shm") ||
    name.endsWith(".manifest.json")
  )
    throw maintenanceError(
      "RESTORE_DESTINATION_UNSAFE",
      "Restore destination path is unsafe.",
    );
}

async function canonicalizeDestinationPath(
  input: string,
  createParent: boolean,
): Promise<string> {
  const resolved = resolve(input);
  const parent = dirname(resolved);
  if (createParent) await mkdir(parent, { recursive: true, mode: 0o700 });
  try {
    const canonicalParent = await realpath(parent);
    const stats = await lstat(canonicalParent);
    if (!stats.isDirectory()) throw new Error("not-directory");
    return join(canonicalParent, basename(resolved));
  } catch (cause) {
    if (!createParent && (cause as NodeJS.ErrnoException).code === "ENOENT")
      return resolved;
    throw maintenanceError(
      "RESTORE_DESTINATION_DIRECTORY_INVALID",
      "Restore destination directory is unsafe.",
      cause,
    );
  }
}

async function assertDistinctSourceAndDestination(
  backup: ValidatedBackup,
  destinationPath: string,
  destinationIdentity: FileIdentity | undefined,
) {
  if (
    destinationPath === backup.databasePath ||
    destinationPath === backup.manifestPath ||
    destinationPath === `${backup.databasePath}-wal` ||
    destinationPath === `${backup.databasePath}-shm`
  )
    throw maintenanceError(
      "RESTORE_SOURCE_DESTINATION_SAME",
      "Restore source and destination must be different files.",
    );
  if (!destinationIdentity) return;
  const [databaseStats, manifestStats] = await Promise.all([
    lstat(backup.databasePath),
    lstat(backup.manifestPath),
  ]);
  if (
    sameIdentity(databaseStats, destinationIdentity) ||
    sameIdentity(manifestStats, destinationIdentity)
  )
    throw maintenanceError(
      "RESTORE_SOURCE_DESTINATION_SAME",
      "Restore source and destination must be different files.",
    );
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
    return (cause as NodeJS.ErrnoException).code === "ENOENT";
  }
}

async function moveSidecarIfPresent(
  source: string,
  target: string,
  dependencies: RestoreDependencies,
): Promise<FileIdentity | undefined> {
  try {
    const stats = await lstat(source);
    if (stats.isSymbolicLink() || !stats.isFile())
      throw maintenanceError(
        "RESTORE_SIDECAR_INVALID",
        "Existing SQLite sidecar is unsafe.",
      );
    await moveFileExclusive(source, target, stats, dependencies);
    return stats;
  } catch (cause) {
    if (cause instanceof Error && cause.name === "DatabaseMaintenanceError")
      throw cause;
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw cause;
  }
}

async function moveFileExclusive(
  source: string,
  target: string,
  identity: FileIdentity,
  dependencies: RestoreDependencies,
): Promise<void> {
  await dependencies.link(source, target);
  if (await unlinkOwned(source, identity, dependencies.unlink)) return;
  await unlinkOwned(target, identity, dependencies.unlink);
  throw maintenanceError(
    "RESTORE_MOVE_FAILED",
    "Restore could not move an owned file safely.",
  );
}

async function assertNoRestoreResidue(destinationPath: string): Promise<void> {
  const prefix = `.${basename(destinationPath)}.`;
  const names = await readdir(dirname(destinationPath));
  if (
    names.some(
      (name) =>
        name.startsWith(prefix) &&
        (name.includes(".rollback") ||
          name.endsWith(".restore-candidate") ||
          name.includes(".sidecar-snapshot-")),
    )
  )
    throw maintenanceError(
      "RESTORE_RESIDUE_PRESENT",
      "A prior restore left recovery files; inspect them before retrying.",
    );
}

type SidecarSnapshot = Readonly<{
  sidecarPath: string;
  snapshotPath?: string;
  snapshotIdentity?: FileIdentity;
}>;

async function snapshotSidecars(
  destinationPath: string,
  dependencies: RestoreDependencies,
): Promise<SidecarSnapshot[]> {
  const suffix = randomUUID();
  const snapshots: SidecarSnapshot[] = [];
  try {
    for (const extension of ["wal", "shm"] as const) {
      const sidecarPath = `${destinationPath}-${extension}`;
      try {
        const stats = await lstat(sidecarPath);
        if (stats.isSymbolicLink() || !stats.isFile())
          throw maintenanceError(
            "RESTORE_SIDECAR_INVALID",
            "Existing SQLite sidecar is unsafe.",
          );
        const snapshotPath = join(
          dirname(destinationPath),
          `.${basename(destinationPath)}.${suffix}.sidecar-snapshot-${extension}`,
        );
        await dependencies.copyFile(
          sidecarPath,
          snapshotPath,
          constants.COPYFILE_EXCL,
        );
        await chmod(snapshotPath, 0o600).catch(() => undefined);
        const snapshotIdentity = await lstat(snapshotPath);
        snapshots.push({ sidecarPath, snapshotPath, snapshotIdentity });
      } catch (cause) {
        if (cause instanceof Error && cause.name === "DatabaseMaintenanceError")
          throw cause;
        if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
          snapshots.push({ sidecarPath });
          continue;
        }
        throw cause;
      }
    }
    return snapshots;
  } catch (cause) {
    for (const snapshot of snapshots)
      if (snapshot.snapshotPath)
        await unlinkOwned(
          snapshot.snapshotPath,
          snapshot.snapshotIdentity,
          dependencies.unlink,
        );
    throw cause;
  }
}

async function restoreSidecarSnapshots(
  snapshots: readonly SidecarSnapshot[],
  dependencies: RestoreDependencies,
): Promise<void> {
  for (const snapshot of snapshots) {
    let current;
    try {
      current = await lstat(snapshot.sidecarPath);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    }
    if (current) {
      if (current.isSymbolicLink() || !current.isFile())
        throw maintenanceError(
          "RESTORE_SIDECAR_CHANGED",
          "SQLite sidecar changed unsafely during the safety backup.",
        );
      await dependencies.unlink(snapshot.sidecarPath);
    }
    if (snapshot.snapshotPath && snapshot.snapshotIdentity) {
      await dependencies.link(snapshot.snapshotPath, snapshot.sidecarPath);
      if (
        !(await unlinkOwned(
          snapshot.snapshotPath,
          snapshot.snapshotIdentity,
          dependencies.unlink,
        ))
      )
        throw maintenanceError(
          "RESTORE_SIDECAR_SNAPSHOT_CLEANUP_FAILED",
          "SQLite sidecar snapshot cleanup failed safely.",
        );
    }
  }
}

async function createValidatedPreRestoreBackup(
  destinationPath: string,
  outputDirectory: string,
  dependencies: RestoreDependencies,
): Promise<CreatedBackup> {
  const snapshots = await snapshotSidecars(destinationPath, dependencies);
  let operationError: unknown;
  let result: CreatedBackup | undefined;
  try {
    result = await dependencies.createBackup({
      databasePath: destinationPath,
      outputDirectory,
    });
    await dependencies.validateBackupPair(result.manifestPath);
  } catch (cause) {
    operationError = cause;
  }
  try {
    await restoreSidecarSnapshots(snapshots, dependencies);
  } catch (cause) {
    throw maintenanceError(
      "RESTORE_SIDECAR_PRESERVATION_FAILED",
      "Original SQLite sidecars could not be preserved safely.",
      cause,
    );
  }
  if (operationError !== undefined) throw operationError;
  return result!;
}

async function installNewDatabase(
  candidatePath: string,
  candidateIdentity: FileIdentity,
  destinationPath: string,
  backup: ValidatedBackup,
  dependencies: RestoreDependencies,
): Promise<void> {
  let installed = false;
  try {
    await dependencies.beforeCandidatePublication?.();
    await dependencies.link(candidatePath, destinationPath);
    installed = true;
    if (
      !(await unlinkOwned(
        candidatePath,
        candidateIdentity,
        dependencies.unlink,
      ))
    )
      throw maintenanceError(
        "RESTORE_CANDIDATE_CLEANUP_FAILED",
        "Restore candidate cleanup failed safely.",
      );
    await dependencies.afterReplacement?.();
    await dependencies.validateDatabase(destinationPath);
    if ((await sha256File(destinationPath)) !== backup.manifest.databaseSha256)
      throw maintenanceError(
        "RESTORE_POST_HASH_MISMATCH",
        "Restored database hash verification failed.",
      );
  } catch (cause) {
    if (
      installed &&
      !(await unlinkOwned(
        destinationPath,
        candidateIdentity,
        dependencies.unlink,
      ))
    )
      throw maintenanceError(
        "RESTORE_NEW_DESTINATION_ROLLBACK_FAILED",
        "Failed new-destination restore could not be removed safely.",
        cause,
      );
    throw cause;
  }
}

async function replaceExistingDatabase(
  candidatePath: string,
  candidateIdentity: FileIdentity,
  destinationPath: string,
  expectedDestinationIdentity: FileIdentity,
  backup: ValidatedBackup,
  dependencies: RestoreDependencies,
): Promise<void> {
  const suffix = randomUUID();
  const rollbackPath = join(
    dirname(destinationPath),
    `.${basename(destinationPath)}.${suffix}.rollback`,
  );
  const rollbackWalPath = `${rollbackPath}-wal`;
  const rollbackShmPath = `${rollbackPath}-shm`;
  const destinationWalPath = `${destinationPath}-wal`;
  const destinationShmPath = `${destinationPath}-shm`;
  let originalMoved = false;
  let walIdentity: FileIdentity | undefined;
  let shmIdentity: FileIdentity | undefined;
  let candidateInstalled = false;
  let installationValidated = false;

  try {
    const currentDestination = await inspectDestination(destinationPath);
    if (
      !currentDestination ||
      !sameIdentity(currentDestination, expectedDestinationIdentity)
    )
      throw maintenanceError(
        "RESTORE_DESTINATION_CHANGED",
        "Restore destination changed before replacement.",
      );
    await moveFileExclusive(
      destinationPath,
      rollbackPath,
      expectedDestinationIdentity,
      dependencies,
    );
    originalMoved = true;
    await dependencies.afterOriginalMoved?.();
    walIdentity = await moveSidecarIfPresent(
      destinationWalPath,
      rollbackWalPath,
      dependencies,
    );
    shmIdentity = await moveSidecarIfPresent(
      destinationShmPath,
      rollbackShmPath,
      dependencies,
    );
    await dependencies.beforeCandidatePublication?.();
    await dependencies.link(candidatePath, destinationPath);
    candidateInstalled = true;
    if (
      !(await unlinkOwned(
        candidatePath,
        candidateIdentity,
        dependencies.unlink,
      ))
    )
      throw maintenanceError(
        "RESTORE_CANDIDATE_CLEANUP_FAILED",
        "Restore candidate cleanup failed safely.",
      );
    await dependencies.afterReplacement?.();
    await dependencies.validateDatabase(destinationPath);
    if ((await sha256File(destinationPath)) !== backup.manifest.databaseSha256)
      throw maintenanceError(
        "RESTORE_POST_HASH_MISMATCH",
        "Restored database hash verification failed.",
      );
    installationValidated = true;

    for (const [path, identity] of [
      [rollbackWalPath, walIdentity],
      [rollbackShmPath, shmIdentity],
      [rollbackPath, expectedDestinationIdentity],
    ] as const) {
      if (identity && !(await unlinkOwned(path, identity, dependencies.unlink)))
        throw maintenanceError(
          "RESTORE_ROLLBACK_CLEANUP_FAILED",
          "Restored database is valid, but recovery-file cleanup is incomplete.",
        );
    }
    originalMoved = false;
    walIdentity = undefined;
    shmIdentity = undefined;
  } catch (cause) {
    if (installationValidated) throw cause;

    const rollbackFailures: unknown[] = [];
    if (
      candidateInstalled &&
      !(await unlinkOwned(
        destinationPath,
        candidateIdentity,
        dependencies.unlink,
      ))
    )
      rollbackFailures.push("candidate");
    if (originalMoved) {
      try {
        await moveFileExclusive(
          rollbackPath,
          destinationPath,
          expectedDestinationIdentity,
          dependencies,
        );
        originalMoved = false;
      } catch {
        rollbackFailures.push("database");
      }
    }
    if (walIdentity) {
      try {
        await moveFileExclusive(
          rollbackWalPath,
          destinationWalPath,
          walIdentity,
          dependencies,
        );
        walIdentity = undefined;
      } catch {
        rollbackFailures.push("wal");
      }
    }
    if (shmIdentity) {
      try {
        await moveFileExclusive(
          rollbackShmPath,
          destinationShmPath,
          shmIdentity,
          dependencies,
        );
        shmIdentity = undefined;
      } catch {
        rollbackFailures.push("shm");
      }
    }
    if (rollbackFailures.length > 0)
      throw maintenanceError(
        "RESTORE_ROLLBACK_FAILED",
        "Restore rollback could not be completed; retained recovery files require manual inspection.",
        cause,
      );
    throw cause;
  }
}

async function assertPreRestoreDirectoryDistinct(
  directory: string,
  destinationPath: string,
  backup: ValidatedBackup,
): Promise<void> {
  const resolvedDirectory = resolve(directory);
  const canonicalDirectory = await realpath(resolvedDirectory).catch(
    () => resolvedDirectory,
  );
  if (
    canonicalDirectory === destinationPath ||
    canonicalDirectory === backup.databasePath ||
    canonicalDirectory === backup.manifestPath
  )
    throw maintenanceError(
      "RESTORE_PRE_BACKUP_DIRECTORY_UNSAFE",
      "Pre-restore backup directory conflicts with a database artifact.",
    );
}

export async function restoreDatabase(
  options: RestoreDatabaseOptions,
  dependencyOverrides: Partial<RestoreDependencies> = {},
): Promise<RestoreDatabaseResult> {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  const backup = await dependencies.validateBackupPair(options.manifestPath);
  let destinationPath = await canonicalizeDestinationPath(
    options.databasePath,
    false,
  );
  assertDestinationName(destinationPath);
  let destinationStats = await inspectDestination(destinationPath);
  const destinationExists = destinationStats !== undefined;
  await assertDistinctSourceAndDestination(
    backup,
    destinationPath,
    destinationStats,
  );

  if (options.dryRun)
    return {
      dryRun: true,
      replaced: destinationExists,
      databaseBytes: backup.manifest.databaseBytes,
      databaseSha256: backup.manifest.databaseSha256,
      migrationCount: backup.manifest.migrationCount,
    };

  if (!options.confirmOffline)
    throw maintenanceError(
      "RESTORE_OFFLINE_CONFIRMATION_REQUIRED",
      "Write restore requires --confirm-offline.",
    );
  if (destinationExists && !options.replace)
    throw maintenanceError(
      "RESTORE_REPLACE_REQUIRED",
      "Existing destination requires --replace.",
    );

  destinationPath = await canonicalizeDestinationPath(
    options.databasePath,
    true,
  );
  const stateAfterParentCreation = await inspectDestination(destinationPath);
  if (
    (destinationStats === undefined) !==
      (stateAfterParentCreation === undefined) ||
    (destinationStats &&
      stateAfterParentCreation &&
      !sameIdentity(destinationStats, stateAfterParentCreation))
  )
    throw maintenanceError(
      "RESTORE_DESTINATION_CHANGED",
      "Restore destination changed during preflight.",
    );
  destinationStats = stateAfterParentCreation;
  await assertDistinctSourceAndDestination(
    backup,
    destinationPath,
    destinationStats,
  );

  const destinationDirectory = dirname(destinationPath);
  const lockPath = join(
    destinationDirectory,
    `.${basename(destinationPath)}.restore.lock`,
  );
  let lockHandle: Awaited<ReturnType<typeof open>> | undefined;
  let lockIdentity: FileIdentity | undefined;
  let candidatePath: string | undefined;
  let candidateIdentity: FileIdentity | undefined;
  let preRestoreBackup: CreatedBackup | undefined;

  try {
    try {
      lockHandle = await dependencies.open(lockPath, "wx", 0o600);
      lockIdentity = await lockHandle.stat();
    } catch (cause) {
      throw maintenanceError(
        "RESTORE_IN_PROGRESS_OR_INTERRUPTED",
        "A restore is already active or a prior restore was interrupted.",
        cause,
      );
    }
    await assertNoRestoreResidue(destinationPath);

    if (destinationStats) {
      const preRestoreDirectory = resolve(
        options.preRestoreBackupDirectory ??
          join(destinationDirectory, "pre-restore-backups"),
      );
      await assertPreRestoreDirectoryDistinct(
        preRestoreDirectory,
        destinationPath,
        backup,
      );
      preRestoreBackup = await createValidatedPreRestoreBackup(
        destinationPath,
        preRestoreDirectory,
        dependencies,
      );
      const destinationAfterBackup = await inspectDestination(destinationPath);
      if (
        !destinationAfterBackup ||
        !sameIdentity(destinationStats, destinationAfterBackup)
      )
        throw maintenanceError(
          "RESTORE_DESTINATION_CHANGED",
          "Restore destination changed while its safety backup was created.",
        );
      destinationStats = destinationAfterBackup;
    }

    candidatePath = join(
      destinationDirectory,
      `.${basename(destinationPath)}.${randomUUID()}.restore-candidate`,
    );
    await dependencies.copyFile(
      backup.databasePath,
      candidatePath,
      constants.COPYFILE_EXCL,
    );
    await chmod(candidatePath, 0o600).catch(() => undefined);
    candidateIdentity = await lstat(candidatePath);
    const candidateMetadata: SqliteBackupMetadata =
      await dependencies.validateDatabase(candidatePath);
    if (
      candidateMetadata.sqliteUserVersion !==
        backup.manifest.sqliteUserVersion ||
      candidateMetadata.migrationCount !== backup.manifest.migrationCount ||
      candidateMetadata.latestMigrationHash !==
        backup.manifest.latestMigrationHash ||
      (await sha256File(candidatePath)) !== backup.manifest.databaseSha256
    )
      throw maintenanceError(
        "RESTORE_CANDIDATE_INVALID",
        "Restore candidate validation failed.",
      );

    if (destinationStats)
      await replaceExistingDatabase(
        candidatePath,
        candidateIdentity,
        destinationPath,
        destinationStats,
        backup,
        dependencies,
      );
    else
      await installNewDatabase(
        candidatePath,
        candidateIdentity,
        destinationPath,
        backup,
        dependencies,
      );
    await lockHandle.close();
    lockHandle = undefined;
    if (!(await unlinkOwned(lockPath, lockIdentity, dependencies.unlink)))
      throw maintenanceError(
        "RESTORE_LOCK_CLEANUP_FAILED",
        "Restored database is valid, but restore-lock cleanup is incomplete.",
      );
    lockIdentity = undefined;
    return {
      dryRun: false,
      replaced: destinationExists,
      databaseBytes: backup.manifest.databaseBytes,
      databaseSha256: backup.manifest.databaseSha256,
      migrationCount: backup.manifest.migrationCount,
      preRestoreBackup,
    };
  } catch (cause) {
    if (cause instanceof Error && cause.name === "DatabaseMaintenanceError")
      throw cause;
    throw maintenanceError(
      "RESTORE_FAILED",
      "Database restore failed safely; inspect retained safety artifacts before retrying.",
      cause,
    );
  } finally {
    if (candidatePath)
      await unlinkOwned(candidatePath, candidateIdentity, dependencies.unlink);
    await lockHandle?.close().catch(() => undefined);
    await unlinkOwned(lockPath, lockIdentity, dependencies.unlink);
  }
}
