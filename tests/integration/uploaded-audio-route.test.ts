import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getDatabase, resetDatabaseForTests } from "@/infrastructure/db/client";
import { resetServerEnvForTests } from "@/infrastructure/env/server-env";
import { POST as createAnalysisSession } from "@/app/api/analysis-sessions/route";
import { GET as getAnalysisSession } from "@/app/api/analysis-sessions/[id]/route";
import {
  GET as listUploadedAudio,
  POST as postUploadedAudio,
} from "@/app/api/analysis-sessions/[id]/uploaded-audio/route";
import { POST as transcribeUploadedAudio } from "@/app/api/analysis-sessions/[id]/uploaded-audio/[assetId]/transcribe/route";
import { DELETE as deleteUploadedAudio } from "@/app/api/analysis-sessions/[id]/uploaded-audio/[assetId]/route";
import { GET as getQuestionBoundary } from "@/app/api/analysis-sessions/[id]/question-boundary/route";
import { UploadedAudioTranscriptionWorker } from "@/features/uploaded-audio/application/uploaded-audio-transcription-worker";
import { TranscriptIngestionService } from "@/features/question-intelligence/application/transcript-ingestion-service";
import { SqliteAnalysisRepository } from "@/features/question-intelligence/infrastructure/sqlite/sqlite-analysis-repository";
import { FakeAudioTranscriptionProvider } from "@/features/uploaded-audio/infrastructure/fake/fake-audio-transcription-provider";
import { FilesystemUploadedAudioStorage } from "@/features/uploaded-audio/infrastructure/filesystem/filesystem-uploaded-audio-storage";
import { SqliteTranscriptionJobQueue } from "@/features/uploaded-audio/infrastructure/sqlite/sqlite-transcription-job-queue";

const origin = "http://localhost";
const privateResponseFields = new Set([
  "actionId",
  "leaseToken",
  "leaseExpiresAt",
  "relativePath",
  "storagePath",
  "transcript",
  "providerPayload",
  "rawError",
]);
const testEnvironmentNames = [
  "DATABASE_PATH",
  "UPLOADED_AUDIO_PATH",
  "UPLOADED_AUDIO_ENABLED",
  "UPLOADED_AUDIO_TRANSCRIPTION_WORKER_ENABLED",
  "UPLOADED_AUDIO_FAKE_TRANSCRIPTION_ENABLED",
  "UPLOADED_AUDIO_MAX_BYTES",
] as const;

