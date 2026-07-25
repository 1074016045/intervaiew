import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import Database from "better-sqlite3";
import {
  createDatabaseBackup,
  generateBackupName,
} from "@/infrastructure/db/maintenance/backup-service";
import {
  sha256File,
  validateBackupPair,
} from "@/infrastructure/db/maintenance/backup-validation";
import {
  createMigratedDatabase,
  readMarkerIds,
  removeTemporaryDirectory,
  temporaryDatabaseDirectory,
} from "../helpers/database-maintenance";

describe("database backup and validation", () => {
  let directory: string;
  let sourcePath: string;
  let backupsPath: string;
  let source: Database.Database;

  beforeEach(() => {
    directory = temporaryDatabaseDirectory();
    sourcePath = join(directory, "source.db");
    backupsPath = join(directory, "backups");
    source = createMigratedDatabase(sourcePath, "committed-marker");
  });

  afterEach(() => {
    if (source.open) source.close();
    removeTemporaryDirectory(directory);
  });

  async function create(name = "safe-backup") {
    return createDatabaseBackup({
      databasePath: sourcePath,
      outputDirectory: backupsPath,
      name,
      now: new Date("2026-07-25T01:02:03.004Z"),
    });
  }

  async function rewriteManifest(
    manifestPath: string,
    databasePath: string,
    mutate: (manifest: Record<string, unknown>) => Record<string, unknown>,
  ) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    const stats = lstatSync(databasePath);
    const next = mutate({
      ...manifest,
      databaseBytes: stats.size,
      databaseSha256: await sha256File(databasePath),
    });
    writeFileSync(manifestPath, `${JSON.stringify(next, null, 2)}\n`);
  }

  it("creates a strict two-file artifact containing committed data", async () => {
    const result = await create();
    expect(readdirSync(backupsPath).sort()).toEqual([
      "safe-backup.manifest.json",
      "safe-backup.sqlite",
    ]);
    expect(readMarkerIds(result.databasePath)).toEqual(["committed-marker"]);
    expect(await validateBackupPair(result.manifestPath)).toMatchObject({
      manifest: {
        application: "intervaiew",
        formatVersion: 1,
        migrationCount: 7,
      },
    });
  });

  it("matches byte count and SHA-256 without disclosing the source path", async () => {
    const result = await create();
    expect(lstatSync(result.databasePath).size).toBe(
      result.manifest.databaseBytes,
    );
    expect(await sha256File(result.databasePath)).toBe(
      result.manifest.databaseSha256,
    );
    expect(readFileSync(result.manifestPath, "utf8")).not.toContain(sourcePath);
  });

  it("backs up WAL-mode committed data without copying WAL or SHM", async () => {
    expect(source.pragma("journal_mode", { simple: true })).toBe("wal");
    source
      .prepare(
        "insert into analysis_sessions (id,title,mode,status,created_at,updated_at) values (?,?, 'transcript_lab','draft',?,?)",
      )
      .run("wal-marker", "wal-marker", 1, 1);
    const result = await create();
    expect(
      readdirSync(backupsPath).some((name) => /-(wal|shm)$/.test(name)),
    ).toBe(false);
    expect(readMarkerIds(result.databasePath)).toEqual([
      "committed-marker",
      "wal-marker",
    ]);
    const snapshot = new Database(result.databasePath, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      expect(snapshot.pragma("journal_mode", { simple: true })).toBe("delete");
    } finally {
      snapshot.close();
    }
    expect(readdirSync(backupsPath).sort()).toEqual([
      "safe-backup.manifest.json",
      "safe-backup.sqlite",
    ]);
  });

  it("excludes an uncommitted transaction from the snapshot", async () => {
    source.exec("begin immediate");
    source
      .prepare(
        "insert into analysis_sessions (id,title,mode,status,created_at,updated_at) values (?,?, 'transcript_lab','draft',?,?)",
      )
      .run("uncommitted-secret-marker", "uncommitted-secret-marker", 1, 1);
    const backup = await create();
    source.exec("rollback");
    expect(readMarkerIds(backup.databasePath)).toEqual(["committed-marker"]);
  });

  it("generates collision-resistant safe names", () => {
    const names = new Set(
      Array.from({ length: 100 }, () =>
        generateBackupName(new Date("2026-07-25T01:02:03.004Z")),
      ),
    );
    expect(names.size).toBe(100);
    expect([...names].every((name) => /^[A-Za-z0-9_-]+$/.test(name))).toBe(
      true,
    );
  });

  it.each(["../escape", "bad.name", "bad/name", "bad\\name", "a".repeat(81)])(
    "rejects invalid explicit name %s",
    async (name) => {
      await expect(create(name)).rejects.toThrow(/Backup name/);
    },
  );

  it("never overwrites an existing complete pair", async () => {
    const first = await create();
    const bytes = readFileSync(first.databasePath);
    await expect(create()).rejects.toThrow(/already exists/);
    expect(readFileSync(first.databasePath)).toEqual(bytes);
  });

  it.each(["safe-backup.sqlite", "safe-backup.manifest.json"])(
    "rejects a partial existing artifact: %s",
    async (filename) => {
      await import("node:fs/promises").then(({ mkdir, writeFile }) =>
        mkdir(backupsPath, { recursive: true }).then(() =>
          writeFile(join(backupsPath, filename), "partial"),
        ),
      );
      await expect(create()).rejects.toThrow(/already exists/);
      expect(readdirSync(backupsPath)).toEqual([filename]);
    },
  );

  it("serializes concurrent attempts using the same name", async () => {
    const results = await Promise.allSettled([create(), create()]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(readdirSync(backupsPath).sort()).toEqual([
      "safe-backup.manifest.json",
      "safe-backup.sqlite",
    ]);
  });

  it("does not let a losing concurrent attempt remove the active lock", async () => {
    let release!: () => void;
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = createDatabaseBackup(
      {
        databasePath: sourcePath,
        outputDirectory: backupsPath,
        name: "locked-backup",
      },
      {
        afterLockAcquired: async () => {
          entered();
          await releasePromise;
        },
      },
    );
    await enteredPromise;
    await expect(
      createDatabaseBackup({
        databasePath: sourcePath,
        outputDirectory: backupsPath,
        name: "locked-backup",
      }),
    ).rejects.toThrow(/already being created/i);
    await expect(
      createDatabaseBackup({
        databasePath: sourcePath,
        outputDirectory: backupsPath,
        name: "locked-backup",
      }),
    ).rejects.toThrow(/already being created/i);
    release();
    await first;
  });

  it("fails closed when manifest publication fails after database publication", async () => {
    await expect(
      createDatabaseBackup(
        {
          databasePath: sourcePath,
          outputDirectory: backupsPath,
          name: "partial-publication",
        },
        {
          afterDatabasePublication: () => {
            throw new Error("synthetic manifest publication boundary");
          },
        },
      ),
    ).rejects.toThrow(/could not be created safely/i);
    expect(readdirSync(backupsPath)).toEqual([]);
  });

  it("never deletes a replacement file it does not own during cleanup", async () => {
    const finalDatabase = join(backupsPath, "ownership-race.sqlite");
    await expect(
      createDatabaseBackup(
        {
          databasePath: sourcePath,
          outputDirectory: backupsPath,
          name: "ownership-race",
        },
        {
          afterDatabasePublication: () => {
            unlinkSync(finalDatabase);
            writeFileSync(finalDatabase, "pre-existing-race-winner");
            throw new Error("synthetic publication race");
          },
        },
      ),
    ).rejects.toThrow(/could not be created safely/i);
    expect(readFileSync(finalDatabase, "utf8")).toBe(
      "pre-existing-race-winner",
    );
    expect(readdirSync(backupsPath)).toEqual(["ownership-race.sqlite"]);
  });

  it("cleans temporary files and final manifests after validation failure", async () => {
    source.close();
    const unrelated = new Database(sourcePath);
    unrelated.exec("drop table __drizzle_migrations");
    unrelated.close();
    await expect(create()).rejects.toThrow(/migration metadata/i);
    expect(readdirSync(backupsPath)).toEqual([]);
  });

  it("uses restrictive POSIX modes", async () => {
    const result = await create();
    if (process.platform !== "win32") {
      expect(lstatSync(backupsPath).mode & 0o777).toBe(0o700);
      expect(lstatSync(result.databasePath).mode & 0o777).toBe(0o600);
      expect(lstatSync(result.manifestPath).mode & 0o777).toBe(0o600);
    }
  });

  it("rejects a wrong manifest hash", async () => {
    const result = await create();
    await rewriteManifest(
      result.manifestPath,
      result.databasePath,
      (manifest) => ({
        ...manifest,
        databaseSha256: "0".repeat(64),
      }),
    );
    await expect(validateBackupPair(result.manifestPath)).rejects.toThrow(
      /hash does not match/i,
    );
  });

  it("rejects a wrong manifest size", async () => {
    const result = await create();
    await rewriteManifest(
      result.manifestPath,
      result.databasePath,
      (manifest) => ({
        ...manifest,
        databaseBytes: Number(manifest.databaseBytes) + 1,
      }),
    );
    await expect(validateBackupPair(result.manifestPath)).rejects.toThrow(
      /size does not match/i,
    );
  });

  it.each([
    [
      "unknown key",
      (manifest: Record<string, unknown>) => ({ ...manifest, x: 1 }),
    ],
    [
      "future format",
      (manifest: Record<string, unknown>) => ({
        ...manifest,
        formatVersion: 2,
      }),
    ],
    [
      "wrong app",
      (manifest: Record<string, unknown>) => ({
        ...manifest,
        application: "wrong",
      }),
    ],
    [
      "traversal",
      (manifest: Record<string, unknown>) => ({
        ...manifest,
        databaseFile: "../x.sqlite",
      }),
    ],
    [
      "absolute",
      (manifest: Record<string, unknown>) => ({
        ...manifest,
        databaseFile: "/x.sqlite",
      }),
    ],
    [
      "Windows traversal",
      (manifest: Record<string, unknown>) => ({
        ...manifest,
        databaseFile: "..\\x.sqlite",
      }),
    ],
    [
      "Windows drive path",
      (manifest: Record<string, unknown>) => ({
        ...manifest,
        databaseFile: "C:\\x.sqlite",
      }),
    ],
  ])("rejects manifest with %s", async (_label, mutate) => {
    const result = await create();
    await rewriteManifest(result.manifestPath, result.databasePath, mutate);
    await expect(validateBackupPair(result.manifestPath)).rejects.toThrow(
      /manifest/i,
    );
  });

  it("rejects malformed and oversized manifest JSON", async () => {
    const result = await create();
    writeFileSync(result.manifestPath, "{");
    await expect(validateBackupPair(result.manifestPath)).rejects.toThrow(
      /JSON/i,
    );
    writeFileSync(result.manifestPath, "x".repeat(70 * 1024));
    await expect(validateBackupPair(result.manifestPath)).rejects.toThrow(
      /size/i,
    );
  });

  it("rejects non-SQLite bytes even when size and hash match", async () => {
    const result = await create();
    writeFileSync(result.databasePath, "sensitive-row-marker is not sqlite");
    await rewriteManifest(
      result.manifestPath,
      result.databasePath,
      (manifest) => manifest,
    );
    await expect(validateBackupPair(result.manifestPath)).rejects.toThrow(
      /valid IntervAIew SQLite database/i,
    );
  });

  it("rejects missing migration metadata", async () => {
    const result = await create();
    const database = new Database(result.databasePath);
    database.exec("drop table __drizzle_migrations");
    database.close();
    await rewriteManifest(
      result.manifestPath,
      result.databasePath,
      (manifest) => manifest,
    );
    await expect(validateBackupPair(result.manifestPath)).rejects.toThrow(
      /migration metadata is missing/i,
    );
  });

  it("rejects missing required application schema", async () => {
    const result = await create();
    const database = new Database(result.databasePath);
    database.pragma("foreign_keys = OFF");
    database.exec("drop table interview_sessions");
    database.close();
    await rewriteManifest(
      result.manifestPath,
      result.databasePath,
      (manifest) => manifest,
    );
    await expect(validateBackupPair(result.manifestPath)).rejects.toThrow(
      /application schema is missing/i,
    );
  });

  it("rejects an unrelated empty SQLite database", async () => {
    const result = await create();
    unlinkSync(result.databasePath);
    new Database(result.databasePath).close();
    await rewriteManifest(
      result.manifestPath,
      result.databasePath,
      (manifest) => manifest,
    );
    await expect(validateBackupPair(result.manifestPath)).rejects.toThrow(
      /size is outside the allowed range/i,
    );
  });

  it("rejects a missing associated database file", async () => {
    const result = await create();
    unlinkSync(result.databasePath);
    await expect(validateBackupPair(result.manifestPath)).rejects.toThrow(
      /database file is missing/i,
    );
  });

  it("rejects a directory and FIFO in place of the backup database", async () => {
    const result = await create();
    unlinkSync(result.databasePath);
    mkdirSync(result.databasePath);
    await expect(validateBackupPair(result.manifestPath)).rejects.toThrow(
      /regular file/i,
    );
    removeTemporaryDirectory(result.databasePath);
    if (process.platform !== "win32") {
      execFileSync("mkfifo", [result.databasePath]);
      await expect(validateBackupPair(result.manifestPath)).rejects.toThrow(
        /regular file/i,
      );
    }
  });

  it("rejects sidecars without deleting or modifying them", async () => {
    const result = await create();
    const sidecarPath = `${result.databasePath}-wal`;
    writeFileSync(sidecarPath, "sidecar-ownership-sentinel");
    const before = readFileSync(sidecarPath);
    await expect(validateBackupPair(result.manifestPath)).rejects.toThrow(
      /sidecars/i,
    );
    expect(readFileSync(sidecarPath)).toEqual(before);
  });

  it("rejects unsafe Drizzle migration numeric metadata", async () => {
    const result = await create();
    const database = new Database(result.databasePath);
    database
      .prepare(
        "update __drizzle_migrations set created_at = ? where rowid = (select max(rowid) from __drizzle_migrations)",
      )
      .run(BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1));
    database.close();
    await rewriteManifest(
      result.manifestPath,
      result.databasePath,
      (manifest) => manifest,
    );
    await expect(validateBackupPair(result.manifestPath)).rejects.toThrow(
      /metadata is invalid/i,
    );
  });

  it("rejects manifest migration metadata that differs from the database", async () => {
    const result = await create();
    await rewriteManifest(
      result.manifestPath,
      result.databasePath,
      (manifest) => ({
        ...manifest,
        migrationCount: Number(manifest.migrationCount) - 1,
      }),
    );
    await expect(validateBackupPair(result.manifestPath)).rejects.toThrow(
      /metadata does not match/i,
    );
  });

  it("rejects a database whose SQLite integrity check fails", async () => {
    const result = await create();
    const database = new Database(result.databasePath);
    const rootPage = (
      database
        .prepare(
          "select rootpage from sqlite_schema where name = 'analysis_sessions'",
        )
        .get() as { rootpage: number }
    ).rootpage;
    database.close();
    const bytes = readFileSync(result.databasePath);
    const encodedPageSize = bytes.readUInt16BE(16);
    const pageSize = encodedPageSize === 1 ? 65_536 : encodedPageSize;
    bytes[(rootPage - 1) * pageSize] = 0x7f;
    writeFileSync(result.databasePath, bytes);
    await rewriteManifest(
      result.manifestPath,
      result.databasePath,
      (manifest) => manifest,
    );
    await expect(validateBackupPair(result.manifestPath)).rejects.toThrow(
      /not a valid IntervAIew SQLite database/i,
    );
  });

  it("rejects foreign-key violations", async () => {
    const result = await create();
    const database = new Database(result.databasePath);
    database.pragma("foreign_keys = OFF");
    database
      .prepare(
        "insert into interview_questions (id,session_id,sequence,question,competency,rationale,created_at) values (?,?,?,?,?,?,?)",
      )
      .run("bad-fk", "missing-session", 1, "q", "c", "r", 1);
    database.close();
    await rewriteManifest(
      result.manifestPath,
      result.databasePath,
      (manifest) => manifest,
    );
    await expect(validateBackupPair(result.manifestPath)).rejects.toThrow(
      /foreign-key/i,
    );
  });

  it("rejects manifest and database symlinks", async () => {
    if (process.platform === "win32") return;
    const result = await create();
    const manifestLink = join(directory, "manifest-link.json");
    symlinkSync(result.manifestPath, manifestLink);
    await expect(validateBackupPair(manifestLink)).rejects.toThrow(/symlink/i);
    const databaseReal = join(backupsPath, "database-real.sqlite");
    writeFileSync(databaseReal, readFileSync(result.databasePath));
    writeFileSync(
      result.manifestPath,
      readFileSync(result.manifestPath, "utf8").replace(
        "safe-backup.sqlite",
        "database-link.sqlite",
      ),
    );
    symlinkSync(databaseReal, join(backupsPath, "database-link.sqlite"));
    await expect(validateBackupPair(result.manifestPath)).rejects.toThrow(
      /symlink/i,
    );
  });

  it("rejects a symlink source", async () => {
    if (process.platform === "win32") return;
    const link = join(directory, "source-link.db");
    symlinkSync(sourcePath, link);
    await expect(
      createDatabaseBackup({
        databasePath: link,
        outputDirectory: backupsPath,
        name: "linked",
      }),
    ).rejects.toThrow(/non-symlink/i);
  });
});
