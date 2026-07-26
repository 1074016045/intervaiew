import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { createDatabaseBackup } from "@/infrastructure/db/maintenance/backup-service";
import { runOperationsStatusCli } from "@/infrastructure/db/maintenance/operations-status-cli";
import {
  getOperationsStatus,
  type OperationsStatusSnapshot,
} from "@/infrastructure/db/maintenance/operations-status-service";
import { createOperationalEventLogger } from "@/infrastructure/logging/safe-operational-event";
import {
  createMigratedDatabase,
  removeTemporaryDirectory,
  temporaryDatabaseDirectory,
} from "../helpers/database-maintenance";

const now = new Date("2026-07-26T00:00:00.000Z");

describe("local read-only operations status", () => {
  let root: string;
  let databasePath: string;
  let backupDirectory: string;

  beforeEach(() => {
    root = temporaryDatabaseDirectory();
    databasePath = join(root, "status-private.db");
    backupDirectory = join(root, "status-backups");
    mkdirSync(backupDirectory);
    const database = createMigratedDatabase(databasePath);
    database.close();
  });

  afterEach(() => removeTemporaryDirectory(root));

  function status(overrides = {}) {
    return getOperationsStatus(
      {
        databasePath,
        backupDirectory,
        maxAgeDays: 30,
        keepLatest: 3,
      },
      { now: () => now, ...overrides },
    );
  }

  function filesystemFacts() {
    return readdirSync(root, { recursive: true })
      .map(String)
      .sort()
      .map((name) => {
        const stats = statSync(join(root, name));
        return [name, stats.size, stats.mtimeMs, stats.mode] as const;
      });
  }

  function fileSnapshot(path: string) {
    const stats = statSync(path);
    return {
      bytes: readFileSync(path),
      metadata: {
        dev: stats.dev,
        ino: stats.ino,
        mode: stats.mode,
        nlink: stats.nlink,
        uid: stats.uid,
        gid: stats.gid,
        size: stats.size,
        mtimeMs: stats.mtimeMs,
        ctimeMs: stats.ctimeMs,
      },
    };
  }

  it("returns a healthy snapshot for a migrated read-only database and empty backup directory", async () => {
    const before = filesystemFacts();
    const snapshot = await status();
    expect(snapshot).toEqual({
      formatVersion: 1,
      status: "ok",
      database: {
        reachable: true,
        quickCheckOk: true,
        foreignKeyViolationCount: 0,
        sqliteUserVersion: 0,
        migrationCount: 7,
      },
      backups: {
        directoryReadable: true,
        validPairCount: 0,
        invalidEntryCount: 0,
        incompletePairCount: 0,
      },
      transcriptionJobs: {
        queued: 0,
        running: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
        expiredRunning: 0,
      },
      deletionBatches: { planned: 0, metadataDeleted: 0 },
      retention: { maxAgeDays: 30, keepLatest: 3 },
    });
    expect(filesystemFacts()).toEqual(before);
  });

  it.each(["-wal", "-shm"] as const)(
    "degrades without changing a live SQLite %s sidecar and recovers after it is removed",
    async (suffix) => {
      const sidecarPath = `${databasePath}${suffix}`;
      const marker = `injected-sensitive-sidecar-marker${suffix}`;
      writeFileSync(sidecarPath, marker);
      const databaseBefore = fileSnapshot(databasePath);
      const sidecarBefore = fileSnapshot(sidecarPath);
      const rootNamesBefore = readdirSync(root).sort();
      const backupNamesBefore = readdirSync(backupDirectory).sort();

      const textOutput: string[] = [];
      const textErrors: string[] = [];
      const textEvents: string[] = [];
      const textCode = await runOperationsStatusCli(
        ["--database", databasePath, "--backup-directory", backupDirectory],
        {
          out: (value) => textOutput.push(value),
          error: (value) => textErrors.push(value),
          event: createOperationalEventLogger((line) => textEvents.push(line)),
        },
      );
      expect(textCode).toBe(1);
      expect(textOutput.join("\n")).toContain("Operations status: degraded");
      expect(textErrors).toEqual([]);
      expect(textEvents).toHaveLength(1);
      expect(JSON.parse(textEvents[0])).toMatchObject({
        event: "maintenance.status.failed",
        outcome: "degraded",
      });

      const jsonOutput: string[] = [];
      const jsonErrors: string[] = [];
      const jsonEvents: string[] = [];
      const jsonCode = await runOperationsStatusCli(
        [
          "--database",
          databasePath,
          "--backup-directory",
          backupDirectory,
          "--json",
        ],
        {
          out: (value) => jsonOutput.push(value),
          error: (value) => jsonErrors.push(value),
          event: createOperationalEventLogger((line) => jsonEvents.push(line)),
        },
      );
      expect(jsonCode).toBe(1);
      expect(jsonOutput).toHaveLength(1);
      expect(JSON.parse(jsonOutput[0])).toMatchObject({ status: "degraded" });
      expect(jsonErrors).toEqual([]);
      expect(jsonEvents).toHaveLength(1);
      expect(JSON.parse(jsonEvents[0])).toMatchObject({
        event: "maintenance.status.failed",
        outcome: "degraded",
      });

      const rendered = [
        ...textOutput,
        ...textErrors,
        ...textEvents,
        ...jsonOutput,
        ...jsonErrors,
        ...jsonEvents,
      ].join("\n");
      for (const prohibited of [root, databasePath, sidecarPath, marker])
        expect(rendered).not.toContain(prohibited);

      expect(fileSnapshot(databasePath)).toEqual(databaseBefore);
      expect(fileSnapshot(sidecarPath)).toEqual(sidecarBefore);
      expect(readdirSync(root).sort()).toEqual(rootNamesBefore);
      expect(readdirSync(backupDirectory).sort()).toEqual(backupNamesBefore);

      unlinkSync(sidecarPath);
      const healthyOutput: string[] = [];
      expect(
        await runOperationsStatusCli(
          [
            "--database",
            databasePath,
            "--backup-directory",
            backupDirectory,
            "--json",
          ],
          { out: (value) => healthyOutput.push(value), error: () => undefined },
        ),
      ).toBe(0);
      expect(JSON.parse(healthyOutput[0])).toMatchObject({ status: "ok" });
      expect(fileSnapshot(databasePath)).toEqual(databaseBefore);
    },
  );

  it("reports missing and corrupt databases as stable degraded snapshots without creating a database", async () => {
    databasePath = join(root, "missing-private-database.db");
    const missing = await status();
    expect(missing.status).toBe("degraded");
    expect(missing.database).toMatchObject({
      reachable: false,
      quickCheckOk: false,
      sqliteUserVersion: null,
      migrationCount: null,
    });
    expect(() => statSync(databasePath)).toThrow();

    databasePath = join(root, "corrupt-private-database.db");
    writeFileSync(databasePath, "private corrupt sqlite bytes");
    const corruptBefore = readFileSync(databasePath);
    const corrupt = await status();
    expect(corrupt.status).toBe("degraded");
    expect(corrupt.database.reachable).toBe(false);
    expect(readFileSync(databasePath)).toEqual(corruptBefore);
  });

  it("degrades on quick-check failure without exposing raw SQLite output", async () => {
    const database: OperationsStatusSnapshot["database"] = {
      reachable: true,
      quickCheckOk: false,
      foreignKeyViolationCount: 0,
      sqliteUserVersion: 0,
      migrationCount: 7,
    };
    const snapshot = await status({
      inspectDatabase: async () => ({
        database,
        transcriptionJobs: {
          queued: 0,
          running: 0,
          completed: 0,
          failed: 0,
          cancelled: 0,
          expiredRunning: 0,
        },
        deletionBatches: { planned: 0, metadataDeleted: 0 },
        degraded: true,
      }),
    });
    expect(snapshot.status).toBe("degraded");
    expect(JSON.stringify(snapshot)).not.toContain("private");
  });

  it("counts foreign-key violations without returning affected table names or rows", async () => {
    const database = new Database(databasePath);
    database.pragma("foreign_keys = OFF");
    database
      .prepare(
        "insert into interview_questions (id, session_id, sequence, question, competency, rationale, created_at) values ('private-id', 'missing-parent', 1, 'private-question', 'private', 'private', 1)",
      )
      .run();
    database.close();
    const snapshot = await status();
    expect(snapshot.status).toBe("degraded");
    expect(snapshot.database.foreignKeyViolationCount).toBe(1);
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("interview_questions");
    expect(serialized).not.toContain("private-id");
    expect(serialized).not.toContain("private-question");
  });

  it("counts every job state, expired running work, and pending deletion batches", async () => {
    const database = new Database(databasePath);
    database.pragma("foreign_keys = ON");
    database
      .prepare(
        "insert into analysis_sessions (id, title, mode, status, created_at, updated_at) values ('session-private', 'private-title', 'transcript_lab', 'draft', 1, 1)",
      )
      .run();
    const statuses = [
      "queued",
      "running",
      "completed",
      "failed",
      "cancelled",
    ] as const;
    for (const [index, jobStatus] of statuses.entries()) {
      const assetId = `asset-private-${index}`;
      const actionId = `action-private-${index}`;
      database
        .prepare(
          "insert into uploaded_audio_assets (id, analysis_session_id, speaker_role, original_filename, mime_type, byte_size, sha256, relative_path, status, transcript_segment_count, created_at, updated_at) values (?, 'session-private', 'candidate', 'private.wav', 'audio/wav', 1, ?, ?, 'uploaded', 0, 1, 1)",
        )
        .run(assetId, "a".repeat(64), `${assetId}.wav`);
      database
        .prepare(
          "insert into uploaded_audio_actions (id, analysis_session_id, action_id, action_type, asset_id, created_at) values (?, 'session-private', ?, 'transcribe', ?, 1)",
        )
        .run(`receipt-${index}`, actionId, assetId);
      const terminal = {
        completed: jobStatus === "completed" ? 3 : null,
        failed: jobStatus === "failed" ? 3 : null,
        cancelled: jobStatus === "cancelled" ? 3 : null,
      };
      database
        .prepare(
          `insert into uploaded_audio_transcription_jobs
           (id, analysis_session_id, asset_id, action_id, status, attempt_count,
            maximum_attempts, available_at, lease_token, lease_expires_at,
            started_at, completed_at, failed_at, cancelled_at, safe_error_code,
            created_at, updated_at)
           values (?, 'session-private', ?, ?, ?, ?, 3, 1, ?, ?, ?, ?, ?, ?, ?, 1, 3)`,
        )
        .run(
          `job-private-${index}`,
          assetId,
          actionId,
          jobStatus,
          jobStatus === "running" ? 1 : 0,
          jobStatus === "running" ? "lease-private" : null,
          jobStatus === "running" ? now.valueOf() - 1 : null,
          jobStatus === "running" ? 2 : null,
          terminal.completed,
          terminal.failed,
          terminal.cancelled,
          jobStatus === "failed" ? "SAFE_FAILURE" : null,
        );
    }
    database
      .prepare(
        "insert into uploaded_audio_deletion_batches (id, analysis_session_id, action_id, scope, status, created_at, updated_at) values ('batch-planned', 'session-private', 'delete-private-1', 'session', 'planned', 1, 1)",
      )
      .run();
    database
      .prepare(
        "insert into uploaded_audio_deletion_batches (id, analysis_session_id, action_id, scope, status, created_at, updated_at) values ('batch-metadata', 'session-private', 'delete-private-2', 'session', 'metadata_deleted', 1, 1)",
      )
      .run();
    database.close();

    const snapshot = await status();
    expect(snapshot.status).toBe("ok");
    expect(snapshot.transcriptionJobs).toEqual({
      queued: 1,
      running: 1,
      completed: 1,
      failed: 1,
      cancelled: 1,
      expiredRunning: 1,
    });
    expect(snapshot.deletionBatches).toEqual({
      planned: 1,
      metadataDeleted: 1,
    });
    expect(JSON.stringify(snapshot)).not.toContain("private");
  });

  it("counts valid, invalid, and incomplete direct-child backup artifacts", async () => {
    const backupSourcePath = join(root, "separate-backup-source.db");
    const backupSource = createMigratedDatabase(backupSourcePath);
    backupSource.close();
    await createDatabaseBackup({
      databasePath: backupSourcePath,
      outputDirectory: backupDirectory,
      name: "valid-private-name",
      now,
    });
    writeFileSync(join(backupDirectory, "unknown-private.txt"), "unknown");
    writeFileSync(join(backupDirectory, "incomplete.sqlite"), "half");
    const snapshot = await status();
    expect(snapshot.status).toBe("degraded");
    expect(snapshot.backups).toEqual({
      directoryReadable: true,
      validPairCount: 1,
      invalidEntryCount: 1,
      incompletePairCount: 1,
    });
    expect(JSON.stringify(snapshot)).not.toContain("valid-private-name");
    expect(JSON.stringify(snapshot)).not.toContain(root);
  });

  it("reports a missing or unreadable backup resource as degraded", async () => {
    backupDirectory = join(root, "missing-private-backups");
    const snapshot = await status();
    expect(snapshot.status).toBe("degraded");
    expect(snapshot.backups).toEqual({
      directoryReadable: false,
      validPairCount: 0,
      invalidEntryCount: 0,
      incompletePairCount: 0,
    });
  });

  it("uses exit 0 for healthy and nonzero for degraded while JSON remains one bounded value", async () => {
    const output: string[] = [];
    const errors: string[] = [];
    const io = {
      out: (value: string) => output.push(value),
      error: (value: string) => errors.push(value),
    };
    expect(
      await runOperationsStatusCli(
        [
          "--database",
          databasePath,
          "--backup-directory",
          backupDirectory,
          "--json",
        ],
        io,
      ),
    ).toBe(0);
    expect(output).toHaveLength(1);
    expect(JSON.parse(output[0])).toMatchObject({ status: "ok" });
    expect(output[0]).not.toContain(root);
    expect(errors).toEqual([]);

    output.length = 0;
    expect(
      await runOperationsStatusCli(
        [
          "--database",
          join(root, "missing.db"),
          "--backup-directory",
          backupDirectory,
          "--json",
        ],
        io,
      ),
    ).toBe(1);
    expect(output).toHaveLength(1);
    expect(JSON.parse(output[0])).toMatchObject({ status: "degraded" });
  });

  it("renders bounded text without identifiers, names, paths, timestamps, or content", async () => {
    const output: string[] = [];
    expect(
      await runOperationsStatusCli(
        ["--database", databasePath, "--backup-directory", backupDirectory],
        { out: (value) => output.push(value), error: () => undefined },
      ),
    ).toBe(0);
    const text = output.join("\n");
    expect(text.length).toBeLessThan(2_000);
    expect(text).not.toContain(root);
    expect(text).not.toContain("status-private.db");
    expect(text).not.toContain("2026-");
  });
});
