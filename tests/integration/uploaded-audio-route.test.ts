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

const origin = "http://localhost";

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

  beforeEach(async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    directory = mkdtempSync(join(tmpdir(), "intervaiew-upload-route-"));
    resetDatabaseForTests();
    process.env.DATABASE_PATH = join(directory, "route.db");
    process.env.UPLOADED_AUDIO_PATH = join(directory, "audio");
    process.env.UPLOADED_AUDIO_ENABLED = "true";
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
    resetDatabaseForTests();
    resetServerEnvForTests();
    delete process.env.DATABASE_PATH;
    delete process.env.UPLOADED_AUDIO_PATH;
    delete process.env.UPLOADED_AUDIO_ENABLED;
    delete process.env.UPLOADED_AUDIO_FAKE_TRANSCRIPTION_ENABLED;
    delete process.env.UPLOADED_AUDIO_MAX_BYTES;
    rmSync(directory, { recursive: true, force: true });
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
    expect(await getResponse.json()).toMatchObject({
      assets: [{ id: payload.asset.id, status: "uploaded" }],
      maximumBytes: 1024,
    });
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
    expect(transcribed.status).toBe(200);
    expect(await transcribed.json()).toMatchObject({
      asset: { status: "completed", transcriptSegmentCount: 2 },
    });
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
    expect(await repeated.json()).toMatchObject({ duplicated: true });

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
