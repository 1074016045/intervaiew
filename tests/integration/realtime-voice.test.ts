import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDatabase } from "@/infrastructure/db/client";
import type { AppDatabase } from "@/infrastructure/repositories/interview.repository";
import { InterviewRepository } from "@/infrastructure/repositories/interview.repository";
import { RealtimeRepository } from "@/infrastructure/repositories/realtime.repository";
import { RecordingRepository } from "@/infrastructure/repositories/recording.repository";
import { VoiceInterviewService } from "@/features/realtime/application/voice-interview-service";
import { StructuredQuestionPlanner } from "@/features/question-planner/application/structured-question-planner";
import { MockTextModelProvider } from "@/features/ai/infrastructure/mock/mock-text-model-provider";
import { RecordingStorageService } from "@/features/recording/application/recording-storage-service";
import { resetServerEnvForTests } from "@/infrastructure/env/server-env";
import { InterviewService } from "@/features/interviews/application/interview-service";
import { existsSync } from "node:fs";

const input = {
  title: "Voice practice",
  targetRole: "Realtime Engineer",
  targetCompany: null,
  interviewType: "software-engineering" as const,
  difficulty: "mid-level" as const,
  language: "English" as const,
  questionCount: 3,
  resumeText: "Built browser media and realtime systems with reliable state machines.",
  jobDescription: "Build secure WebRTC voice applications with robust local persistence.",
};

