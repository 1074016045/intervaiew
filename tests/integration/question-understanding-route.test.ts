import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { POST as createSession } from "@/app/api/analysis-sessions/route";
import { POST as postSegment } from "@/app/api/analysis-sessions/[id]/transcript-segments/route";
import { GET as getBoundary } from "@/app/api/analysis-sessions/[id]/question-boundary/route";
import { POST as forceFinalize } from "@/app/api/analysis-sessions/[id]/question-boundary/force-finalize/route";
import { GET as getUnderstanding } from "@/app/api/analysis-sessions/[id]/question-understanding/route";
import { POST as analyzeUnderstanding } from "@/app/api/analysis-sessions/[id]/question-understanding/analyze/route";
import { getDatabase, resetDatabaseForTests } from "@/infrastructure/db/client";
import { resetServerEnvForTests } from "@/infrastructure/env/server-env";

const origin = "http://localhost";
function mutation(path: string, body: unknown, withOrigin = true) { return new Request(`${origin}${path}`, { method: "POST", headers: { ...(withOrigin ? { Origin: origin } : {}), "Content-Type": "application/json" }, body: JSON.stringify(body) }); }

describe("Question Understanding route handlers", () => {
  let directory: string, sessionId: string, questionId: string;
  beforeEach(async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    directory = mkdtempSync(join(tmpdir(), "intervaiew-understanding-route-")); resetDatabaseForTests(); process.env.DATABASE_PATH = join(directory, "route.db"); process.env.QUESTION_UNDERSTANDING_FAKE_SEMANTIC_ENABLED = "true"; resetServerEnvForTests();
    migrate(getDatabase().db, { migrationsFolder: resolve("src/infrastructure/db/migrations") });
    const created = await createSession(mutation("/api/analysis-sessions", { title: "Understanding route", mode: "transcript_lab" })); sessionId = ((await created.json()) as { session: { id: string } }).session.id;
    await postSegment(mutation(`/api/analysis-sessions/${sessionId}/transcript-segments`, { providerChunkId: "understanding-0", sourceSessionId: sessionId, sequence: 0, speakerRole: "interviewer", text: "Implement an algorithm using Python and discuss testing.", isFinal: true, startMs: 0, endMs: 500, createdAt: Date.now() }), { params: Promise.resolve({ id: sessionId }) });
    const boundary = await getBoundary(new Request(origin), { params: Promise.resolve({ id: sessionId }) }); const candidate = (await boundary.json()) as { candidate: { revision: number } };
    const finalized = await forceFinalize(mutation(`/api/analysis-sessions/${sessionId}/question-boundary/force-finalize`, { actionId: "force-route", candidateRevision: candidate.candidate.revision }), { params: Promise.resolve({ id: sessionId }) }); questionId = ((await finalized.json()) as { finalizedQuestions: Array<{ id: string }> }).finalizedQuestions[0].id;
  });
  afterEach(() => { resetDatabaseForTests(); resetServerEnvForTests(); delete process.env.DATABASE_PATH; delete process.env.QUESTION_UNDERSTANDING_FAKE_SEMANTIC_ENABLED; rmSync(directory, { recursive: true, force: true }); });

  it("returns active questions without analyzing on GET", async () => {
    const response = await getUnderstanding(new Request(origin), { params: Promise.resolve({ id: sessionId }) }); const payload = await response.json();
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store"); expect(payload).toMatchObject({ questions: [{ understanding: null }] });
  });
  it("requires same-origin analysis", async () => {
    const response = await analyzeUnderstanding(mutation(`/api/analysis-sessions/${sessionId}/question-understanding/analyze`, { finalizedQuestionId: questionId, actionId: "analyze-route" }, false), { params: Promise.resolve({ id: sessionId }) }); expect(response.status).toBe(403);
  });
  it("rejects client classifications, text, confidence, and provider output", async () => {
    const response = await analyzeUnderstanding(mutation(`/api/analysis-sessions/${sessionId}/question-understanding/analyze`, { finalizedQuestionId: questionId, actionId: "forged", text: "replacement", questionFamily: "coding", confidence: 1, providerOutput: {} }), { params: Promise.resolve({ id: sessionId }) });
    expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });
  it("requires an idempotent action ID", async () => {
    const response = await analyzeUnderstanding(mutation(`/api/analysis-sessions/${sessionId}/question-understanding/analyze`, { finalizedQuestionId: questionId }), { params: Promise.resolve({ id: sessionId }) }); expect(response.status).toBe(400);
  });
  it("analyzes idempotently without raw provider or reasoning fields", async () => {
    const request = () => analyzeUnderstanding(mutation(`/api/analysis-sessions/${sessionId}/question-understanding/analyze`, { finalizedQuestionId: questionId, actionId: "same-route-action" }), { params: Promise.resolve({ id: sessionId }) });
    const first = await request(); const firstPayload = await first.json(); const second = await request(); const secondPayload = await second.json();
    expect(first.status).toBe(200); expect(first.headers.get("cache-control")).toBe("no-store"); expect(firstPayload).toMatchObject({ duplicated: false, questions: [{ understanding: { questionFamily: "coding", semanticProviderUsed: false } }] }); expect(secondPayload.duplicated).toBe(true); expect(JSON.stringify(firstPayload)).not.toMatch(/"reasoning"|rawRequest|rawResponse|"answer"/iu);
  });
});
