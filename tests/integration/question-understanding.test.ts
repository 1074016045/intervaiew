import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDatabase } from "@/infrastructure/db/client";
import { analysisSessions, questionUnderstandings } from "@/infrastructure/db/schema";
import { SqliteAnalysisRepository } from "@/features/question-intelligence/infrastructure/sqlite/sqlite-analysis-repository";
import { SqliteQuestionBoundaryRepository } from "@/features/question-intelligence/infrastructure/sqlite/sqlite-question-boundary-repository";
import { SqliteQuestionUnderstandingRepository } from "@/features/question-intelligence/infrastructure/sqlite/sqlite-question-understanding-repository";
import { AnalysisSessionService } from "@/features/question-intelligence/application/analysis-session-service";
import { TranscriptIngestionService } from "@/features/question-intelligence/application/transcript-ingestion-service";
import { DeterministicQuestionBoundaryDetector } from "@/features/question-intelligence/application/deterministic-question-boundary-detector";
import { HybridQuestionBoundaryDetector } from "@/features/question-intelligence/application/hybrid-question-boundary-detector";
import { QuestionSegmentationService } from "@/features/question-intelligence/application/question-segmentation-service";
import { DeterministicQuestionUnderstander } from "@/features/question-intelligence/application/deterministic-question-understander";
import { HybridQuestionUnderstander } from "@/features/question-intelligence/application/hybrid-question-understander";
import { QuestionUnderstandingService } from "@/features/question-intelligence/application/question-understanding-service";
import { FakeSemanticQuestionBoundaryProvider } from "@/features/question-intelligence/infrastructure/fake/fake-semantic-question-boundary-provider";
import { FakeQuestionUnderstandingProvider } from "@/features/question-intelligence/infrastructure/fake/fake-question-understanding-provider";
import type { QuestionUnderstandingProviderPort } from "@/features/question-intelligence/application/question-understanding-provider.port";