function expectPublicResponse(payload: unknown) {
  const found: string[] = [];
  const visit = (value: unknown, path: string[]) => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, [...path, String(index)]));
      return;
    }
    if (typeof value !== "object" || value === null) return;
    for (const [key, entry] of Object.entries(value)) {
      if (privateResponseFields.has(key)) found.push([...path, key].join("."));
      visit(entry, [...path, key]);
    }
  };
  visit(payload, []);
  expect(found).toEqual([]);
}

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function uuid(counter: number) {
  return `10000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
}

function wavBytes(size = 44) {
  const bytes = new Uint8Array(Math.max(44, size));
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  bytes.set(new TextEncoder().encode("WAVE"), 8);
  return bytes;
}

function jsonRequest(
  path: string,
  body: unknown,
  method = "POST",
  sameOrigin = true,
) {
  return new Request(`${origin}${path}`, {
    method,
    headers: {
      ...(sameOrigin ? { Origin: origin } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function uploadRequest(
  sessionId: string,
  options?: {
    actionId?: string;
    bytes?: Uint8Array;
    filename?: string;
    mimeType?: string;
    speakerRole?: string;
    origin?: boolean;
    extra?: boolean;
    contentLength?: string | null;
  },
) {
  const data = new FormData();
  const bytes = options?.bytes ?? wavBytes();
  data.set("actionId", options?.actionId ?? uuid(1));
  data.set("speakerRole", options?.speakerRole ?? "interviewer");
  data.set(
    "file",
    new File(
      [
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer,
      ],
      options?.filename ?? "practice.wav",
      {
        type: options?.mimeType ?? "audio/wav",
      },
    ),
  );
  if (options?.extra) data.set("status", "completed");
  return new Request(
    `${origin}/api/analysis-sessions/${sessionId}/uploaded-audio`,
    {
      method: "POST",
      headers: {
        ...(options?.origin === false ? {} : { Origin: origin }),
        ...(options?.contentLength === null
          ? {}
          : {
              "Content-Length":
                options?.contentLength ?? String(bytes.byteLength + 512),
            }),
      },
      body: data,
    },
  );
}

describe("Uploaded Audio route handlers", () => {
  let directory: string;
  let sessionId: string;
  let originalEnvironment: Record<string, string | undefined>;

  beforeEach(async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    originalEnvironment = Object.fromEntries(
      testEnvironmentNames.map((name) => [name, process.env[name]]),
    );
    directory = mkdtempSync(join(tmpdir(), "intervaiew-upload-route-"));
    resetDatabaseForTests();
    process.env.DATABASE_PATH = join(directory, "route.db");
    process.env.UPLOADED_AUDIO_PATH = join(directory, "audio");
    process.env.UPLOADED_AUDIO_ENABLED = "true";
    process.env.UPLOADED_AUDIO_TRANSCRIPTION_WORKER_ENABLED = "true";
    process.env.UPLOADED_AUDIO_FAKE_TRANSCRIPTION_ENABLED = "true";
    process.env.UPLOADED_AUDIO_MAX_BYTES = "1024";
    resetServerEnvForTests();
    migrate(getDatabase().db, {
      migrationsFolder: resolve("src/infrastructure/db/migrations"),
    });
    const response = await createAnalysisSession(
      jsonRequest("/api/analysis-sessions", {
        title: "Uploaded Audio route",
        mode: "transcript_lab",
      }),
    );
    sessionId = ((await response.json()) as { session: { id: string } }).session
      .id;
  });

  afterEach(() => {
    try {
      resetDatabaseForTests();
    } finally {
      try {
        for (const name of testEnvironmentNames)
          restoreEnvironment(name, originalEnvironment[name]);
        resetServerEnvForTests();
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  });

  async function upload(options?: Parameters<typeof uploadRequest>[1]) {
    const response = await postUploadedAudio(
      uploadRequest(sessionId, options),
      {
        params: Promise.resolve({ id: sessionId }),
      },
    );
    return response;
  }

  async function runWorker() {
    const worker = new UploadedAudioTranscriptionWorker(
      new SqliteTranscriptionJobQueue(getDatabase().db),
      new FilesystemUploadedAudioStorage(join(directory, "audio")),
      new FakeAudioTranscriptionProvider(),
      new TranscriptIngestionService(
        new SqliteAnalysisRepository(getDatabase().db),
      ),
    );
    try {
      return await worker.runOneIteration();
    } finally {
      worker.stop();
    }
  }

  async function transcribe(assetId: string, actionId: string) {
    return transcribeUploadedAudio(
      jsonRequest(
        `/api/analysis-sessions/${sessionId}/uploaded-audio/${assetId}/transcribe`,
        { actionId },
      ),
      { params: Promise.resolve({ id: sessionId, assetId }) },
    );
  }

  it("uploads explicitly under no-store without transcription side effects", async () => {
    const uploaded = await upload({ filename: "../../visible.wav" });
    expect(uploaded.status).toBe(201);
    expect(uploaded.headers.get("cache-control")).toBe("no-store");
    const payload = (await uploaded.json()) as {
      asset: { id: string; status: string };
    };
    expect(payload.asset.status).toBe("uploaded");
    expect(payload.asset).not.toHaveProperty("relativePath");

    const getResponse = await listUploadedAudio(new Request(origin), {
      params: Promise.resolve({ id: sessionId }),
    });
    expect(getResponse.headers.get("cache-control")).toBe("no-store");
    const listedPayload = await getResponse.json();
    expect(listedPayload).toMatchObject({
      assets: [{ id: payload.asset.id, status: "uploaded" }],
      maximumBytes: 1024,
    });
    expect(
      (listedPayload as { assets: Array<{ latestJob: unknown }> }).assets[0]
        .latestJob,
    ).toBeNull();
    expectPublicResponse(listedPayload);
    const sessionResponse = await getAnalysisSession(new Request(origin), {
      params: Promise.resolve({ id: sessionId }),
    });
    expect(await sessionResponse.json()).toMatchObject({ segments: [] });
  });

  it("requires same origin and strict multipart/JSON bodies", async () => {
    const noOrigin = await postUploadedAudio(
      uploadRequest(sessionId, { origin: false }),
      { params: Promise.resolve({ id: sessionId }) },
    );
    expect(noOrigin.status).toBe(403);
    const extra = await upload({ extra: true });
    expect(extra.status).toBe(400);

    const uploaded = await upload({ actionId: uuid(2) });
    const assetId = ((await uploaded.json()) as { asset: { id: string } }).asset
      .id;
    const forged = await transcribeUploadedAudio(
      jsonRequest(
        `/api/analysis-sessions/${sessionId}/uploaded-audio/${assetId}/transcribe`,
        { actionId: uuid(3), transcript: "forged" },
      ),
      { params: Promise.resolve({ id: sessionId, assetId }) },
    );
    expect(forged.status).toBe(400);
    expect(await forged.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it.each([null, "", "-1", "NaN", "1.5", "0"])(
    "rejects invalid pre-parse Content-Length %s without parsing form data",
    async (contentLength) => {
      const request = uploadRequest(sessionId, { contentLength });
      const formData = vi.fn();
      Object.defineProperty(request, "formData", { value: formData });
      const response = await postUploadedAudio(request, {
        params: Promise.resolve({ id: sessionId }),
      });
      expect(response.status).toBe(413);
      expect(formData).not.toHaveBeenCalled();
    },
  );

  it("rejects excessive Content-Length before parsing form data", async () => {
    const request = uploadRequest(sessionId, {
      contentLength: String(1_024 + 65_536 + 1),
    });
    const formData = vi.fn();
    Object.defineProperty(request, "formData", { value: formData });
    const response = await postUploadedAudio(request, {
      params: Promise.resolve({ id: sessionId }),
    });
    expect(response.status).toBe(413);
    expect(formData).not.toHaveBeenCalled();
  });

  it("rejects unsupported, empty, oversized, and signature-mismatched files", async () => {
    expect((await upload({ filename: "audio.exe" })).status).toBe(415);
    expect(
      (await upload({ bytes: new Uint8Array(), actionId: uuid(4) })).status,
    ).toBe(413);
    expect(
      (await upload({ bytes: wavBytes(1025), actionId: uuid(5) })).status,
    ).toBe(413);
    expect(
      (
        await upload({
          bytes: new Uint8Array(44),
          actionId: uuid(6),
        })
      ).status,
    ).toBe(415);
  });

  it("returns a private-field-free 503 without enqueuing when worker or provider configuration is disabled", async () => {
    const uploaded = await upload({ actionId: uuid(40) });
    const assetId = ((await uploaded.json()) as { asset: { id: string } }).asset
      .id;
    const originalWorker =
      process.env.UPLOADED_AUDIO_TRANSCRIPTION_WORKER_ENABLED;
    const originalProvider = process.env.UPLOADED_AUDIO_FAKE_TRANSCRIPTION_ENABLED;
    try {
      for (const disabled of [
        "UPLOADED_AUDIO_TRANSCRIPTION_WORKER_ENABLED",
        "UPLOADED_AUDIO_FAKE_TRANSCRIPTION_ENABLED",
      ]) {
        process.env.UPLOADED_AUDIO_TRANSCRIPTION_WORKER_ENABLED = "true";
        process.env.UPLOADED_AUDIO_FAKE_TRANSCRIPTION_ENABLED = "true";
        process.env[disabled] = "false";
        resetServerEnvForTests();
        const response = await transcribe(assetId, uuid(41));
        expect(response.status).toBe(503);
        expect(response.headers.get("cache-control")).toContain("no-store");
        expect(response.headers.get("pragma")).toBe("no-cache");
        expect(response.headers.get("retry-after")).toBeNull();
        expect(response.headers.get("location")).toBeNull();
        const payload = await response.json();
        expect(payload).toMatchObject({
          error: { code: "UPLOADED_AUDIO_WORKER_UNAVAILABLE" },
        });
        expectPublicResponse(payload);
        expect(
          getDatabase()
            .sqlite.prepare(
              "select count(*) as count from uploaded_audio_transcription_jobs",
            )
            .get(),
        ).toEqual({ count: 0 });
      }
    } finally {
      restoreEnvironment(
        "UPLOADED_AUDIO_TRANSCRIPTION_WORKER_ENABLED",
        originalWorker,
      );
      restoreEnvironment(
        "UPLOADED_AUDIO_FAKE_TRANSCRIPTION_ENABLED",
        originalProvider,
      );
      resetServerEnvForTests();
    }
  });

  it("reuses the same queued job without running the provider", async () => {
    const uploaded = await upload({ actionId: uuid(42) });
    const assetId = ((await uploaded.json()) as { asset: { id: string } }).asset
      .id;
    const actionId = uuid(43);
    const provider = vi.spyOn(
      FakeAudioTranscriptionProvider.prototype,
      "transcribe",
    );
    try {
      const first = await transcribe(assetId, actionId);
      const firstPayload = (await first.json()) as {
        job: { id: string; status: string };
        duplicated: boolean;
      };
      const duplicate = await transcribe(assetId, actionId);
      const duplicatePayload = (await duplicate.json()) as {
        job: { id: string; status: string };
        duplicated: boolean;
      };
      for (const response of [first, duplicate]) {
        expect(response.status).toBe(202);
        expect(response.headers.get("cache-control")).toContain("no-store");
        expect(response.headers.get("pragma")).toBe("no-cache");
        expect(response.headers.get("retry-after")).toBe("1");
        expect(response.headers.get("location")).toBe(
          `/api/analysis-sessions/${sessionId}/uploaded-audio`,
        );
      }
      expect(firstPayload).toMatchObject({
        duplicated: false,
        job: { status: "queued" },
      });
      expect(duplicatePayload).toMatchObject({
        duplicated: true,
        job: { id: firstPayload.job.id, status: "queued" },
      });
      expectPublicResponse(firstPayload);
      expectPublicResponse(duplicatePayload);
      expect(provider).not.toHaveBeenCalled();
    } finally {
      provider.mockRestore();
    }
  });

  it("reuses a claimed running job without creating another job", async () => {
    const uploaded = await upload({ actionId: uuid(44) });
    const assetId = ((await uploaded.json()) as { asset: { id: string } }).asset
      .id;
    const actionId = uuid(45);
    const first = await transcribe(assetId, actionId);
    const firstPayload = (await first.json()) as { job: { id: string } };
    const now = Date.now();
    const claimed = new SqliteTranscriptionJobQueue(
      getDatabase().db,
    ).claimNext({
      now,
      leaseToken: "route-running-lease",
      leaseDurationMs: 120_000,
    });
    expect(claimed).toMatchObject({
      id: firstPayload.job.id,
      status: "running",
    });

    const duplicate = await transcribe(assetId, actionId);
    expect(duplicate.status).toBe(202);
    const payload = await duplicate.json();
    expect(payload).toMatchObject({
      duplicated: true,
      job: { id: firstPayload.job.id, status: "running" },
    });
    expectPublicResponse(payload);
    expect(
      getDatabase()
        .sqlite.prepare(
          "select count(*) as count from uploaded_audio_transcription_jobs where asset_id = ?",
        )
        .get(assetId),
    ).toEqual({ count: 1 });
  });

  it("returns a duplicate failed terminal job with terminal contract headers", async () => {
    const uploaded = await upload({ actionId: uuid(46) });
    const assetId = ((await uploaded.json()) as { asset: { id: string } }).asset
      .id;
    const actionId = uuid(47);
    const first = await transcribe(assetId, actionId);
    const firstPayload = (await first.json()) as { job: { id: string } };
    const now = Date.now();
    const queue = new SqliteTranscriptionJobQueue(getDatabase().db);
    const claimed = queue.claimNext({
      now,
      leaseToken: "route-failed-lease",
      leaseDurationMs: 120_000,
    });
    expect(claimed?.id).toBe(firstPayload.job.id);
    expect(
      queue.fail({
        jobId: firstPayload.job.id,
        leaseToken: "route-failed-lease",
        now: now + 1,
        safeErrorCode: "UPLOADED_AUDIO_PROVIDER_TEMPORARY",
        retryAt: null,
      }),
    ).toMatchObject({ kind: "updated", job: { status: "failed" } });

    const duplicate = await transcribe(assetId, actionId);
    expect(duplicate.status).toBe(200);
    expect(duplicate.headers.get("cache-control")).toContain("no-store");
    expect(duplicate.headers.get("pragma")).toBe("no-cache");
    expect(duplicate.headers.get("retry-after")).toBeNull();
    expect(duplicate.headers.get("location")).toBe(
      `/api/analysis-sessions/${sessionId}/uploaded-audio`,
    );
    const payload = await duplicate.json();
    expect(payload).toMatchObject({
      duplicated: true,
      job: { id: firstPayload.job.id, status: "failed" },
    });
    expectPublicResponse(payload);
  });

  it("returns no-job, queued, and failed GET summaries without private fields", async () => {
    const noJobUpload = await upload({ actionId: uuid(48) });
    const noJobId = (
      (await noJobUpload.json()) as { asset: { id: string } }
    ).asset.id;
    const queuedUpload = await upload({ actionId: uuid(49) });
    const queuedId = (
      (await queuedUpload.json()) as { asset: { id: string } }
    ).asset.id;
    const failedUpload = await upload({ actionId: uuid(50) });
    const failedId = (
      (await failedUpload.json()) as { asset: { id: string } }
    ).asset.id;

    const failedPost = await transcribe(failedId, uuid(51));
    const failedJobId = (
      (await failedPost.json()) as { job: { id: string } }
    ).job.id;
    const now = Date.now();
    const queue = new SqliteTranscriptionJobQueue(getDatabase().db);
    const claimed = queue.claimNext({
      now,
      leaseToken: "get-summary-failed-lease",
      leaseDurationMs: 120_000,
    });
    expect(claimed?.id).toBe(failedJobId);
    queue.fail({
      jobId: failedJobId,
      leaseToken: "get-summary-failed-lease",
      now: now + 1,
      safeErrorCode: "UPLOADED_AUDIO_PROVIDER_TEMPORARY",
      retryAt: null,
    });
    const queuedPost = await transcribe(queuedId, uuid(52));
    const queuedJobId = (
      (await queuedPost.json()) as { job: { id: string } }
    ).job.id;

    const response = await listUploadedAudio(new Request(origin), {
      params: Promise.resolve({ id: sessionId }),
    });
    const payload = (await response.json()) as {
      assets: Array<{
        id: string;
        latestJob: null | {
          id: string;
          status: string;
          safeErrorCode: string | null;
        };
      }>;
    };
    expect(
      payload.assets.find((asset) => asset.id === noJobId)?.latestJob,
    ).toBeNull();
    expect(
      payload.assets.find((asset) => asset.id === queuedId)?.latestJob,
    ).toMatchObject({ id: queuedJobId, status: "queued" });
    expect(
      payload.assets.find((asset) => asset.id === failedId)?.latestJob,
    ).toMatchObject({
      id: failedJobId,
      status: "failed",
      safeErrorCode: "UPLOADED_AUDIO_PROVIDER_TEMPORARY",
    });
    expectPublicResponse(payload);
  });

  it("uses id DESC to break equal-createdAt ties for the latest terminal job", async () => {
    const uploaded = await upload({ actionId: uuid(53) });
    const assetId = ((await uploaded.json()) as { asset: { id: string } }).asset
      .id;
    const lowerJobId = uuid(54);
    const higherJobId = uuid(55);
    const lowerActionId = uuid(56);
    const higherActionId = uuid(57);
    const sqlite = getDatabase().sqlite;
    const insert = sqlite.transaction(() => {
      const action = sqlite.prepare(
        `insert into uploaded_audio_actions
          (id, analysis_session_id, action_id, action_type, asset_id, created_at)
         values (?, ?, ?, 'transcribe', ?, ?)`,
      );
      action.run("tie-action-lower", sessionId, lowerActionId, assetId, 5_000);
      action.run("tie-action-higher", sessionId, higherActionId, assetId, 5_000);
      const job = sqlite.prepare(
        `insert into uploaded_audio_transcription_jobs
          (id, analysis_session_id, asset_id, action_id, status, attempt_count,
           maximum_attempts, available_at, lease_token, lease_expires_at,
           started_at, completed_at, failed_at, cancelled_at, safe_error_code,
           created_at, updated_at)
         values (?, ?, ?, ?, 'failed', 1, 3, ?, null, null, ?, null, ?, null, ?, ?, ?)`,
      );
      job.run(
        lowerJobId,
        sessionId,
        assetId,
        lowerActionId,
        5_000,
        5_100,
        5_200,
        "LOWER_JOB_FAILED",
        5_000,
        5_200,
      );
      job.run(
        higherJobId,
        sessionId,
        assetId,
        higherActionId,
        5_000,
        5_100,
        5_200,
        "HIGHER_JOB_FAILED",
        5_000,
        5_200,
      );
    });
    insert();

    const response = await listUploadedAudio(new Request(origin), {
      params: Promise.resolve({ id: sessionId }),
    });
    const payload = (await response.json()) as {
      assets: Array<{
        id: string;
        latestJob: { id: string; safeErrorCode: string } | null;
      }>;
    };
    expect(
      payload.assets.find((asset) => asset.id === assetId)?.latestJob,
    ).toMatchObject({
      id: higherJobId,
      safeErrorCode: "HIGHER_JOB_FAILED",
    });
    expectPublicResponse(payload);
  });

  it("transcribes only on explicit POST, is idempotent, and feeds Question Boundary", async () => {
    const uploadAction = uuid(7);
    const first = await upload({ actionId: uploadAction });
    const firstPayload = (await first.json()) as { asset: { id: string } };
    const duplicate = await upload({ actionId: uploadAction });
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({
      duplicated: true,
      asset: { id: firstPayload.asset.id },
    });

    const actionId = uuid(8);
    const transcribed = await transcribeUploadedAudio(
      jsonRequest(
        `/api/analysis-sessions/${sessionId}/uploaded-audio/${firstPayload.asset.id}/transcribe`,
        { actionId },
      ),
      {
        params: Promise.resolve({
          id: sessionId,
          assetId: firstPayload.asset.id,
        }),
      },
    );
    expect(transcribed.status).toBe(202);
    expect(transcribed.headers.get("retry-after")).toBe("1");
    expect(transcribed.headers.get("location")).toBe(
      `/api/analysis-sessions/${sessionId}/uploaded-audio`,
    );
    expect(await transcribed.json()).toMatchObject({
      job: { status: "queued", attemptCount: 0 },
    });
    await expect(runWorker()).resolves.toBe(true);
    const repeated = await transcribeUploadedAudio(
      jsonRequest(
        `/api/analysis-sessions/${sessionId}/uploaded-audio/${firstPayload.asset.id}/transcribe`,
        { actionId },
      ),
      {
        params: Promise.resolve({
          id: sessionId,
          assetId: firstPayload.asset.id,
        }),
      },
    );
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toMatchObject({
      duplicated: true,
      job: { status: "completed" },
    });

    const sessionResponse = await getAnalysisSession(new Request(origin), {
      params: Promise.resolve({ id: sessionId }),
    });
    const sessionPayload = (await sessionResponse.json()) as {
      segments: Array<{ speakerRole: string }>;
    };
    expect(sessionPayload.segments).toHaveLength(2);
    expect(
      sessionPayload.segments.every(
        (segment) => segment.speakerRole === "interviewer",
      ),
    ).toBe(true);
    const boundary = await getQuestionBoundary(new Request(origin), {
      params: Promise.resolve({ id: sessionId }),
    });
    expect(await boundary.json()).toMatchObject({
      candidate: { speakerRole: "interviewer" },
    });
  });

  it("deletes metadata/bytes but keeps committed transcript state", async () => {
    const uploaded = await upload({ actionId: uuid(9) });
    const assetId = ((await uploaded.json()) as { asset: { id: string } }).asset
      .id;
    await transcribeUploadedAudio(
      jsonRequest(
        `/api/analysis-sessions/${sessionId}/uploaded-audio/${assetId}/transcribe`,
        { actionId: uuid(10) },
      ),
      { params: Promise.resolve({ id: sessionId, assetId }) },
    );
    await runWorker();
    const deletion = await deleteUploadedAudio(
      jsonRequest(
        `/api/analysis-sessions/${sessionId}/uploaded-audio/${assetId}`,
        { actionId: uuid(11) },
        "DELETE",
      ),
      { params: Promise.resolve({ id: sessionId, assetId }) },
    );
    expect(await deletion.json()).toEqual({ deleted: true, duplicated: false });
    const listed = await listUploadedAudio(new Request(origin), {
      params: Promise.resolve({ id: sessionId }),
    });
    expect(await listed.json()).toMatchObject({ assets: [] });
    const session = await getAnalysisSession(new Request(origin), {
      params: Promise.resolve({ id: sessionId }),
    });
    expect((await session.json()) as { segments: unknown[] }).toMatchObject({
      segments: [{}, {}],
    });
    expect(existsSync(join(directory, "audio", sessionId))).toBe(true);
  });

  it("enforces session ownership and no-store errors", async () => {
    const uploaded = await upload({ actionId: uuid(12) });
    const assetId = ((await uploaded.json()) as { asset: { id: string } }).asset
      .id;
    const otherResponse = await createAnalysisSession(
      jsonRequest("/api/analysis-sessions", {
        title: "Other",
        mode: "transcript_lab",
      }),
    );
    const otherId = (
      (await otherResponse.json()) as { session: { id: string } }
    ).session.id;
    const response = await transcribeUploadedAudio(
      jsonRequest(
        `/api/analysis-sessions/${otherId}/uploaded-audio/${assetId}/transcribe`,
        { actionId: uuid(13) },
      ),
      { params: Promise.resolve({ id: otherId, assetId }) },
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
