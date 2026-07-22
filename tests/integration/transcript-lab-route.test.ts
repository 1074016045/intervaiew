import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getDatabase, resetDatabaseForTests } from "@/infrastructure/db/client";
import { resetServerEnvForTests } from "@/infrastructure/env/server-env";
import { POST as createAnalysisSession } from "@/app/api/analysis-sessions/route";
import {
  DELETE as deleteAnalysisSession,
  GET as getAnalysisSession,
} from "@/app/api/analysis-sessions/[id]/route";
import { POST as postTranscriptSegment } from "@/app/api/analysis-sessions/[id]/transcript-segments/route";
import type { TranscriptChunk } from "@/features/question-intelligence/domain/transcript";

const origin = "http://localhost";

function mutation(path: string, body?: unknown, method = "POST") {
  return new Request(`${origin}${path}`, {
    method,
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("Transcript Lab route handlers", () => {
  let directory: string;
  let sessionId: string;

  beforeEach(async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    directory = mkdtempSync(join(tmpdir(), "intervaiew-transcript-route-"));
    resetDatabaseForTests();
    process.env.DATABASE_PATH = join(directory, "route.db");
    resetServerEnvForTests();
    migrate(getDatabase().db, {
      migrationsFolder: resolve("src/infrastructure/db/migrations"),
    });
    const response = await createAnalysisSession(
      mutation("/api/analysis-sessions", {
        title: "Route Transcript Lab",
        mode: "transcript_lab",
      }),
    );
    const payload = (await response.json()) as { session: { id: string } };
    sessionId = payload.session.id;
  });

  afterEach(() => {
    resetDatabaseForTests();
    resetServerEnvForTests();
    delete process.env.DATABASE_PATH;
    rmSync(directory, { recursive: true, force: true });
  });

  function chunk(change?: Partial<TranscriptChunk>): TranscriptChunk {
    return {
      providerChunkId: "route-provider-0",
      sourceSessionId: sessionId,
      sequence: 0,
      speakerRole: "interviewer",
      text: "A finalized route transcript.",
      isFinal: true,
      startMs: 0,
      endMs: 500,
      createdAt: 1_700_000_000_000,
      ...change,
    };
  }

  it("creates and gets a no-store analysis session", async () => {
    const response = await getAnalysisSession(new Request(origin), {
      params: Promise.resolve({ id: sessionId }),
    });
    const payload = (await response.json()) as {
      session: { id: string; title: string };
      segments: unknown[];
    };
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(payload).toMatchObject({
      session: { id: sessionId, title: "Route Transcript Lab" },
      segments: [],
    });
  });

  it("rejects an interim API request with a stable error", async () => {
    const response = await postTranscriptSegment(
      mutation(
        `/api/analysis-sessions/${sessionId}/transcript-segments`,
        chunk({ isFinal: false }),
      ),
      { params: Promise.resolve({ id: sessionId }) },
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      error: { code: "TRANSCRIPT_SEGMENT_NOT_FINAL" },
    });
  });

  it("returns duplicate finals and sequence conflicts with explicit HTTP semantics", async () => {
    const context = { params: Promise.resolve({ id: sessionId }) };
    const first = await postTranscriptSegment(
      mutation(
        `/api/analysis-sessions/${sessionId}/transcript-segments`,
        chunk(),
      ),
      context,
    );
    expect(first.status).toBe(201);
    const duplicate = await postTranscriptSegment(
      mutation(
        `/api/analysis-sessions/${sessionId}/transcript-segments`,
        chunk({ text: "A retry is idempotent." }),
      ),
      { params: Promise.resolve({ id: sessionId }) },
    );
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({ duplicated: true });
    const conflict = await postTranscriptSegment(
      mutation(
        `/api/analysis-sessions/${sessionId}/transcript-segments`,
        chunk({ providerChunkId: "different-provider" }),
      ),
      { params: Promise.resolve({ id: sessionId }) },
    );
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      error: { code: "TRANSCRIPT_SEGMENT_SEQUENCE_CONFLICT" },
    });
  });

  it("requires same-origin mutations and deletes idempotently", async () => {
    const rejected = await createAnalysisSession(
      new Request(`${origin}/api/analysis-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Rejected", mode: "transcript_lab" }),
      }),
    );
    expect(rejected.status).toBe(403);
    const deleted = await deleteAnalysisSession(
      mutation(`/api/analysis-sessions/${sessionId}`, undefined, "DELETE"),
      { params: Promise.resolve({ id: sessionId }) },
    );
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ deleted: true });
    const repeated = await deleteAnalysisSession(
      mutation(`/api/analysis-sessions/${sessionId}`, undefined, "DELETE"),
      { params: Promise.resolve({ id: sessionId }) },
    );
    expect(await repeated.json()).toEqual({ deleted: false });
  });
});