describe("Question Understanding SQLite integration", () => {
  let directory: string, connection: ReturnType<typeof createDatabase>, now: number, id: number;
  let sessions: AnalysisSessionService, ingestion: TranscriptIngestionService, boundary: QuestionSegmentationService, understanding: QuestionUnderstandingService, sessionId: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "intervaiew-understanding-")); connection = createDatabase(join(directory, "test.db"));
    migrate(connection.db, { migrationsFolder: resolve("src/infrastructure/db/migrations") }); now = 1_700_100_000_000; id = 0;
    const analysis = new SqliteAnalysisRepository(connection.db, () => `row-${id++}`, () => now);
    sessions = new AnalysisSessionService(analysis); ingestion = new TranscriptIngestionService(analysis);
    const detector = new DeterministicQuestionBoundaryDetector();
    boundary = new QuestionSegmentationService(new SqliteQuestionBoundaryRepository(connection.db, () => `boundary-${id++}`), detector, new HybridQuestionBoundaryDetector(detector, new FakeSemanticQuestionBoundaryProvider(), { shortPauseMs: 500, mediumPauseMs: 1400, longPauseMs: 3000 }, () => `decision-${id++}`, () => now), () => `manual-${id++}`, () => now);
    understanding = createUnderstanding(); sessionId = sessions.create({ title: "Understanding", mode: "transcript_lab" }).id;
  });
  afterEach(() => { connection.sqlite.close(); rmSync(directory, { recursive: true, force: true }); });

  function createUnderstanding(fake: QuestionUnderstandingProviderPort = new FakeQuestionUnderstandingProvider()) {
    return new QuestionUnderstandingService(new SqliteQuestionUnderstandingRepository(connection.db, () => `understanding-row-${id++}`), new HybridQuestionUnderstander(new DeterministicQuestionUnderstander(), fake), () => `understanding-${id++}`, () => now);
  }
  function untraceableProvider(field: "constraint" | "focus"): QuestionUnderstandingProviderPort {
    const base = new FakeQuestionUnderstandingProvider();
    return {
      name: "fake",
      async analyze(input, signal) {
        const result = await base.analyze(input, signal);
        return field === "constraint"
          ? { ...result, explicitConstraints: [{ kind: "technology", value: "Java", sourceText: "using Java", sequence: 1 }] }
          : { ...result, focusTerms: [{ normalized: "java", sourceText: "Java", sequence: 1 }] };
      },
    };
  }
  function finalize(text: string, sequence = 0, targetSession = sessionId) {
    ingestion.ingest(targetSession, { providerChunkId: `${targetSession}-${sequence}`, sourceSessionId: targetSession, sequence, speakerRole: "interviewer", text, isFinal: true, startMs: sequence * 1000, endMs: sequence * 1000 + 500, createdAt: now }); now += 1000;
    const candidate = boundary.getCurrentCandidate(targetSession)!;
    return boundary.forceFinalize(targetSession, { actionId: `finalize-${targetSession}-${sequence}`, candidateRevision: candidate.revision }).finalizedQuestions.find((item) => !item.undoneAt && item.firstSequence === sequence)!;
  }

  it("persists and restores structured results with confidence conversion", async () => {
    const question = finalize("Implement an algorithm using Python and discuss testing.");
    const result = await understanding.analyze(sessionId, { finalizedQuestionId: question.id, actionId: "analyze-1" });
    expect(result.questions[0].understanding).toMatchObject({ finalizedQuestionRevision: 1, questionFamily: "coding", confidence: .95 });
    const raw = connection.db.select({ confidence: questionUnderstandings.confidence }).from(questionUnderstandings).get();
    expect(raw?.confidence).toBe(9500); expect(understanding.list(sessionId).questions).toEqual(result.questions);
  });

  it("uses same-revision persistence as a cache and keeps action IDs idempotent", async () => {
    const fake = new FakeQuestionUnderstandingProvider(); understanding = createUnderstanding(fake);
    const question = finalize("How are you today?");
    const first = await understanding.analyze(sessionId, { finalizedQuestionId: question.id, actionId: "same" });
    const duplicate = await understanding.analyze(sessionId, { finalizedQuestionId: question.id, actionId: "same" });
    const reanalyze = await understanding.analyze(sessionId, { finalizedQuestionId: question.id, actionId: "new-action" });
    expect(first.duplicated).toBe(false); expect(duplicate.duplicated).toBe(true); expect(reanalyze.questions[0].understanding?.id).toBe(first.questions[0].understanding?.id); expect(fake.callCount).toBe(1);
  });

  it("rejects cross-session ownership and action-ID conflicts", async () => {
    const question = finalize("Explain how caching works.");
    const other = sessions.create({ title: "Other", mode: "transcript_lab" }).id;
    await expect(understanding.analyze(other, { finalizedQuestionId: question.id, actionId: "wrong-owner" })).rejects.toMatchObject({ code: "QUESTION_UNDERSTANDING_OWNERSHIP_MISMATCH" });
    await understanding.analyze(sessionId, { finalizedQuestionId: question.id, actionId: "claimed" });
    const second = finalize("Calculate probability and explain assumptions.", 1);
    await expect(understanding.analyze(sessionId, { finalizedQuestionId: second.id, actionId: "claimed" })).rejects.toMatchObject({ code: "QUESTION_UNDERSTANDING_ACTION_DUPLICATE" });
  });

  it("excludes undone questions and supersedes their results", async () => {
    const question = finalize("Explain how caching works.");
    await understanding.analyze(sessionId, { finalizedQuestionId: question.id, actionId: "before-undo" });
    boundary.undoFinalize(sessionId, { actionId: "undo-understanding", targetQuestionId: question.id });
    expect(understanding.list(sessionId).questions).toHaveLength(0);
    expect(connection.db.select({ status: questionUnderstandings.status }).from(questionUnderstandings).get()?.status).toBe("superseded");
    await expect(understanding.analyze(sessionId, { finalizedQuestionId: question.id, actionId: "after-undo" })).rejects.toMatchObject({ code: "QUESTION_UNDERSTANDING_QUESTION_UNDONE" });
  });

  it("creates a new revision-bound result after merge and preserves provenance", async () => {
    const first = finalize("Explain how caching works.", 0); const second = finalize("Describe a project you built.", 1);
    await understanding.analyze(sessionId, { finalizedQuestionId: first.id, actionId: "first-analysis" });
    boundary.mergeWithPrevious(sessionId, { actionId: "merge-understanding", targetQuestionId: second.id });
    const merged = boundary.listFinalizedQuestions(sessionId).find((item) => item.id === first.id)!;
    const result = await understanding.analyze(sessionId, { finalizedQuestionId: merged.id, actionId: "merged-analysis" });
    expect(result.questions).toHaveLength(1); expect(result.questions[0].understanding).toMatchObject({ finalizedQuestionRevision: 2, sourceBoundaryDecisionId: merged.boundaryDecisionId });
    expect(connection.db.select().from(questionUnderstandings).all().map((row) => row.status)).toEqual(["superseded", "completed"]);
  });

  it("rejects a stale in-flight result when merge changes the finalized revision", async () => {
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
    const base = new FakeQuestionUnderstandingProvider();
    const delayed = { name: "fake" as const, analyze: async (input: Parameters<typeof base.analyze>[0], signal?: AbortSignal) => { await gate; return base.analyze(input, signal); } };
    understanding = new QuestionUnderstandingService(new SqliteQuestionUnderstandingRepository(connection.db, () => `stale-row-${id++}`), new HybridQuestionUnderstander(new DeterministicQuestionUnderstander(), delayed), () => `stale-understanding-${id++}`, () => now);
    const first = finalize("How are you today?", 0); const second = finalize("Describe a project you built.", 1);
    const pending = understanding.analyze(sessionId, { finalizedQuestionId: first.id, actionId: "stale-in-flight" });
    boundary.mergeWithPrevious(sessionId, { actionId: "merge-during-analysis", targetQuestionId: second.id }); release();
    await expect(pending).rejects.toMatchObject({ code: "QUESTION_UNDERSTANDING_STALE_REVISION" });
    expect(connection.db.select().from(questionUnderstandings).all()).toHaveLength(0);
  });

  it("rejects an untraceable constraint before persistence", async () => {
    understanding = createUnderstanding(untraceableProvider("constraint"));
    const question = finalize("How are you today?");
    await expect(understanding.analyze(sessionId, { finalizedQuestionId: question.id, actionId: "untraceable-constraint" })).rejects.toThrow(/SOURCE_MISMATCH/u);
    expect(connection.db.select().from(questionUnderstandings).all()).toHaveLength(0);
  });

  it("rejects an untraceable focus term before persistence", async () => {
    understanding = createUnderstanding(untraceableProvider("focus"));
    const question = finalize("How are you today?");
    await expect(understanding.analyze(sessionId, { finalizedQuestionId: question.id, actionId: "untraceable-focus" })).rejects.toThrow(/SOURCE_MISMATCH/u);
    expect(connection.db.select().from(questionUnderstandings).all()).toHaveLength(0);
  });

  it("cascades understanding rows when an analysis session is deleted", async () => {
    const question = finalize("Explain how caching works."); await understanding.analyze(sessionId, { finalizedQuestionId: question.id, actionId: "cascade" });
    connection.db.delete(analysisSessions).where(eq(analysisSessions.id, sessionId)).run();
    expect(connection.db.select().from(questionUnderstandings).all()).toHaveLength(0);
  });
});