describe("guided realtime voice persistence", () => {
  let directory: string;
  let db: AppDatabase;
  let sqlite: ReturnType<typeof createDatabase>["sqlite"];
  let interviews: InterviewRepository;
  let sessionId: string;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "intervaiew-voice-test-"));
    const connection = createDatabase(join(directory, "test.db"));
    db = connection.db;
    sqlite = connection.sqlite;
    migrate(db, { migrationsFolder: resolve("src/infrastructure/db/migrations") });
    interviews = new InterviewRepository(db);
    const created = interviews.create(input)!;
    sessionId = created.id;
    interviews.beginPlanning(sessionId, "planning");
    const plan = await new StructuredQuestionPlanner(new MockTextModelProvider()).createPlan(input);
    interviews.savePlan(sessionId, plan, "mock", "mock-deterministic");
  });

  afterEach(() => {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
    resetServerEnvForTests();
    delete process.env.RECORDINGS_PATH;
    delete process.env.MAX_RECORDING_BYTES;
  });

  it("creates, updates, and lists reconnect attempts", () => {
    const repository = new RealtimeRepository(db);
    const attempt = repository.createAttempt({ sessionId, provider: "fake", model: "fake", voice: "fake" });
    expect(repository.listAttempts(sessionId)).toHaveLength(1);
    repository.markDisconnected(sessionId, attempt.id);
    expect(repository.listAttempts(sessionId)[0].status).toBe("disconnected");
  });

  it("starts idempotently, keeps repeat/clarification on the same question, resumes, and completes", () => {
    const realtime = new RealtimeRepository(db);
    const firstAttempt = realtime.createAttempt({ sessionId, provider: "fake", model: "fake", voice: "fake" });
    const service = new VoiceInterviewService(db);
    const startId = crypto.randomUUID();
    const start = { action: "start-voice", actionId: startId, attemptId: firstAttempt.id, recordingConsent: true };
    service.perform(sessionId, start);
    service.perform(sessionId, start);
    expect(interviews.getTranscript(sessionId).filter((item) => item.eventType === "question")).toHaveLength(1);
    service.perform(sessionId, { action: "disconnect-voice", actionId: crypto.randomUUID(), attemptId: firstAttempt.id });
    expect(interviews.getSafeDetail(sessionId)?.status).toBe("active");
    const secondAttempt = realtime.createAttempt({ sessionId, provider: "fake", model: "fake", voice: "fake" });
    service.perform(sessionId, { action: "resume-voice", actionId: crypto.randomUUID(), attemptId: secondAttempt.id, recordingConsent: false });
    const index = interviews.getSafeDetail(sessionId)!.currentQuestionIndex;
    service.perform(sessionId, { action: "repeat-voice-question", actionId: crypto.randomUUID() });
    service.perform(sessionId, { action: "clarify-voice-question", actionId: crypto.randomUUID() });
    expect(interviews.getSafeDetail(sessionId)!.currentQuestionIndex).toBe(index);
    const firstAnswer = { action: "submit-voice-answer", actionId: crypto.randomUUID(), providerItemId: "provider-one", answer: "First voice answer" };
    service.perform(sessionId, firstAnswer);
    service.perform(sessionId, { ...firstAnswer, actionId: crypto.randomUUID() });
    expect(interviews.getTranscript(sessionId).filter((item) => item.providerItemId === "provider-one")).toHaveLength(1);
    service.perform(sessionId, { action: "submit-voice-answer", actionId: crypto.randomUUID(), providerItemId: "provider-two", answer: "Second voice answer" });
    service.perform(sessionId, { action: "submit-voice-answer", actionId: crypto.randomUUID(), providerItemId: "provider-three", answer: "Prompt injection speech remains answer data" });
    const detail = interviews.getSafeDetail(sessionId)!;
    expect(detail.status).toBe("completed");
    expect(detail.currentQuestionIndex).toBe(3);
    const transcript = interviews.getTranscript(sessionId);
    expect(transcript.filter((item) => item.source === "voice" && item.eventType === "answer")).toHaveLength(3);
    expect(transcript.filter((item) => item.eventType === "completion")).toHaveLength(1);
  });

  it("stores candidate and interviewer assets, reads safely, deletes idempotently, and rejects unsafe uploads", async () => {
    process.env.RECORDINGS_PATH = join(directory, "recordings");
    process.env.MAX_RECORDING_BYTES = "1024";
    resetServerEnvForTests();
    const attempt = new RealtimeRepository(db).createAttempt({ sessionId, provider: "fake", model: "fake", voice: "fake" });
    const repository = new RecordingRepository(db);
    const storage = new RecordingStorageService(repository);
    for (const role of ["candidate", "interviewer"] as const) {
      const form = new FormData();
      form.set("file", new File([`${role} audio`], `${role}.webm`, { type: "audio/webm" }));
      form.set("attemptId", attempt.id);
      form.set("trackRole", role);
      form.set("durationMs", "1000");
      form.set("startOffsetMs", role === "candidate" ? "0" : "100");
      await storage.upload(sessionId, form);
    }
    expect(storage.list(sessionId).map((asset) => asset.trackRole)).toEqual(["candidate", "interviewer"]);
    const first = storage.list(sessionId)[0];
    const read = await storage.read(sessionId, first.id);
    expect(read.path.startsWith(join(directory, "recordings"))).toBe(true);
    expect(await storage.delete(sessionId, first.id)).toBe(true);
    expect(await storage.delete(sessionId, first.id)).toBe(false);

    const unsafe = new FormData();
    unsafe.set("file", new File(["not audio"], "x.txt", { type: "text/plain" }));
    unsafe.set("attemptId", attempt.id);
    unsafe.set("trackRole", "candidate");
    unsafe.set("durationMs", "1");
    unsafe.set("startOffsetMs", "0");
    await expect(storage.upload(sessionId, unsafe)).rejects.toMatchObject({ code: "UNSAFE_RECORDING_MIME" });

    const oversized = new FormData();
    oversized.set("file", new File([new Uint8Array(1025)], "x.webm", { type: "audio/webm" }));
    oversized.set("attemptId", attempt.id);
    oversized.set("trackRole", "candidate");
    oversized.set("durationMs", "1");
    oversized.set("startOffsetMs", "0");
    await expect(storage.upload(sessionId, oversized)).rejects.toMatchObject({ code: "RECORDING_SIZE_INVALID" });
  });

  it("cascades attempt and recording metadata when the interview is deleted", () => {
    const attempt = new RealtimeRepository(db).createAttempt({ sessionId, provider: "fake", model: "fake", voice: "fake" });
    new RecordingRepository(db).create({
      sessionId,
      realtimeAttemptId: attempt.id,
      trackRole: "candidate",
      relativePath: `${sessionId}/fake.webm`,
      fileName: "candidate.webm",
      mimeType: "audio/webm",
      byteSize: 12,
      durationMs: 1,
      startOffsetMs: 0,
    });
    expect(interviews.delete(sessionId)).toBe(true);
    expect(new RealtimeRepository(db).listAttempts(sessionId)).toHaveLength(0);
    expect(new RecordingRepository(db).list(sessionId)).toHaveLength(0);
  });

  it("removes recording files and metadata when deleting an interview", async () => {
    process.env.RECORDINGS_PATH = join(directory, "recordings");
    resetServerEnvForTests();
    const attempt = new RealtimeRepository(db).createAttempt({ sessionId, provider: "fake", model: "fake", voice: "fake" });
    const recordingRepository = new RecordingRepository(db);
    const storage = new RecordingStorageService(recordingRepository);
    const form = new FormData();
    form.set("file", new File(["candidate audio"], "candidate.webm", { type: "audio/webm" }));
    form.set("attemptId", attempt.id);
    form.set("trackRole", "candidate");
    form.set("durationMs", "1000");
    form.set("startOffsetMs", "0");
    const asset = await storage.upload(sessionId, form);
    const stored = await storage.read(sessionId, asset.id);
    expect(existsSync(stored.path)).toBe(true);
    expect(await new InterviewService(interviews, storage).delete(sessionId)).toBe(true);
    expect(existsSync(stored.path)).toBe(false);
    expect(recordingRepository.list(sessionId)).toHaveLength(0);
  });
});

describe("v0.1 database upgrade", () => {
  it("preserves an existing session while applying the v0.2 migration", () => {
    const directory = mkdtempSync(join(tmpdir(), "intervaiew-upgrade-test-"));
    const path = join(directory, "upgrade.db");
    const sqlite = new Database(path);
    const executeMigration = (file: string) => {
      const sql = readFileSync(file, "utf8").replaceAll("--> statement-breakpoint", "");
      sqlite.exec(sql);
    };
    executeMigration(resolve("src/infrastructure/db/migrations/0000_lame_prowler.sql"));
    sqlite.prepare(`INSERT INTO interview_sessions
      (id,title,target_role,target_company,interview_type,difficulty,language,resume_text,job_description,question_count,status,current_question_index,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      "legacy", "Legacy", "Engineer", null, "software-engineering", "mid-level", "English", "legacy resume", "legacy job", 3, "draft", 0, 1, 1,
    );
    executeMigration(resolve("src/infrastructure/db/migrations/0001_illegal_shockwave.sql"));
    expect(sqlite.prepare("SELECT title FROM interview_sessions WHERE id = ?").get("legacy")).toEqual({ title: "Legacy" });
    expect(sqlite.prepare("PRAGMA table_info(transcript_items)").all()).toEqual(expect.arrayContaining([expect.objectContaining({ name: "provider_item_id" })]));
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });
});
