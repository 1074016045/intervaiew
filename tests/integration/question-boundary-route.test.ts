import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { POST as createSession } from "@/app/api/analysis-sessions/route";
import { POST as postSegment } from "@/app/api/analysis-sessions/[id]/transcript-segments/route";
import { GET as getBoundary } from "@/app/api/analysis-sessions/[id]/question-boundary/route";
import { POST as evaluateBoundary } from "@/app/api/analysis-sessions/[id]/question-boundary/evaluate/route";
import { getDatabase, resetDatabaseForTests } from "@/infrastructure/db/client";
import { resetServerEnvForTests } from "@/infrastructure/env/server-env";

const origin = "http://localhost";

function mutation(path: string, body: unknown, withOrigin = true) {
  return new Request(`${origin}${path}`, {
    method: "POST",
    headers: {
      ...(withOrigin ? { Origin: origin } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("Question Boundary route handlers", () => {
  let directory: string;
  let sessionId: string;

  beforeEach(async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    directory = mkdtempSync(join(tmpdir(), "intervaiew-boundary-route-"));
    resetDatabaseForTests();
    process.env.DATABASE_PATH = join(directory, "route.db");
    process.env.QUESTION_BOUNDARY_FAKE_SEMANTIC_ENABLED = "true";
    resetServerEnvForTests();
    migrate(getDatabase().db, {
      migrationsFolder: resolve("src/infrastructure/db/migrations"),
    });
    const created = await createSession(
      mutation("/api/analysis-sessions", {
        title: "Boundary route",
        mode: "transcript_lab",
      }),
    );
    sessionId = ((await created.json()) as { session: { id: string } }).session
      .id;
    await postSegment(
      mutation(`/api/analysis-sessions/${sessionId}/transcript-segments`, {
        providerChunkId: "route-boundary-0",
        sourceSessionId: sessionId,
        sequence: 0,
        speakerRole: "interviewer",
        text: "Why did you choose data science",
        isFinal: true,
        startMs: 0,
        endMs: 500,
        createdAt: Date.now() - 1000,
      }),
      { params: Promise.resolve({ id: sessionId }) },
    );
  });

  afterEach(() => {
    resetDatabaseForTests();
    resetServerEnvForTests();
    delete process.env.DATABASE_PATH;
    delete process.env.QUESTION_BOUNDARY_FAKE_SEMANTIC_ENABLED;
    rmSync(directory, { recursive: true, force: true });
  });

  async function state() {
    const response = await getBoundary(new Request(origin), {
      params: Promise.resolve({ id: sessionId }),
    });
    return {
      response,
      payload: (await response.json()) as {
        candidate: { revision: number } | null;
        finalizedQuestions: unknown[];
      },
    };
  }

  it("returns no-store provider-neutral boundary state", async () => {
    const { response, payload } = await state();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(payload.candidate?.revision).toBe(1);
    expect(JSON.stringify(payload)).not.toContain("raw");
  });

  it("requires same-origin for evaluation", async () => {
    const response = await evaluateBoundary(
      mutation(
        `/api/analysis-sessions/${sessionId}/question-boundary/evaluate`,
        { actionId: "route-evaluate", candidateRevision: 1 },
        false,
      ),
      { params: Promise.resolve({ id: sessionId }) },
    );
    expect(response.status).toBe(403);
  });

  it("rejects unknown client decision fields", async () => {
    const response = await evaluateBoundary(
      mutation(
        `/api/analysis-sessions/${sessionId}/question-boundary/evaluate`,
        {
          actionId: "route-forged",
          candidateRevision: 1,
          shouldFinalize: true,
          confidence: 1,
        },
      ),
      { params: Promise.resolve({ id: sessionId }) },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it("requires an action id", async () => {
    const response = await evaluateBoundary(
      mutation(
        `/api/analysis-sessions/${sessionId}/question-boundary/evaluate`,
        {
          candidateRevision: 1,
        },
      ),
      { params: Promise.resolve({ id: sessionId }) },
    );
    expect(response.status).toBe(400);
  });

  it("finalizes idempotently without exposing database details", async () => {
    const request = () =>
      evaluateBoundary(
        mutation(
          `/api/analysis-sessions/${sessionId}/question-boundary/evaluate`,
          {
            actionId: "route-same",
            candidateRevision: 1,
          },
        ),
        { params: Promise.resolve({ id: sessionId }) },
      );
    const first = await request();
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(
      (await first.json()) as { finalizedQuestions: unknown[] },
    ).toMatchObject({
      finalizedQuestions: [expect.any(Object)],
      duplicated: false,
    });
    const duplicate = await request();
    const payload = await duplicate.json();
    expect(payload).toMatchObject({ duplicated: true });
    expect(JSON.stringify(payload)).not.toMatch(
      /SQL|stack|provider response/iu,
    );
  });
});
