import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDatabase } from "@/infrastructure/db/client";
import {
  InterviewRepository,
  type AppDatabase,
} from "@/infrastructure/repositories/interview.repository";
import { TextInterviewService } from "@/features/text-interview/application/text-interview-service";
import { MockTextModelProvider } from "@/features/ai/infrastructure/mock/mock-text-model-provider";
import { StructuredQuestionPlanner } from "@/features/question-planner/application/structured-question-planner";
import {
  buildJsonExport,
  buildTxtExport,
} from "@/features/transcript/application/export-interview";

const input = {
  title: "Agent practice",
  targetRole: "AI Agent Engineer",
  targetCompany: "Example",
  interviewType: "ai-agent-engineering" as const,
  difficulty: "graduate" as const,
  language: "Chinese" as const,
  questionCount: 3,
  resumeText: "Built reliable agent tools with strong safety controls. ",
  jobDescription:
    "Design agent state, tool execution, evaluation, and recovery systems.",
};
describe("SQLite interview flow", () => {
  let directory: string;
  let db: AppDatabase;
  let sqlite: ReturnType<typeof createDatabase>["sqlite"];
  let repository: InterviewRepository;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "intervaiew-test-"));
    const connection = createDatabase(join(directory, "test.db"));
    db = connection.db;
    sqlite = connection.sqlite;
    migrate(db, {
      migrationsFolder: resolve("src/infrastructure/db/migrations"),
    });
    repository = new InterviewRepository(db);
  });
  afterEach(() => {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });
  it("migrates an empty database and creates a safe session/list", () => {
    const created = repository.create(input);
    expect(created?.status).toBe("draft");
    const list = repository.list();
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty("resumeText");
    expect(list[0]).not.toHaveProperty("jobDescription");
  });
  it("atomically saves and regenerates a provider-neutral question plan", async () => {
    const created = repository.create(input)!;
    repository.beginPlanning(created.id, "planning");
    const planner = new StructuredQuestionPlanner(new MockTextModelProvider());
    const plan = await planner.createPlan({
      ...input,
      targetCompany: input.targetCompany,
    });
    repository.savePlan(created.id, plan, "mock", "mock-deterministic");
    let ready = repository.getSafeDetail(created.id)!;
    expect(ready.status).toBe("ready");
    expect(ready.questions).toHaveLength(3);
    expect(ready.aiProvider).toBe("mock");
    repository.beginPlanning(created.id, "planning");
    const replacement = {
      ...plan,
      questions: plan.questions.map((q) => ({
        ...q,
        question: `Replacement ${q.question}`,
      })),
    };
    repository.savePlan(created.id, replacement, "mock", "mock-deterministic");
    ready = repository.getSafeDetail(created.id)!;
    expect(ready.questions).toHaveLength(3);
    expect(
      ready.questions.every((q) => q.question.startsWith("Replacement")),
    ).toBe(true);
  });
  it("returns planning failures to draft without partial questions", () => {
    const created = repository.create(input)!;
    repository.beginPlanning(created.id, "planning");
    repository.failPlanning(created.id, "AI_PROVIDER_UNAVAILABLE");
    const failed = repository.getSafeDetail(created.id)!;
    expect(failed.status).toBe("draft");
    expect(failed.failureCode).toBe("AI_PROVIDER_UNAVAILABLE");
    expect(failed.questions).toHaveLength(0);
  });
  it("runs start, idempotent retry, answer, clarification, repeat and completion", async () => {
    const created = repository.create(input)!;
    repository.beginPlanning(created.id, "planning");
    const plan = await new StructuredQuestionPlanner(
      new MockTextModelProvider(),
    ).createPlan({ ...input, targetCompany: input.targetCompany });
    repository.savePlan(created.id, plan, "mock", "mock-deterministic");
    const service = new TextInterviewService(db);
    const startId = crypto.randomUUID();
    service.perform(created.id, { action: "start", actionId: startId });
    service.perform(created.id, { action: "start", actionId: startId });
    expect(
      repository
        .getTranscript(created.id)
        .filter((x) => x.eventType === "question"),
    ).toHaveLength(1);
    service.perform(created.id, {
      action: "submit-answer",
      actionId: crypto.randomUUID(),
      answer: "First answer",
    });
    const before = repository.getSafeDetail(created.id)!.currentQuestionIndex;
    service.perform(created.id, {
      action: "request-clarification",
      actionId: crypto.randomUUID(),
    });
    service.perform(created.id, {
      action: "repeat-question",
      actionId: crypto.randomUUID(),
    });
    expect(repository.getSafeDetail(created.id)!.currentQuestionIndex).toBe(
      before,
    );
    service.perform(created.id, {
      action: "submit-answer",
      actionId: crypto.randomUUID(),
      answer: "Second answer",
    });
    const finalId = crypto.randomUUID();
    service.perform(created.id, {
      action: "submit-answer",
      actionId: finalId,
      answer: "Third answer",
    });
    service.perform(created.id, {
      action: "submit-answer",
      actionId: finalId,
      answer: "Third answer",
    });
    const done = repository.getSafeDetail(created.id)!;
    expect(done.status).toBe("completed");
    expect(done.currentQuestionIndex).toBe(3);
    const transcript = repository.getTranscript(created.id);
    expect(new Set(transcript.map((x) => x.sequence)).size).toBe(
      transcript.length,
    );
    expect(transcript.filter((x) => x.eventType === "answer")).toHaveLength(3);
    expect(transcript.filter((x) => x.eventType === "completion")).toHaveLength(
      1,
    );
    expect(done.durationSeconds).toBeGreaterThanOrEqual(0);
  });
  it("exports safe TXT/JSON and cascade deletes all related rows", async () => {
    const created = repository.create(input)!;
    repository.beginPlanning(created.id, "planning");
    const plan = await new StructuredQuestionPlanner(
      new MockTextModelProvider(),
    ).createPlan({ ...input, targetCompany: input.targetCompany });
    repository.savePlan(created.id, plan, "mock", "mock-deterministic");
    new TextInterviewService(db).perform(created.id, {
      action: "start",
      actionId: crypto.randomUUID(),
    });
    const detail = repository.getSafeDetail(created.id)!;
    const transcript = repository.getTranscript(created.id);
    expect(buildTxtExport(detail, transcript)).toContain(
      "IntervAIew — 面面具到",
    );
    const json = JSON.stringify(buildJsonExport(detail, transcript));
    expect(json).not.toContain(input.resumeText);
    expect(json).not.toContain(input.jobDescription);
    expect(repository.delete(created.id)).toBe(true);
    expect(repository.getSafeDetail(created.id)).toBeNull();
    expect(repository.countAssociated(created.id)).toEqual({
      questions: 0,
      transcript: 0,
      actions: 0,
    });
  });
});
