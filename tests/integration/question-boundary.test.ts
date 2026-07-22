import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDatabase } from "@/infrastructure/db/client";
import { SqliteAnalysisRepository } from "@/features/question-intelligence/infrastructure/sqlite/sqlite-analysis-repository";
import { SqliteQuestionBoundaryRepository } from "@/features/question-intelligence/infrastructure/sqlite/sqlite-question-boundary-repository";
import { AnalysisSessionService } from "@/features/question-intelligence/application/analysis-session-service";
import { TranscriptIngestionService } from "@/features/question-intelligence/application/transcript-ingestion-service";
import { DeterministicQuestionBoundaryDetector } from "@/features/question-intelligence/application/deterministic-question-boundary-detector";
import { HybridQuestionBoundaryDetector } from "@/features/question-intelligence/application/hybrid-question-boundary-detector";
import { QuestionSegmentationService } from "@/features/question-intelligence/application/question-segmentation-service";
import { FakeSemanticQuestionBoundaryProvider } from "@/features/question-intelligence/infrastructure/fake/fake-semantic-question-boundary-provider";
import type { TranscriptChunk } from "@/features/question-intelligence/domain/transcript";
import { QuestionIntelligenceError } from "@/features/question-intelligence/domain/question-intelligence-error";

const migrations = resolve("src/infrastructure/db/migrations");

