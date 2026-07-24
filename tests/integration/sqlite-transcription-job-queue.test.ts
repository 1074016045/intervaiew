import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { and, eq, inArray } from "drizzle-orm";
import { createDatabase } from "@/infrastructure/db/client";
import {
  analysisSessions,
  uploadedAudioActions,
  uploadedAudioAssets,
  uploadedAudioTranscriptionJobs,
} from "@/infrastructure/db/schema";
import { SqliteTranscriptionJobQueue } from "@/features/uploaded-audio/infrastructure/sqlite/sqlite-transcription-job-queue";
import { SqliteUploadedAudioRepository } from "@/features/uploaded-audio/infrastructure/sqlite/sqlite-uploaded-audio-repository";

const migrationsFolder = resolve("src/infrastructure/db/migrations");

function uuid(counter: number) {
  return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
}

describe("SQLite transcription job queue", () => {
  let directory: string;
  let databasePath: string;
  let first: ReturnType<typeof createDatabase>;
  let second: ReturnType<typeof createDatabase>;
  let queueA: SqliteTranscriptionJobQueue;
  let queueB: SqliteTranscriptionJobQueue;
  const sessionId = uuid(1);
  const assetA = uuid(2);
  const assetB = uuid(3);

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "intervaiew-queue-race-"));
    databasePath = join(directory, "test.db");
    first = createDatabase(databasePath);
    migrate(first.db, { migrationsFolder });
    second = createDatabase(databasePath);
    queueA = new SqliteTranscriptionJobQueue(first.db, () => "receipt-a");
    queueB = new SqliteTranscriptionJobQueue(second.db, () => "receipt-b");
    first.db.insert(analysisSessions).values({
      id: sessionId,
      title: "Queue race",
      mode: "transcript_lab",
      status: "draft",
      startedAt: null,
      endedAt: null,
      createdAt: new Date(1_000),
      updatedAt: new Date(1_000),
    }).run();
    for (const [index, assetId] of [assetA, assetB].entries())
      first.db.insert(uploadedAudioAssets).values({
        id: assetId,
        analysisSessionId: sessionId,
        speakerRole: "interviewer",
        originalFilename: `practice-${index}.wav`,
        mimeType: "audio/wav",
        byteSize: 44,
        sha256: String(index).repeat(64),
        relativePath: `${sessionId}/${assetId}.wav`,
        status: "uploaded",
        providerLabel: null,
        transcriptSegmentCount: 0,
        errorCode: null,
        completedAt: null,
        failedAt: null,
        createdAt: new Date(1_000 + index),
        updatedAt: new Date(1_000 + index),
      }).run();
  });

  afterEach(() => {
    second.sqlite.close();
    first.sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });

  function enqueue(
    queue: SqliteTranscriptionJobQueue,
    options?: { actionId?: string; assetId?: string; jobId?: string; maximumAttempts?: number },
  ) {
    return queue.enqueue({
      id: options?.jobId ?? uuid(10),
      analysisSessionId: sessionId,
      assetId: options?.assetId ?? assetA,
      actionId: options?.actionId ?? uuid(11),
      maximumAttempts: options?.maximumAttempts ?? 3,
      now: 2_000,
    });
  }

  async function workerRace(
    inputs: ReadonlyArray<
      Readonly<{
        command: "enqueue" | "claim" | "run-worker";
        input: Record<string, unknown>;
        receiptId: string;
        providerCounter?: SharedArrayBuffer;
      }>
    >,
  ) {
    const workers = inputs.map((input) => {
      const worker = new Worker(
        new URL("../fixtures/transcription-queue-race-worker.ts", import.meta.url),
        {
          workerData: { databasePath, ...input },
          execArgv: ["--conditions=react-server", "--import", "tsx"],
        },
      );
      let markReady!: () => void;
      let resolveResult!: (result: unknown) => void;
      let rejectResult!: (error: Error) => void;
      const ready = new Promise<void>((resolvePromise) => {
        markReady = resolvePromise;
      });
      const result = new Promise<unknown>((resolvePromise, rejectPromise) => {
        resolveResult = resolvePromise;
        rejectResult = rejectPromise;
      });
      worker.on("message", (message: unknown) => {
        if (
          typeof message === "object" &&
          message !== null &&
          "kind" in message
        ) {
          if (message.kind === "ready") markReady();
          if (message.kind === "result" && "result" in message)
            resolveResult(message.result);
          if (message.kind === "error" && "message" in message)
            rejectResult(new Error(String(message.message)));
        }
      });
      worker.on("error", rejectResult);
      return { ready, result, worker };
    });
    await Promise.all(workers.map((worker) => worker.ready));
    for (const worker of workers) worker.worker.postMessage("go");
    return Promise.all(workers.map((worker) => worker.result));
  }

  it("returns one created job and one duplicate for the same concurrent action", async () => {
    const actionId = uuid(20);
    const results = (await workerRace([
      {
        command: "enqueue",
        receiptId: "receipt-left",
        input: {
          id: uuid(21),
          analysisSessionId: sessionId,
          assetId: assetA,
          actionId,
          maximumAttempts: 3,
          now: 2_000,
        },
      },
      {
        command: "enqueue",
        receiptId: "receipt-right",
        input: {
          id: uuid(22),
          analysisSessionId: sessionId,
          assetId: assetA,
          actionId,
          maximumAttempts: 3,
          now: 2_000,
        },
      },
    ])) as Array<ReturnType<SqliteTranscriptionJobQueue["enqueue"]>>;
    expect(results.map((result) => result.kind).sort()).toEqual([
      "created",
      "duplicate",
    ]);
    const jobs = results.flatMap((result) =>
      "job" in result && result.job ? [result.job.id] : [],
    );
    expect(new Set(jobs).size).toBe(1);
    expect(
      first.db.select().from(uploadedAudioTranscriptionJobs).all(),
    ).toHaveLength(1);
    expect(JSON.stringify(results)).not.toMatch(/SQLITE_|constraint|database|\.db/u);
  });

  it("returns one active job and one stable conflict for different concurrent actions", async () => {
    const results = (await workerRace([
      {
        command: "enqueue",
        receiptId: "receipt-left",
        input: {
          id: uuid(31),
          analysisSessionId: sessionId,
          assetId: assetA,
          actionId: uuid(30),
          maximumAttempts: 3,
          now: 2_000,
        },
      },
      {
        command: "enqueue",
        receiptId: "receipt-right",
        input: {
          id: uuid(33),
          analysisSessionId: sessionId,
          assetId: assetA,
          actionId: uuid(32),
          maximumAttempts: 3,
          now: 2_000,
        },
      },
    ])) as Array<ReturnType<SqliteTranscriptionJobQueue["enqueue"]>>;
    expect(results.map((result) => result.kind).sort()).toEqual([
      "active-job-conflict",
      "created",
    ]);
    const active = first.db
      .select()
      .from(uploadedAudioTranscriptionJobs)
      .where(inArray(uploadedAudioTranscriptionJobs.status, ["queued", "running"]))
      .all();
    expect(active).toHaveLength(1);
    expect(JSON.stringify(results)).not.toMatch(/SQLITE_|constraint|database|\.db/u);
  });

  it("returns stable conflicts for action-type and asset mismatches", () => {
    const actionId = uuid(40);
    expect(enqueue(queueA, { actionId, assetId: assetA }).kind).toBe("created");
    expect(enqueue(queueB, { actionId, assetId: assetB }).kind).toBe(
      "action-conflict",
    );
    first.db.insert(uploadedAudioActions).values({
      id: "upload-receipt",
      analysisSessionId: sessionId,
      actionId: uuid(41),
      actionType: "upload",
      assetId: assetB,
      createdAt: new Date(2_000),
    }).run();
    expect(enqueue(queueB, { actionId: uuid(41), assetId: assetB }).kind).toBe(
      "action-conflict",
    );
  });

  it("normalizes a bounded persistent SQLITE_BUSY outcome", () => {
    first.sqlite.exec("begin immediate");
    second.sqlite.pragma("busy_timeout = 0");
    try {
      const result = enqueue(queueB, { actionId: uuid(50), jobId: uuid(51) });
      expect(result).toEqual({ kind: "temporarily-unavailable" });
      expect(JSON.stringify(result)).not.toContain("SQLITE_BUSY");
    } finally {
      first.sqlite.exec("rollback");
    }
  });

  it("claims one queued job exactly once across separate worker connections", async () => {
    expect(enqueue(queueA, { actionId: uuid(60), jobId: uuid(61) }).kind).toBe(
      "created",
    );
    const providerCounter = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    await workerRace([
      {
        command: "run-worker",
        receiptId: "unused-left",
        providerCounter,
        input: { now: 2_100, leaseToken: "lease-a" },
      },
      {
        command: "run-worker",
        receiptId: "unused-right",
        providerCounter,
        input: { now: 2_100, leaseToken: "lease-b" },
      },
    ]);
    expect(Atomics.load(new Int32Array(providerCounter), 0)).toBe(1);
    const job = first.db.select().from(uploadedAudioTranscriptionJobs).where(
      eq(uploadedAudioTranscriptionJobs.id, uuid(61)),
    ).get()!;
    expect(job).toMatchObject({
      status: "running",
      attemptCount: 1,
      leaseToken: expect.stringMatching(/^lease-[ab]$/u),
      leaseExpiresAt: new Date(122_100),
    });
    expect(
      first.db.select().from(uploadedAudioAssets).where(
        eq(uploadedAudioAssets.id, assetA),
      ).get()?.status,
    ).toBe("transcribing");
  });

  it("gives exactly one direct claimant one lease and one attempt", async () => {
    enqueue(queueA, { actionId: uuid(80), jobId: uuid(81) });
    const [left, right] = (await workerRace([
      {
        command: "claim",
        receiptId: "unused-left",
        input: { now: 2_100, leaseToken: "lease-left", leaseDurationMs: 5_000 },
      },
      {
        command: "claim",
        receiptId: "unused-right",
        input: { now: 2_100, leaseToken: "lease-right", leaseDurationMs: 5_000 },
      },
    ])) as Array<ReturnType<SqliteTranscriptionJobQueue["claimNext"]>>;
    expect([left, right].filter(Boolean)).toHaveLength(1);
    expect([left, right].filter((value) => value === null)).toHaveLength(1);
    const running = first.db.select().from(uploadedAudioTranscriptionJobs).where(
      eq(uploadedAudioTranscriptionJobs.id, uuid(81)),
    ).get()!;
    expect(running.attemptCount).toBe(1);
    expect(running.leaseToken).toMatch(/^lease-(left|right)$/u);
    expect(running.leaseExpiresAt?.getTime()).toBe(7_100);
    expect(
      first.db.select().from(uploadedAudioAssets).where(
        eq(uploadedAudioAssets.id, assetA),
      ).get()?.status,
    ).toBe("transcribing");
  });

  it("fails an invalid queued candidate and its eligible asset consistently", () => {
    enqueue(queueA, { actionId: uuid(90), jobId: uuid(91) });
    first.db.update(analysisSessions).set({ status: "cancelled" }).where(
      eq(analysisSessions.id, sessionId),
    ).run();
    expect(
      queueA.claimNext({ now: 2_100, leaseToken: "unused", leaseDurationMs: 5_000 }),
    ).toBeNull();
    expect(
      first.db.select().from(uploadedAudioTranscriptionJobs).where(
        eq(uploadedAudioTranscriptionJobs.id, uuid(91)),
      ).get(),
    ).toMatchObject({ status: "failed", safeErrorCode: "UPLOADED_AUDIO_JOB_STATE_INVALID" });
    expect(
      first.db.select().from(uploadedAudioAssets).where(
        eq(uploadedAudioAssets.id, assetA),
      ).get(),
    ).toMatchObject({ status: "failed", errorCode: "UPLOADED_AUDIO_JOB_STATE_INVALID" });
  });

  it("does not mark a completed asset failed when its queued job is invalidated", () => {
    enqueue(queueA, { actionId: uuid(100), jobId: uuid(101) });
    first.db.update(uploadedAudioAssets).set({ status: "completed" }).where(
      eq(uploadedAudioAssets.id, assetA),
    ).run();
    expect(
      queueA.claimNext({ now: 2_100, leaseToken: "unused", leaseDurationMs: 5_000 }),
    ).toBeNull();
    expect(
      first.db.select().from(uploadedAudioAssets).where(
        eq(uploadedAudioAssets.id, assetA),
      ).get()?.status,
    ).toBe("completed");
  });

  it("treats a stale failure token as a no-op", () => {
    enqueue(queueA, { actionId: uuid(110), jobId: uuid(111) });
    queueA.claimNext({ now: 2_100, leaseToken: "current-lease", leaseDurationMs: 5_000 });
    expect(queueB.fail({
      jobId: uuid(111),
      leaseToken: "stale-lease",
      now: 2_200,
      safeErrorCode: "SHOULD_NOT_APPLY",
      retryAt: null,
    })).toEqual({ kind: "stale" });
    expect(
      first.db.select().from(uploadedAudioTranscriptionJobs).where(
        eq(uploadedAudioTranscriptionJobs.id, uuid(111)),
      ).get(),
    ).toMatchObject({ status: "running", leaseToken: "current-lease", safeErrorCode: null });
  });

  it("cancels the authoritative active job before marking an asset deleting", () => {
    enqueue(queueA, { actionId: uuid(115), jobId: uuid(116) });
    const repository = new SqliteUploadedAudioRepository(
      first.db,
      () => "deletion-receipt",
      () => 2_200,
    );
    expect(
      repository.beginAssetDeletion({
        sessionId,
        assetId: assetA,
        actionId: uuid(117),
        batchId: "deletion-batch",
        fileId: "deletion-file",
        tombstoneRelativePath: `${sessionId}/${uuid(118)}.delete`,
      }).kind,
    ).toBe("ready");
    expect(
      first.db.select().from(uploadedAudioTranscriptionJobs).where(
        eq(uploadedAudioTranscriptionJobs.id, uuid(116)),
      ).get(),
    ).toMatchObject({ status: "cancelled", leaseToken: null });
    expect(
      first.db.select().from(uploadedAudioAssets).where(
        eq(uploadedAudioAssets.id, assetA),
      ).get()?.status,
    ).toBe("deleting");
  });

  it("recovers an exhausted lease with guarded terminal job and asset updates", () => {
    enqueue(queueA, { actionId: uuid(120), jobId: uuid(121), maximumAttempts: 1 });
    queueA.claimNext({ now: 2_100, leaseToken: "expiring-lease", leaseDurationMs: 100 });
    expect(queueB.recoverExpired({ now: 2_200, limit: 25 })).toBe(1);
    expect(
      first.db.select().from(uploadedAudioTranscriptionJobs).where(
        and(
          eq(uploadedAudioTranscriptionJobs.id, uuid(121)),
          eq(uploadedAudioTranscriptionJobs.status, "failed"),
        ),
      ).get(),
    ).toMatchObject({ safeErrorCode: "UPLOADED_AUDIO_LEASE_EXPIRED" });
    expect(
      first.db.select().from(uploadedAudioAssets).where(
        eq(uploadedAudioAssets.id, assetA),
      ).get(),
    ).toMatchObject({ status: "failed", errorCode: "UPLOADED_AUDIO_LEASE_EXPIRED" });
  });

  it("uses deterministic and distinct receipt, job, and lease ID domains", () => {
    const result = enqueue(queueA, { actionId: uuid(130), jobId: "job-id" });
    expect(result).toMatchObject({ kind: "created", job: { id: "job-id" } });
    const receipt = first.db.select().from(uploadedAudioActions).where(
      eq(uploadedAudioActions.actionId, uuid(130)),
    ).get()!;
    expect(receipt.id).toBe("receipt-a");
    const claimed = queueA.claimNext({
      now: 2_100,
      leaseToken: "lease-id",
      leaseDurationMs: 5_000,
    });
    expect(claimed).toMatchObject({ id: "job-id", leaseToken: "lease-id" });
    expect(new Set([receipt.id, claimed?.id, claimed?.leaseToken]).size).toBe(3);
  });
});
