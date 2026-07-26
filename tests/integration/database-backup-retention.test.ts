import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import {
  link as nodeLink,
  open as nodeOpen,
  unlink as nodeUnlink,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createDatabaseBackup } from "@/infrastructure/db/maintenance/backup-service";
import { sha256File } from "@/infrastructure/db/maintenance/backup-validation";
import {
  applyBackupRetention,
  discoverBackupArtifacts,
} from "@/infrastructure/db/maintenance/retention-service";
import {
  createMigratedDatabase,
  removeTemporaryDirectory,
  temporaryDatabaseDirectory,
} from "../helpers/database-maintenance";

const fixedNow = new Date("2026-07-26T00:00:00.000Z");

describe("backup retention discovery and safe apply", () => {
  let root: string;
  let sourcePath: string;
  let backupDirectory: string;

  beforeEach(() => {
    root = temporaryDatabaseDirectory();
    sourcePath = join(root, "source.db");
    backupDirectory = join(root, "isolated-backups");
    mkdirSync(backupDirectory);
    const database = createMigratedDatabase(
      sourcePath,
      "private-content-must-never-appear",
    );
    database.close();
  });

  afterEach(() => removeTemporaryDirectory(root));

  async function pair(name: string, createdAt: string) {
    return createDatabaseBackup({
      databasePath: sourcePath,
      outputDirectory: backupDirectory,
      name,
      now: new Date(createdAt),
    });
  }

  async function eligiblePair() {
    const old = await pair("old", "2026-01-01T00:00:00.000Z");
    await pair("newest-protected", "2026-07-25T00:00:00.000Z");
    return old;
  }

  function retention(mode: "dry_run" | "apply" = "dry_run", overrides = {}) {
    return applyBackupRetention(
      {
        directory: backupDirectory,
        maxAgeDays: 30,
        keepLatest: 1,
        mode,
      },
      { now: () => fixedNow, ...overrides },
    );
  }

  it("handles an empty direct-child directory without mutation", async () => {
    const before = readdirSync(backupDirectory);
    const result = await retention();
    expect(result).toMatchObject({
      scannedEntryCount: 0,
      validPairCount: 0,
      eligiblePairCount: 0,
      deletedPairCount: 0,
    });
    expect(readdirSync(backupDirectory)).toEqual(before);
  });

  it("rejects missing, non-directory, and symlink directories", async () => {
    await expect(
      discoverBackupArtifacts(join(root, "missing")),
    ).rejects.toThrow(/unavailable or unsafe/);
    const file = join(root, "ordinary-file");
    writeFileSync(file, "not a directory");
    await expect(discoverBackupArtifacts(file)).rejects.toThrow(/unsafe/);
    if (process.platform !== "win32") {
      const link = join(root, "directory-link");
      symlinkSync(backupDirectory, link);
      await expect(discoverBackupArtifacts(link)).rejects.toThrow(/unsafe/);
    }
  });

  it("validates strict pairs and selects by manifest createdAt, not mtime", async () => {
    const oldest = await pair("oldest", "2026-01-01T00:00:00.000Z");
    await pair("middle", "2026-07-10T00:00:00.000Z");
    await pair("newest", "2026-07-25T00:00:00.000Z");
    const recentMtime = new Date("2026-07-26T00:00:00.000Z");
    const { utimesSync } = await import("node:fs");
    utimesSync(oldest.databasePath, recentMtime, recentMtime);
    utimesSync(oldest.manifestPath, recentMtime, recentMtime);
    const result = await retention();
    expect(result).toMatchObject({
      validPairCount: 3,
      retainedByKeepLatestCount: 1,
      retainedByAgeCount: 1,
      eligiblePairCount: 1,
      deletedPairCount: 0,
    });
    expect(existsSync(oldest.databasePath)).toBe(true);
  });

  it("uses a deterministic internal tie without exposing names", async () => {
    await pair("tie-a", "2026-01-01T00:00:00.000Z");
    await pair("tie-b", "2026-01-01T00:00:00.000Z");
    const first = await retention();
    const second = await retention();
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).not.toContain("tie-a");
    expect(JSON.stringify(first)).not.toContain("tie-b");
    expect(first.retainedByKeepLatestCount).toBe(1);
    expect(first.eligiblePairCount).toBe(1);
  });

  it("counts malformed, unsupported, mismatched, incomplete, unknown, symlink, special, and nested entries without deleting them", async () => {
    const malformed = await pair("malformed", "2026-01-01T00:00:00.000Z");
    writeFileSync(malformed.manifestPath, "{malformed-private-value");
    const unsupported = await pair("unsupported", "2026-01-02T00:00:00.000Z");
    const unsupportedManifest = JSON.parse(
      readFileSync(unsupported.manifestPath, "utf8"),
    );
    unsupportedManifest.formatVersion = 2;
    writeFileSync(
      unsupported.manifestPath,
      `${JSON.stringify(unsupportedManifest)}\n`,
    );
    const hashMismatch = await pair(
      "hash-mismatch",
      "2026-01-03T00:00:00.000Z",
    );
    writeFileSync(hashMismatch.databasePath, "corrupt-private-content");
    writeFileSync(join(backupDirectory, "database-only.sqlite"), "incomplete");
    writeFileSync(join(backupDirectory, "manifest-only.manifest.json"), "{}");
    writeFileSync(join(backupDirectory, "unknown-private-name.txt"), "unknown");
    writeFileSync(join(backupDirectory, "temporary.sqlite-wal"), "wal");
    writeFileSync(join(backupDirectory, ".temporary.lock"), "lock");
    const nested = join(backupDirectory, "nested");
    mkdirSync(nested);
    writeFileSync(join(nested, "nested.sqlite"), "must not be read");
    if (process.platform !== "win32") {
      symlinkSync(sourcePath, join(backupDirectory, "symlink.sqlite"));
      writeFileSync(join(backupDirectory, "symlink.manifest.json"), "{}");
      const fifoPath = join(backupDirectory, "fifo.sqlite");
      const fifo = spawnSync("mkfifo", [fifoPath]);
      if (fifo.status === 0)
        writeFileSync(join(backupDirectory, "fifo.manifest.json"), "{}");
    }
    const namesBefore = readdirSync(backupDirectory).sort();
    const result = await retention("apply");
    expect(result.validPairCount).toBe(0);
    expect(result.invalidEntryCount).toBeGreaterThanOrEqual(8);
    expect(result.incompletePairCount).toBe(2);
    expect(result.deletedPairCount).toBe(0);
    expect(readdirSync(backupDirectory).sort()).toEqual(namesBefore);
    expect(readdirSync(nested)).toEqual(["nested.sqlite"]);
  });

  it("counts byte-size mismatch, corrupt SQLite, and foreign-key-invalid pairs as invalid", async () => {
    const size = await pair("size", "2026-01-01T00:00:00.000Z");
    const sizeManifest = JSON.parse(readFileSync(size.manifestPath, "utf8"));
    sizeManifest.databaseBytes += 1;
    writeFileSync(size.manifestPath, `${JSON.stringify(sizeManifest)}\n`);

    const corrupt = await pair("corrupt", "2026-01-02T00:00:00.000Z");
    writeFileSync(corrupt.databasePath, Buffer.alloc(256, 7));
    const corruptManifest = JSON.parse(
      readFileSync(corrupt.manifestPath, "utf8"),
    );
    corruptManifest.databaseBytes = 256;
    corruptManifest.databaseSha256 = await sha256File(corrupt.databasePath);
    writeFileSync(corrupt.manifestPath, `${JSON.stringify(corruptManifest)}\n`);

    const foreignKey = await pair("foreign-key", "2026-01-03T00:00:00.000Z");
    const Database = (await import("better-sqlite3")).default;
    const database = new Database(foreignKey.databasePath);
    database.pragma("foreign_keys = OFF");
    database
      .prepare(
        "insert into interview_questions (id, session_id, sequence, question, competency, rationale, created_at) values ('orphan', 'missing', 1, 'private', 'private', 'private', 1)",
      )
      .run();
    database.close();
    const foreignManifest = JSON.parse(
      readFileSync(foreignKey.manifestPath, "utf8"),
    );
    foreignManifest.databaseBytes = lstatSync(foreignKey.databasePath).size;
    foreignManifest.databaseSha256 = await sha256File(foreignKey.databasePath);
    writeFileSync(
      foreignKey.manifestPath,
      `${JSON.stringify(foreignManifest)}\n`,
    );

    const result = await retention();
    expect(result.validPairCount).toBe(0);
    expect(result.invalidEntryCount).toBe(6);
    expect(result.deletedPairCount).toBe(0);
  });

  it("deletes exactly selected complete pairs and leaves no lock or recovery files", async () => {
    const old = await pair("old", "2026-01-01T00:00:00.000Z");
    const newest = await pair("newest", "2026-07-25T00:00:00.000Z");
    writeFileSync(join(backupDirectory, "unknown.txt"), "preserve");
    const result = await retention("apply");
    expect(result).toMatchObject({
      validPairCount: 2,
      eligiblePairCount: 1,
      deletedPairCount: 1,
    });
    expect(existsSync(old.databasePath)).toBe(false);
    expect(existsSync(old.manifestPath)).toBe(false);
    expect(existsSync(newest.databasePath)).toBe(true);
    expect(existsSync(newest.manifestPath)).toBe(true);
    expect(existsSync(join(backupDirectory, "unknown.txt"))).toBe(true);
    expect(
      readdirSync(backupDirectory).some((name) => name.startsWith(".")),
    ).toBe(false);
  });

  it("fails a concurrent losing operation without removing the active lock", async () => {
    await pair("old", "2026-01-01T00:00:00.000Z");
    let signalAcquired!: () => void;
    let release!: () => void;
    const acquired = new Promise<void>((resolve) => (signalAcquired = resolve));
    const blocked = new Promise<void>((resolve) => (release = resolve));
    const winner = retention("apply", {
      afterLockAcquired: async () => {
        signalAcquired();
        await blocked;
      },
    });
    await acquired;
    const lockPath = join(backupDirectory, ".intervaiew-retention.lock");
    expect(existsSync(lockPath)).toBe(true);
    await expect(retention("apply")).rejects.toThrow(/active|lock/);
    expect(existsSync(lockPath)).toBe(true);
    release();
    await winner;
    expect(existsSync(lockPath)).toBe(false);
  });

  it("fails closed on a pathname replacement after ownership open and preserves the replacement", async () => {
    const old = await eligiblePair();
    const displaced = join(root, "displaced-original.sqlite");
    await expect(
      retention("apply", {
        afterOwnershipOpen: () => {
          renameSync(old.databasePath, displaced);
          writeFileSync(old.databasePath, "replacement-private-value");
        },
      }),
    ).rejects.toThrow(/changed|failed safely/);
    expect(readFileSync(old.databasePath, "utf8")).toBe(
      "replacement-private-value",
    );
    expect(existsSync(displaced)).toBe(true);
    expect(existsSync(old.manifestPath)).toBe(true);
  });

  it("fails closed on a pathname replacement immediately before ownership open", async () => {
    const old = await eligiblePair();
    const displaced = join(root, "before-open-displaced.sqlite");
    let swapped = false;
    await expect(
      retention("apply", {
        open: (async (...arguments_: Parameters<typeof nodeOpen>) => {
          if (!swapped && arguments_[0] === old.databasePath) {
            swapped = true;
            renameSync(old.databasePath, displaced);
            writeFileSync(old.databasePath, "before-open-replacement");
          }
          return nodeOpen(...arguments_);
        }) as typeof nodeOpen,
      }),
    ).rejects.toThrow(/ownership|changed/);
    expect(readFileSync(old.databasePath, "utf8")).toBe(
      "before-open-replacement",
    );
    expect(existsSync(displaced)).toBe(true);
    expect(existsSync(old.manifestPath)).toBe(true);
  });

  it("fails closed on a symlink swap immediately before mutation", async () => {
    if (process.platform === "win32") return;
    const old = await eligiblePair();
    const displaced = join(root, "symlink-displaced.sqlite");
    await expect(
      retention("apply", {
        beforeDatabaseMutation: () => {
          renameSync(old.databasePath, displaced);
          symlinkSync(displaced, old.databasePath);
        },
      }),
    ).rejects.toThrow(/rollback|recovery/);
    expect(lstatSync(old.databasePath).isSymbolicLink()).toBe(true);
    expect(existsSync(displaced)).toBe(true);
    expect(existsSync(old.manifestPath)).toBe(true);
    expect(
      readdirSync(backupDirectory).some((name) =>
        name.includes("retention-recovery"),
      ),
    ).toBe(true);
  });

  it("retains owned recovery residue for a regular database replacement after recovery staging", async () => {
    const old = await eligiblePair();
    const originalDatabase = readFileSync(old.databasePath);
    const originalManifest = readFileSync(old.manifestPath);
    const displaced = join(root, "database-replaced-after-staging.sqlite");
    const replacement = Buffer.from("ordinary-database-replacement-bytes");
    const handles: Awaited<ReturnType<typeof nodeOpen>>[] = [];
    const trackedOpen = (async (...arguments_: Parameters<typeof nodeOpen>) => {
      const handle = await nodeOpen(...arguments_);
      handles.push(handle);
      return handle;
    }) as typeof nodeOpen;

    await expect(
      retention("apply", {
        open: trackedOpen,
        beforeDatabaseMutation: () => {
          renameSync(old.databasePath, displaced);
          writeFileSync(old.databasePath, replacement);
        },
      }),
    ).rejects.toThrow(/rollback|recovery/);

    expect(readFileSync(old.databasePath)).toEqual(replacement);
    expect(readFileSync(displaced)).toEqual(originalDatabase);
    expect(readFileSync(old.manifestPath)).toEqual(originalManifest);
    const recoveryNames = readdirSync(backupDirectory).filter((name) =>
      name.includes("retention-recovery"),
    );
    expect(recoveryNames).toHaveLength(2);

    await expect(retention("dry_run", { open: trackedOpen })).rejects.toThrow(
      /manual inspection/,
    );
    await expect(retention("apply", { open: trackedOpen })).rejects.toThrow(
      /manual inspection/,
    );
    expect(readFileSync(old.databasePath)).toEqual(replacement);
    expect(readFileSync(old.manifestPath)).toEqual(originalManifest);
    for (const handle of handles) await expect(handle.stat()).rejects.toThrow();
  });

  it("retains the complete owned pair when the manifest is regularly replaced after database removal", async () => {
    const old = await eligiblePair();
    const originalDatabase = readFileSync(old.databasePath);
    const originalManifest = readFileSync(old.manifestPath);
    const displaced = join(
      root,
      "manifest-replaced-after-database-removal.json",
    );
    const replacement = Buffer.from("ordinary-manifest-replacement-bytes");
    const handles: Awaited<ReturnType<typeof nodeOpen>>[] = [];
    const trackedOpen = (async (...arguments_: Parameters<typeof nodeOpen>) => {
      const handle = await nodeOpen(...arguments_);
      handles.push(handle);
      return handle;
    }) as typeof nodeOpen;

    await expect(
      retention("apply", {
        open: trackedOpen,
        beforeManifestMutation: () => {
          renameSync(old.manifestPath, displaced);
          writeFileSync(old.manifestPath, replacement);
        },
      }),
    ).rejects.toThrow(/rollback|recovery/);

    expect(readFileSync(old.manifestPath)).toEqual(replacement);
    expect(readFileSync(displaced)).toEqual(originalManifest);
    const recoveryNames = readdirSync(backupDirectory).filter((name) =>
      name.includes("retention-recovery"),
    );
    expect(recoveryNames).toHaveLength(2);
    const databaseRecovery = recoveryNames.find((name) =>
      name.endsWith(".database"),
    );
    const manifestRecovery = recoveryNames.find((name) =>
      name.endsWith(".manifest"),
    );
    expect(databaseRecovery).toBeDefined();
    expect(manifestRecovery).toBeDefined();
    expect(readFileSync(join(backupDirectory, databaseRecovery!))).toEqual(
      originalDatabase,
    );
    expect(readFileSync(join(backupDirectory, manifestRecovery!))).toEqual(
      originalManifest,
    );
    expect(existsSync(old.databasePath) || databaseRecovery !== undefined).toBe(
      true,
    );

    await expect(retention("dry_run", { open: trackedOpen })).rejects.toThrow(
      /manual inspection/,
    );
    await expect(retention("apply", { open: trackedOpen })).rejects.toThrow(
      /manual inspection/,
    );
    expect(readFileSync(old.manifestPath)).toEqual(replacement);
    for (const handle of handles) await expect(handle.stat()).rejects.toThrow();
  });

  it("restores a genuinely missing normal pathname from its owned recovery link", async () => {
    const old = await eligiblePair();
    const originalDatabase = readFileSync(old.databasePath);
    const originalManifest = readFileSync(old.manifestPath);
    const handles: Awaited<ReturnType<typeof nodeOpen>>[] = [];

    await expect(
      retention("apply", {
        open: (async (...arguments_: Parameters<typeof nodeOpen>) => {
          const handle = await nodeOpen(...arguments_);
          handles.push(handle);
          return handle;
        }) as typeof nodeOpen,
        beforeManifestMutation: () => unlinkSync(old.manifestPath),
      }),
    ).rejects.toThrow(/changed|failed safely/);

    expect(readFileSync(old.databasePath)).toEqual(originalDatabase);
    expect(readFileSync(old.manifestPath)).toEqual(originalManifest);
    expect(
      readdirSync(backupDirectory).some((name) =>
        name.includes("retention-recovery"),
      ),
    ).toBe(false);
    for (const handle of handles) await expect(handle.stat()).rejects.toThrow();
  });

  it("rolls back a handled mid-pair failure without a normal-looking half pair", async () => {
    const old = await eligiblePair();
    await expect(
      retention("apply", {
        afterDatabaseStaged: () => {
          throw new Error("injected-private-string");
        },
      }),
    ).rejects.toThrow(/failed safely/);
    expect(existsSync(old.databasePath)).toBe(true);
    expect(existsSync(old.manifestPath)).toBe(true);
    expect(
      readdirSync(backupDirectory).some((name) => name.includes("recovery")),
    ).toBe(false);
  });

  it("rolls back database staging when manifest mutation fails", async () => {
    const old = await eligiblePair();
    let injected = false;
    await expect(
      retention("apply", {
        unlink: (async (path: string) => {
          if (!injected && path === old.manifestPath) {
            injected = true;
            throw new Error("private manifest failure");
          }
          return nodeUnlink(path);
        }) as typeof nodeUnlink,
      }),
    ).rejects.toThrow(/failed safely/);
    expect(existsSync(old.databasePath)).toBe(true);
    expect(existsSync(old.manifestPath)).toBe(true);
  });

  it("restores both originals when a handled failure occurs after both names are staged", async () => {
    const old = await eligiblePair();
    await expect(
      retention("apply", {
        afterManifestStaged: () => {
          throw new Error("private post-staging failure");
        },
      }),
    ).rejects.toThrow(/failed safely/);
    expect(existsSync(old.databasePath)).toBe(true);
    expect(existsSync(old.manifestPath)).toBe(true);
    expect(
      readdirSync(backupDirectory).some((name) => name.includes("recovery")),
    ).toBe(false);
  });

  it.each(["database", "manifest"] as const)(
    "leaves originals intact when %s recovery staging fails",
    async (kind) => {
      const old = await eligiblePair();
      await expect(
        retention("apply", {
          link: (async (source: string, target: string) => {
            if (target.includes("recovery") && target.endsWith(`.${kind}`))
              throw new Error("injected-private-staging-failure");
            return nodeLink(source, target);
          }) as typeof nodeLink,
        }),
      ).rejects.toThrow(/failed safely/);
      expect(existsSync(old.databasePath)).toBe(true);
      expect(existsSync(old.manifestPath)).toBe(true);
      expect(
        readdirSync(backupDirectory).some((name) => name.includes("recovery")),
      ).toBe(false);
    },
  );

  it("retains recovery residue on rollback failure and refuses the next run", async () => {
    const old = await eligiblePair();
    await expect(
      retention("apply", {
        afterDatabaseStaged: () => {
          writeFileSync(old.databasePath, "replacement-must-be-preserved");
          throw new Error("force rollback");
        },
      }),
    ).rejects.toThrow(/rollback could not be completed/);
    expect(readFileSync(old.databasePath, "utf8")).toBe(
      "replacement-must-be-preserved",
    );
    expect(
      readdirSync(backupDirectory).some((name) => name.includes("recovery")),
    ).toBe(true);
    await expect(retention()).rejects.toThrow(/manual inspection/);
  });

  it("retains non-normal residue when recovery cleanup unlink fails", async () => {
    await eligiblePair();
    let injected = false;
    await expect(
      retention("apply", {
        unlink: (async (path: string) => {
          if (!injected && basename(path).includes("recovery")) {
            injected = true;
            throw new Error("cleanup unlink failure");
          }
          return nodeUnlink(path);
        }) as typeof nodeUnlink,
      }),
    ).rejects.toThrow(/recovery residue/);
    const names = readdirSync(backupDirectory);
    expect(names.some((name) => name.includes("recovery"))).toBe(true);
    expect(names.some((name) => name === "old.sqlite")).toBe(false);
    expect(names.some((name) => name === "old.manifest.json")).toBe(false);
  });

  it("closes every owned handle and creates the operation lock with restrictive permissions", async () => {
    await eligiblePair();
    const handles: Awaited<ReturnType<typeof nodeOpen>>[] = [];
    let lockMode: number | undefined;
    await retention("apply", {
      open: (async (...arguments_: Parameters<typeof nodeOpen>) => {
        const handle = await nodeOpen(...arguments_);
        handles.push(handle);
        return handle;
      }) as typeof nodeOpen,
      afterLockAcquired: () => {
        lockMode =
          lstatSync(join(backupDirectory, ".intervaiew-retention.lock")).mode &
          0o777;
      },
    });
    expect(lockMode).toBe(0o600);
    expect(handles.length).toBeGreaterThanOrEqual(3);
    for (const handle of handles) await expect(handle.stat()).rejects.toThrow();
  });

  it("keeps every test target beneath a newly created OS temporary root", () => {
    expect(resolve(root).startsWith(resolve(tmpdir()))).toBe(true);
    expect(resolve(root)).not.toBe(resolve("./data"));
    expect(resolve(backupDirectory)).not.toBe(resolve("./data/backups"));
  });
});