describe("Question Boundary SQLite integration", () => {
  let directory: string;
  let sqlite: ReturnType<typeof createDatabase>["sqlite"];
  let now: number;
  let nextId: number;
  let sessions: AnalysisSessionService;
  let ingestion: TranscriptIngestionService;
  let boundary: QuestionSegmentationService;
  let sessionId: string;

  const createBoundary = (
    provider = new FakeSemanticQuestionBoundaryProvider(),
  ) => {
    const deterministic = new DeterministicQuestionBoundaryDetector();
    return new QuestionSegmentationService(
      new SqliteQuestionBoundaryRepository(
        connection.db,
        () => `boundary-row-${nextId++}`,
      ),
      deterministic,
      new HybridQuestionBoundaryDetector(
        deterministic,
        provider,
        { shortPauseMs: 500, mediumPauseMs: 1400, longPauseMs: 3000 },
        () => `decision-${nextId++}`,
        () => now,
      ),
      () => `manual-decision-${nextId++}`,
      () => now,
    );
  };

  let connection: ReturnType<typeof createDatabase>;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "intervaiew-boundary-"));
    connection = createDatabase(join(directory, "test.db"));
    sqlite = connection.sqlite;
    migrate(connection.db, { migrationsFolder: migrations });
    now = 1_700_000_001_000;
    nextId = 0;
    const analysisRepository = new SqliteAnalysisRepository(
      connection.db,
      () => `analysis-${nextId++}`,
      () => now,
    );
    sessions = new AnalysisSessionService(analysisRepository);
    ingestion = new TranscriptIngestionService(analysisRepository);
    boundary = createBoundary();
    sessionId = sessions.create({
      title: "Boundary integration",
      mode: "transcript_lab",
    }).id;
  });

  afterEach(() => {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });

  function chunk(
    sequence: number,
    text: string,
    speakerRole: TranscriptChunk["speakerRole"] = "interviewer",
  ): TranscriptChunk {
    return {
      providerChunkId: `provider-${sequence}`,
      sourceSessionId: sessionId,
      sequence,
      speakerRole,
      text,
      isFinal: true,
      startMs: sequence * 1000,
      endMs: sequence * 1000 + 500,
      createdAt: now,
    };
  }

  function ingest(sequence: number, text: string) {
    const value = ingestion.ingest(sessionId, chunk(sequence, text));
    now += 700;
    return value;
  }

  async function evaluate(actionId = "evaluate-1") {
    const candidate = boundary.getCurrentCandidate(sessionId);
    if (!candidate) throw new Error("test candidate missing");
    return boundary.evaluateCandidate(sessionId, {
      actionId,
      candidateRevision: candidate.revision,
    });
  }

  it("creates a candidate from final interviewer segments", () => {
    ingest(0, "Why did you choose data science");
    expect(boundary.getCurrentCandidate(sessionId)).toMatchObject({
      text: "Why did you choose data science",
      revision: 1,
      firstSequence: 0,
      lastSequence: 0,
    });
  });

  it("persists an evaluated boundary decision", async () => {
    ingest(0, "Tell me about your project and");
    await evaluate();
    expect(boundary.listBoundaryDecisions(sessionId)).toHaveLength(1);
    expect(boundary.listFinalizedQuestions(sessionId)).toHaveLength(0);
  });

  it("persists a finalized question transactionally", async () => {
    ingest(0, "Why did you choose data science");
    await evaluate();
    expect(boundary.listFinalizedQuestions(sessionId)).toMatchObject([
      { text: "Why did you choose data science", revision: 1 },
    ]);
  });

  it("returns the original result for a duplicate action id", async () => {
    ingest(0, "Why did you choose data science");
    const first = await evaluate("same-action");
    const duplicate = await boundary.evaluateCandidate(sessionId, {
      actionId: "same-action",
      candidateRevision: 1,
    });
    expect(first.duplicated).toBe(false);
    expect(duplicate.duplicated).toBe(true);
    expect(duplicate.finalizedQuestions).toHaveLength(1);
  });

  it("rejects stale candidate revisions after another segment arrives", async () => {
    ingest(0, "Tell me about your project and");
    const first = boundary.getCurrentCandidate(sessionId);
    ingest(1, "what made it challenging?");
    await expect(
      boundary.evaluateCandidate(sessionId, {
        actionId: "stale-action",
        candidateRevision: first?.revision,
      }),
    ).rejects.toMatchObject({ code: "QUESTION_BOUNDARY_STALE_REVISION" });
  });

  it("preserves transcript sequence conflict handling", () => {
    ingestion.ingest(sessionId, chunk(0, "First"));
    expect(() =>
      ingestion.ingest(sessionId, {
        ...chunk(0, "Conflict"),
        providerChunkId: "different-provider",
      }),
    ).toThrow(/already assigned/u);
  });

  it("force finalizes a valid current candidate", () => {
    ingest(0, "A detailed production incident response");
    const candidate = boundary.getCurrentCandidate(sessionId)!;
    const result = boundary.forceFinalize(sessionId, {
      actionId: "force-1",
      candidateRevision: candidate.revision,
    });
    expect(result.finalizedQuestions).toHaveLength(1);
    expect(result.latestDecision?.reasonCode).toBe("manual_force_finalize");
  });

  it("keeps repeated force-finalize actions idempotent", () => {
    ingest(0, "A detailed production incident response");
    const candidate = boundary.getCurrentCandidate(sessionId)!;
    const input = {
      actionId: "force-same",
      candidateRevision: candidate.revision,
    };
    boundary.forceFinalize(sessionId, input);
    const duplicate = boundary.forceFinalize(sessionId, input);
    expect(duplicate.duplicated).toBe(true);
    expect(duplicate.finalizedQuestions).toHaveLength(1);
  });

  it("merges a finalized question with its previous question", async () => {
    ingest(0, "Why did you choose data science");
    await evaluate("evaluate-first");
    ingest(1, "Describe a time you handled conflict");
    await evaluate("evaluate-second");
    const questions = boundary.listFinalizedQuestions(sessionId);
    const result = boundary.mergeWithPrevious(sessionId, {
      actionId: "merge-1",
      targetQuestionId: questions[1].id,
    });
    expect(result.finalizedQuestions[0]).toMatchObject({
      revision: 2,
      sourceSegmentIds: expect.arrayContaining([
        expect.any(String),
        expect.any(String),
      ]),
    });
    expect(result.finalizedQuestions[1].undoneAt).not.toBeNull();
  });

  it("keeps repeated merge actions idempotent", async () => {
    ingest(0, "Why did you choose data science");
    await evaluate("merge-idem-first");
    ingest(1, "Describe a time you handled conflict");
    await evaluate("merge-idem-second");
    const target = boundary.listFinalizedQuestions(sessionId)[1];
    const input = { actionId: "merge-same", targetQuestionId: target.id };
    boundary.mergeWithPrevious(sessionId, input);
    const duplicate = boundary.mergeWithPrevious(sessionId, input);
    expect(duplicate.duplicated).toBe(true);
    expect(duplicate.finalizedQuestions[0].revision).toBe(2);
  });

  it("undoes a finalized question and reopens its segments", async () => {
    ingest(0, "Why did you choose data science");
    const finalized = await evaluate();
    const question = finalized.finalizedQuestions[0];
    const result = boundary.undoFinalize(sessionId, {
      actionId: "undo-1",
      targetQuestionId: question.id,
    });
    expect(result.finalizedQuestions[0].undoneAt).not.toBeNull();
    expect(result.candidate?.segmentIds).toHaveLength(1);
  });

  it("keeps repeated undo actions idempotent", async () => {
    ingest(0, "Why did you choose data science");
    const finalized = await evaluate("undo-idem-evaluate");
    const input = {
      actionId: "undo-same",
      targetQuestionId: finalized.finalizedQuestions[0].id,
    };
    boundary.undoFinalize(sessionId, input);
    const duplicate = boundary.undoFinalize(sessionId, input);
    expect(duplicate.duplicated).toBe(true);
    expect(duplicate.finalizedQuestions[0].undoneAt).not.toBeNull();
  });

  it("keeps finalized question source segment traceability", async () => {
    const first = ingest(0, "Tell me about a project and").segment.id;
    const second = ingest(1, "why it was difficult?").segment.id;
    const result = await evaluate();
    expect(result.finalizedQuestions[0].sourceSegmentIds).toEqual([
      first,
      second,
    ]);
  });

  it("returns a stable session-not-found error", () => {
    expect(() => boundary.getState("missing")).toThrowError(
      expect.objectContaining({ code: "QUESTION_BOUNDARY_SESSION_INVALID" }),
    );
  });

  it("rejects boundary work in an invalid session state", () => {
    sessions.updateStatus(sessionId, { status: "cancelled" });
    expect(() => boundary.getState(sessionId)).toThrowError(
      expect.objectContaining({ code: "QUESTION_BOUNDARY_SESSION_INVALID" }),
    );
  });

  it("maps semantic failure to a safe fallback decision", async () => {
    boundary = createBoundary(
      new FakeSemanticQuestionBoundaryProvider({ fail: true }),
    );
    ingest(0, "A detailed production incident response");
    now += 1000;
    const result = await evaluate();
    expect(result.latestDecision).toMatchObject({
      reasonCode: "semantic_failed_fallback_wait",
      status: "waiting",
    });
  });

  it("migrates a fresh database with all boundary tables", () => {
    const names = sqlite
      .prepare("select name from sqlite_master where type = 'table'")
      .all() as Array<{ name: string }>;
    expect(names.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "question_candidates",
        "question_candidate_segments",
        "boundary_decisions",
        "finalized_questions",
        "finalized_question_segments",
        "question_boundary_actions",
      ]),
    );
  });

  it("upgrades an existing 0002 database without losing transcript data", () => {
    const upgradeDirectory = mkdtempSync(
      join(tmpdir(), "intervaiew-v03-upgrade-"),
    );
    const upgrade = new Database(join(upgradeDirectory, "upgrade.db"));
    upgrade.pragma("foreign_keys = ON");
    const apply = (name: string) =>
      upgrade.exec(
        readFileSync(resolve(migrations, name), "utf8").replaceAll(
          "--> statement-breakpoint",
          "",
        ),
      );
    apply("0000_lame_prowler.sql");
    apply("0001_illegal_shockwave.sql");
    apply("0002_elite_shocker.sql");
    upgrade
      .prepare(
        "insert into analysis_sessions (id,title,mode,status,created_at,updated_at) values (?,?,?,?,?,?)",
      )
      .run("existing", "Existing lab", "transcript_lab", "active", 1, 1);
    upgrade
      .prepare(
        "insert into transcript_segments (id,analysis_session_id,provider_segment_id,sequence,speaker_role,text,start_ms,end_ms,created_at) values (?,?,?,?,?,?,?,?,?)",
      )
      .run(
        "segment",
        "existing",
        "provider",
        0,
        "interviewer",
        "Existing final",
        0,
        1,
        1,
      );
    apply("0003_clear_ghost_rider.sql");
    expect(
      upgrade.prepare("select text from transcript_segments").get(),
    ).toEqual({
      text: "Existing final",
    });
    expect(
      upgrade
        .prepare(
          "select name from sqlite_master where type='table' and name='boundary_decisions'",
        )
        .get(),
    ).toEqual({ name: "boundary_decisions" });
    upgrade.close();
    rmSync(upgradeDirectory, { recursive: true, force: true });
  });

  it("cascades all question boundary rows when the session is deleted", async () => {
    ingest(0, "Why did you choose data science");
    await evaluate();
    sessions.delete(sessionId);
    for (const table of [
      "question_candidates",
      "question_candidate_segments",
      "boundary_decisions",
      "finalized_questions",
      "finalized_question_segments",
      "question_boundary_actions",
    ]) {
      const count = sqlite
        .prepare(`select count(*) as count from ${table}`)
        .get() as { count: number };
      expect(count.count).toBe(0);
    }
  });

  it("enforces action and candidate segment unique constraints", () => {
    ingest(0, "Why did you choose data science");
    boundary.getState(sessionId);
    const candidateRow = sqlite
      .prepare("select id from question_candidates")
      .get() as { id: string };
    const segmentRow = sqlite
      .prepare("select id, sequence from transcript_segments")
      .get() as { id: string; sequence: number };
    expect(() =>
      sqlite
        .prepare(
          "insert into question_candidate_segments (candidate_id,transcript_segment_id,sequence) values (?,?,?)",
        )
        .run(candidateRow.id, segmentRow.id, segmentRow.sequence),
    ).toThrow(/UNIQUE/u);
  });

  it("never writes transcript text into safe error logs", () => {
    const transcript = "PRIVATE_TRANSCRIPT_DO_NOT_LOG";
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    ingestion.ingest(sessionId, chunk(0, transcript));
    expect(() =>
      boundary.forceFinalize(sessionId, {
        actionId: "bad-force",
        candidateRevision: 999,
      }),
    ).toThrow(QuestionIntelligenceError);
    expect(error.mock.calls.flat().join(" ")).not.toContain(transcript);
  });
});
