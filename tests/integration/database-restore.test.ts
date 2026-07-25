import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  copyFile as nodeCopyFile,
  readFile,
  realpath,
  rename as nodeRename,
} from "node:fs/promises";
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import Database from "better-sqlite3";
import { createDatabaseBackup } from "@/infrastructure/db/maintenance/backup-service";
import {
  validateBackupPair,
  validateSqliteDatabase,
} from "@/infrastructure/db/maintenance/backup-validation";
import { maintenanceError } from "@/infrastructure/db/maintenance/maintenance-error";
import { restoreDatabase } from "@/infrastructure/db/maintenance/restore-service";
import {
  createMigratedDatabase,
  readMarkerIds,
  removeTemporaryDirectory,
  temporaryDatabaseDirectory,
} from "../helpers/database-maintenance";

describe("offline database restore", () => {
  let directory: string;
  let sourcePath: string;
  let manifestPath: string;
  let backupDatabasePath: string;
  let destinationPath: string;
  let preRestorePath: string;

  beforeEach(async () => {
    directory = temporaryDatabaseDirectory();
    sourcePath = join(directory, "source.db");
    destinationPath = join(directory, "destination", "restored.db");
    preRestorePath = join(directory, "safety-backups");
    const source = createMigratedDatabase(sourcePath, "selected-backup-marker");
    const backup = await createDatabaseBackup({
      databasePath: sourcePath,
      outputDirectory: join(directory, "backup"),
      name: "selected",
    });
    manifestPath = backup.manifestPath;
    backupDatabasePath = backup.databasePath;
    source.close();
  });

  afterEach(() => removeTemporaryDirectory(directory));

  function createDestination(marker = "original-destination-marker") {
    const database = createMigratedDatabase(destinationPath, marker);
    database.close();
  }

  function restore(overrides = {}) {
    return restoreDatabase({
      manifestPath,
      databasePath: destinationPath,
      confirmOffline: true,
      preRestoreBackupDirectory: preRestorePath,
      ...overrides,
    });
  }

  it("dry-run validates everything available and changes nothing", async () => {
    const before = readdirSync(directory).sort();
    const result = await restoreDatabase({
      manifestPath,
      databasePath: destinationPath,
      dryRun: true,
    });
    expect(result.dryRun).toBe(true);
    expect(existsSync(destinationPath)).toBe(false);
    expect(readdirSync(directory).sort()).toEqual(before);
  });

  it("dry-run does not inspect or create SQLite sidecars for an existing destination", async () => {
    createDestination();
    const manifestBefore = statSync(manifestPath);
    const databaseBefore = statSync(backupDatabasePath);
    const destinationFilesBefore = readdirSync(dirname(destinationPath)).sort();
    await restoreDatabase({
      manifestPath,
      databasePath: destinationPath,
      dryRun: true,
    });
    expect(readdirSync(dirname(destinationPath)).sort()).toEqual(
      destinationFilesBefore,
    );
    expect(existsSync(`${destinationPath}-wal`)).toBe(false);
    expect(existsSync(`${destinationPath}-shm`)).toBe(false);
    expect(statSync(manifestPath).mtimeMs).toBe(manifestBefore.mtimeMs);
    expect(statSync(backupDatabasePath).mtimeMs).toBe(databaseBefore.mtimeMs);
  });

  it("creates a new database only with offline confirmation", async () => {
    const result = await restore();
    expect(result.replaced).toBe(false);
    expect(readMarkerIds(destinationPath)).toEqual(["selected-backup-marker"]);
    expect(await readFile(destinationPath)).toEqual(
      await readFile(backupDatabasePath),
    );
  });

  it("requires offline confirmation for a new database", async () => {
    await expect(
      restoreDatabase({ manifestPath, databasePath: destinationPath }),
    ).rejects.toThrow(/confirm-offline/);
    expect(existsSync(destinationPath)).toBe(false);
  });

  it("requires both --replace and offline confirmation for an existing database", async () => {
    createDestination();
    const original = readFileSync(destinationPath);
    await expect(
      restoreDatabase({
        manifestPath,
        databasePath: destinationPath,
        confirmOffline: true,
      }),
    ).rejects.toThrow(/--replace/);
    await expect(
      restoreDatabase({
        manifestPath,
        databasePath: destinationPath,
        replace: true,
      }),
    ).rejects.toThrow(/confirm-offline/);
    expect(readFileSync(destinationPath)).toEqual(original);
  });

  it("replaces rows and retains a validated pre-restore backup", async () => {
    createDestination();
    const result = await restore({ replace: true });
    expect(result.replaced).toBe(true);
    expect(readMarkerIds(destinationPath)).toEqual(["selected-backup-marker"]);
    expect(result.preRestoreBackup).toBeDefined();
    const safety = await validateBackupPair(
      result.preRestoreBackup!.manifestPath,
    );
    expect(readdirSync(preRestorePath)).toHaveLength(2);
    expect(readMarkerIds(safety.databasePath)).toEqual([
      "original-destination-marker",
    ]);
  });

  it("does not promote backup or old destination WAL/SHM sidecars", async () => {
    createDestination();
    writeFileSync(`${destinationPath}-wal`, "stale-wal");
    writeFileSync(`${destinationPath}-shm`, "stale-shm");
    await restore({ replace: true });
    expect(existsSync(`${destinationPath}-wal`)).toBe(false);
    expect(existsSync(`${destinationPath}-shm`)).toBe(false);
    expect(existsSync(`${backupDatabasePath}-wal`)).toBe(false);
    expect(existsSync(`${backupDatabasePath}-shm`)).toBe(false);
  });

  it("never applies migrations during restore", async () => {
    const database = new Database(backupDatabasePath);
    database
      .prepare(
        "delete from __drizzle_migrations where rowid = (select max(rowid) from __drizzle_migrations)",
      )
      .run();
    const count = (
      database
        .prepare("select count(*) as count from __drizzle_migrations")
        .get() as {
        count: number;
      }
    ).count;
    database.close();
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.databaseBytes = readFileSync(backupDatabasePath).byteLength;
    manifest.databaseSha256 =
      await import("@/infrastructure/db/maintenance/backup-validation").then(
        ({ sha256File }) => sha256File(backupDatabasePath),
      );
    manifest.migrationCount = count;
    const metadata = await validateSqliteDatabase(backupDatabasePath);
    manifest.latestMigrationHash = metadata.latestMigrationHash;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await restore();
    expect((await validateSqliteDatabase(destinationPath)).migrationCount).toBe(
      6,
    );
  });

  it("rejects source and destination identity by path and inode", async () => {
    await expect(
      restoreDatabase({
        manifestPath,
        databasePath: backupDatabasePath,
        confirmOffline: true,
        replace: true,
      }),
    ).rejects.toThrow(/different files/);
    expect(await validateBackupPair(manifestPath)).toBeDefined();

    mkdirSync(dirname(destinationPath), { recursive: true });
    linkSync(backupDatabasePath, destinationPath);
    await expect(restore({ replace: true })).rejects.toThrow(/different files/);
    expect(readFileSync(backupDatabasePath)).toEqual(
      readFileSync(destinationPath),
    );
  });

  it("rejects destination identity with the selected manifest inode", async () => {
    mkdirSync(dirname(destinationPath), { recursive: true });
    linkSync(manifestPath, destinationPath);
    await expect(restore({ replace: true })).rejects.toThrow(/different files/);
    expect(readFileSync(manifestPath)).toEqual(readFileSync(destinationPath));
  });

  it("rejects destination symlinks", async () => {
    if (process.platform === "win32") return;
    createDestination();
    const real = join(directory, "real-destination.db");
    await nodeRename(destinationPath, real);
    symlinkSync(real, destinationPath);
    const original = readFileSync(real);
    await expect(restore({ replace: true })).rejects.toThrow(/symlink/i);
    expect(readFileSync(real)).toEqual(original);
  });

  it("corrupted backup never changes an existing destination", async () => {
    createDestination();
    const original = readFileSync(destinationPath);
    writeFileSync(backupDatabasePath, "corrupted selected backup");
    await expect(restore({ replace: true })).rejects.toThrow();
    expect(readFileSync(destinationPath)).toEqual(original);
    expect(existsSync(preRestorePath)).toBe(false);
  });

  it("preserves exact original bytes when pre-restore backup creation fails", async () => {
    createDestination();
    const original = readFileSync(destinationPath);
    await expect(
      restoreDatabase(
        {
          manifestPath,
          databasePath: destinationPath,
          replace: true,
          confirmOffline: true,
          preRestoreBackupDirectory: preRestorePath,
        },
        {
          createBackup: async () => {
            throw maintenanceError(
              "INJECTED",
              "Pre-restore backup failed safely.",
            );
          },
        },
      ),
    ).rejects.toThrow(/Pre-restore backup failed safely/);
    expect(readFileSync(destinationPath)).toEqual(original);
  });

  it("preserves exact original bytes when candidate creation fails", async () => {
    createDestination();
    const original = readFileSync(destinationPath);
    await expect(
      restoreDatabase(
        {
          manifestPath,
          databasePath: destinationPath,
          replace: true,
          confirmOffline: true,
          preRestoreBackupDirectory: preRestorePath,
        },
        {
          copyFile: async () =>
            Promise.reject(new Error("private row content")),
        },
      ),
    ).rejects.toThrow(/failed safely/i);
    expect(readFileSync(destinationPath)).toEqual(original);
    expect(
      readdirSync(dirname(destinationPath)).some((name) =>
        name.includes("candidate"),
      ),
    ).toBe(false);
  });

  it("preserves exact original bytes when candidate validation fails", async () => {
    createDestination();
    const original = readFileSync(destinationPath);
    await expect(
      restoreDatabase(
        {
          manifestPath,
          databasePath: destinationPath,
          replace: true,
          confirmOffline: true,
          preRestoreBackupDirectory: preRestorePath,
        },
        {
          validateDatabase: async (path) => {
            if (path.includes("restore-candidate"))
              throw maintenanceError(
                "INJECTED",
                "Candidate validation failed safely.",
              );
            return validateSqliteDatabase(path);
          },
        },
      ),
    ).rejects.toThrow(/Candidate validation failed safely/);
    expect(readFileSync(destinationPath)).toEqual(original);
  });

  it("rolls back exact bytes after replacement failure", async () => {
    createDestination();
    const original = readFileSync(destinationPath);
    await expect(
      restoreDatabase(
        {
          manifestPath,
          databasePath: destinationPath,
          replace: true,
          confirmOffline: true,
          preRestoreBackupDirectory: preRestorePath,
        },
        {
          afterOriginalMoved: () => {
            throw new Error("replacement boundary failed");
          },
        },
      ),
    ).rejects.toThrow(/failed safely/i);
    expect(readFileSync(destinationPath)).toEqual(original);
    expect(
      readdirSync(dirname(destinationPath)).some((name) =>
        /rollback|candidate/.test(name),
      ),
    ).toBe(false);
    expect(readdirSync(preRestorePath)).toHaveLength(2);
  });

  it("rolls back exact bytes after post-replacement validation failure", async () => {
    createDestination();
    const original = readFileSync(destinationPath);
    await expect(
      restoreDatabase(
        {
          manifestPath,
          databasePath: destinationPath,
          replace: true,
          confirmOffline: true,
          preRestoreBackupDirectory: preRestorePath,
        },
        {
          validateDatabase: async (path) => {
            if (
              path.endsWith(`/${basename(destinationPath)}`) &&
              !path.includes("restore-candidate")
            )
              throw maintenanceError(
                "INJECTED",
                "Post validation failed safely.",
              );
            return validateSqliteDatabase(path);
          },
        },
      ),
    ).rejects.toThrow(/Post validation failed safely/);
    expect(readFileSync(destinationPath)).toEqual(original);
    expect(readMarkerIds(destinationPath)).toEqual([
      "original-destination-marker",
    ]);
    expect(
      readdirSync(dirname(destinationPath)).some((name) =>
        /rollback|candidate/.test(name),
      ),
    ).toBe(false);
  });

  it("restores exact original database and sidecar bytes after installation failure", async () => {
    createDestination();
    writeFileSync(`${destinationPath}-wal`, "exact-original-wal-sentinel");
    writeFileSync(`${destinationPath}-shm`, "exact-original-shm-sentinel");
    const originals = [
      readFileSync(destinationPath),
      readFileSync(`${destinationPath}-wal`),
      readFileSync(`${destinationPath}-shm`),
    ];
    await expect(
      restoreDatabase(
        {
          manifestPath,
          databasePath: destinationPath,
          replace: true,
          confirmOffline: true,
          preRestoreBackupDirectory: preRestorePath,
        },
        {
          afterReplacement: () => {
            throw new Error("synthetic installed failure");
          },
        },
      ),
    ).rejects.toThrow(/failed safely/i);
    expect(readFileSync(destinationPath)).toEqual(originals[0]);
    expect(readFileSync(`${destinationPath}-wal`)).toEqual(originals[1]);
    expect(readFileSync(`${destinationPath}-shm`)).toEqual(originals[2]);
  });

  it("does not overwrite a destination that appears before final publication", async () => {
    const appearedBytes = Buffer.from("race-created-destination");
    await expect(
      restoreDatabase(
        {
          manifestPath,
          databasePath: destinationPath,
          confirmOffline: true,
        },
        {
          beforeCandidatePublication: () => {
            writeFileSync(destinationPath, appearedBytes);
          },
        },
      ),
    ).rejects.toThrow(/failed safely/i);
    expect(readFileSync(destinationPath)).toEqual(appearedBytes);
    expect(
      readdirSync(dirname(destinationPath)).some((name) =>
        name.includes("restore-candidate"),
      ),
    ).toBe(false);
  });

  it("removes a new destination after post-install failure", async () => {
    await expect(
      restoreDatabase(
        {
          manifestPath,
          databasePath: destinationPath,
          confirmOffline: true,
        },
        {
          afterReplacement: () => {
            throw new Error("synthetic new-destination post-install failure");
          },
        },
      ),
    ).rejects.toThrow(/failed safely/i);
    expect(existsSync(destinationPath)).toBe(false);
  });

  it("pre-restore backup includes committed uncheckpointed WAL data", async () => {
    createDestination();
    const live = new Database(destinationPath);
    live.pragma("wal_autocheckpoint = 0");
    live
      .prepare(
        "insert into analysis_sessions (id,title,mode,status,created_at,updated_at) values (?,?, 'transcript_lab','draft',?,?)",
      )
      .run("pre-backup-wal-marker", "pre-backup-wal-marker", 1, 1);
    try {
      await expect(
        restoreDatabase(
          {
            manifestPath,
            databasePath: destinationPath,
            replace: true,
            confirmOffline: true,
            preRestoreBackupDirectory: preRestorePath,
          },
          {
            copyFile: async (source, destination, mode) => {
              if (destination.toString().includes("restore-candidate"))
                throw new Error("stop after pre-restore backup");
              return nodeCopyFile(source, destination, mode);
            },
          },
        ),
      ).rejects.toThrow(/failed safely/i);
    } finally {
      live.close();
    }
    const safetyManifest = readdirSync(preRestorePath).find((name) =>
      name.endsWith(".manifest.json"),
    );
    expect(safetyManifest).toBeDefined();
    const safety = await validateBackupPair(
      join(preRestorePath, safetyManifest!),
    );
    expect(readMarkerIds(safety.databasePath)).toEqual([
      "original-destination-marker",
      "pre-backup-wal-marker",
    ]);
  });

  it("rejects a pre-restore backup directory that is the destination file", async () => {
    createDestination();
    const original = readFileSync(destinationPath);
    await expect(
      restore({
        replace: true,
        preRestoreBackupDirectory: destinationPath,
      }),
    ).rejects.toThrow(/conflicts/i);
    expect(readFileSync(destinationPath)).toEqual(original);
  });

  it("fails closed when prior recovery residue or lock is present", async () => {
    mkdirSync(dirname(destinationPath), { recursive: true });
    const residue = join(
      dirname(destinationPath),
      `.${basename(destinationPath)}.prior.rollback`,
    );
    writeFileSync(residue, "retained-recovery-sentinel");
    await expect(restore()).rejects.toThrow(/prior restore/i);
    expect(readFileSync(residue, "utf8")).toBe("retained-recovery-sentinel");
    unlinkSync(residue);

    const lock = join(
      dirname(destinationPath),
      `.${basename(destinationPath)}.restore.lock`,
    );
    writeFileSync(lock, "interrupted-lock-sentinel");
    await expect(restore()).rejects.toThrow(/interrupted/i);
    expect(readFileSync(lock, "utf8")).toBe("interrupted-lock-sentinel");
  });

  it("creates the restore candidate in the destination directory", async () => {
    let candidateDirectory: string | undefined;
    await restoreDatabase(
      {
        manifestPath,
        databasePath: destinationPath,
        confirmOffline: true,
      },
      {
        copyFile: async (source, destination, mode) => {
          candidateDirectory = dirname(destination.toString());
          return nodeCopyFile(source, destination, mode);
        },
      },
    );
    expect(candidateDirectory).toBe(await realpath(dirname(destinationPath)));
  });

  it("keeps errors bounded and content-free", async () => {
    createDestination("never-print-this-sensitive-row");
    try {
      await restoreDatabase(
        {
          manifestPath,
          databasePath: destinationPath,
          replace: true,
          confirmOffline: true,
          preRestoreBackupDirectory: preRestorePath,
        },
        {
          afterReplacement: () => {
            throw new Error("never-print-this-sensitive-row");
          },
        },
      );
    } catch (error) {
      expect(String(error)).not.toContain("never-print-this-sensitive-row");
      expect(String(error).length).toBeLessThan(300);
    }
  });
});
