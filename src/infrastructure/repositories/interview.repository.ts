import "server-only";
import { and, desc, eq, like, max } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type {
  CreateInterviewInput,
  InterviewStatus,
} from "@/features/interviews/domain/interview.types";
import type { QuestionPlan } from "@/features/question-planner/domain/question-plan.types";
import type { AiProviderName } from "@/features/ai/domain/ai-provider-name";
import {
  interviewActions,
  interviewQuestions,
  interviewSessions,
  schema,
  transcriptItems,
} from "../db/schema";

export type AppDatabase = BetterSQLite3Database<typeof schema>;

export class InterviewRepository {
  constructor(private readonly db: AppDatabase) {}

  create(input: CreateInterviewInput) {
    const now = new Date();
    const id = crypto.randomUUID();
    this.db
      .insert(interviewSessions)
      .values({
        id,
        ...input,
        status: "draft",
        currentQuestionIndex: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return this.getSafeDetail(id);
  }

  list(filters?: { status?: InterviewStatus; search?: string }) {
    const condition = filters?.status
      ? eq(interviewSessions.status, filters.status)
      : filters?.search
        ? like(interviewSessions.title, `%${filters.search}%`)
        : undefined;
    return this.db
      .select({
        id: interviewSessions.id,
        title: interviewSessions.title,
        targetRole: interviewSessions.targetRole,
        targetCompany: interviewSessions.targetCompany,
        interviewType: interviewSessions.interviewType,
        difficulty: interviewSessions.difficulty,
        language: interviewSessions.language,
        questionCount: interviewSessions.questionCount,
        status: interviewSessions.status,
        aiProvider: interviewSessions.aiProvider,
        aiModel: interviewSessions.aiModel,
        currentQuestionIndex: interviewSessions.currentQuestionIndex,
        durationSeconds: interviewSessions.durationSeconds,
        createdAt: interviewSessions.createdAt,
        updatedAt: interviewSessions.updatedAt,
      })
      .from(interviewSessions)
      .where(condition)
      .orderBy(desc(interviewSessions.createdAt))
      .all();
  }

  getPrivate(id: string) {
    return (
      this.db
        .select()
        .from(interviewSessions)
        .where(eq(interviewSessions.id, id))
        .get() ?? null
    );
  }

  getSafeDetail(id: string) {
    const session = this.db
      .select({
        id: interviewSessions.id,
        title: interviewSessions.title,
        targetRole: interviewSessions.targetRole,
        targetCompany: interviewSessions.targetCompany,
        interviewType: interviewSessions.interviewType,
        difficulty: interviewSessions.difficulty,
        language: interviewSessions.language,
        questionCount: interviewSessions.questionCount,
        status: interviewSessions.status,
        aiProvider: interviewSessions.aiProvider,
        aiModel: interviewSessions.aiModel,
        questionPlanSummary: interviewSessions.questionPlanSummary,
        currentQuestionIndex: interviewSessions.currentQuestionIndex,
        startedAt: interviewSessions.startedAt,
        endedAt: interviewSessions.endedAt,
        durationSeconds: interviewSessions.durationSeconds,
        failureCode: interviewSessions.failureCode,
        createdAt: interviewSessions.createdAt,
        updatedAt: interviewSessions.updatedAt,
        resumeCharacters: interviewSessions.resumeText,
        jobDescriptionCharacters: interviewSessions.jobDescription,
      })
      .from(interviewSessions)
      .where(eq(interviewSessions.id, id))
      .get();
    if (!session) return null;
    const questions = this.db
      .select()
      .from(interviewQuestions)
      .where(eq(interviewQuestions.sessionId, id))
      .orderBy(interviewQuestions.sequence)
      .all();
    return {
      ...session,
      resumeCharacters: session.resumeCharacters.length,
      jobDescriptionCharacters: session.jobDescriptionCharacters.length,
      questions,
    };
  }

  getTranscript(id: string) {
    return this.db
      .select()
      .from(transcriptItems)
      .where(eq(transcriptItems.sessionId, id))
      .orderBy(transcriptItems.sequence)
      .all();
  }

  beginPlanning(id: string, nextStatus: "planning") {
    return this.db
      .update(interviewSessions)
      .set({ status: nextStatus, failureCode: null, updatedAt: new Date() })
      .where(
        and(
          eq(interviewSessions.id, id),
          eq(interviewSessions.status, this.getPrivate(id)?.status ?? "failed"),
        ),
      )
      .run();
  }

  savePlan(
    id: string,
    plan: QuestionPlan,
    provider: AiProviderName,
    model: string,
  ) {
    this.db.transaction((tx) => {
      const session = tx
        .select()
        .from(interviewSessions)
        .where(eq(interviewSessions.id, id))
        .get();
      if (!session || session.status !== "planning")
        throw new Error("INTERVIEW_NOT_PLANNING");
      tx.delete(interviewQuestions)
        .where(eq(interviewQuestions.sessionId, id))
        .run();
      const now = new Date();
      tx.insert(interviewQuestions)
        .values(
          plan.questions.map((question) => ({
            id: crypto.randomUUID(),
            sessionId: id,
            ...question,
            createdAt: now,
          })),
        )
        .run();
      tx.update(interviewSessions)
        .set({
          status: "ready",
          questionPlanSummary: plan.sessionSummary,
          aiProvider: provider,
          aiModel: model,
          currentQuestionIndex: 0,
          failureCode: null,
          updatedAt: now,
        })
        .where(eq(interviewSessions.id, id))
        .run();
    });
  }

  failPlanning(id: string, failureCode: string) {
    this.db
      .update(interviewSessions)
      .set({ status: "draft", failureCode, updatedAt: new Date() })
      .where(
        and(
          eq(interviewSessions.id, id),
          eq(interviewSessions.status, "planning"),
        ),
      )
      .run();
  }

  delete(id: string): boolean {
    return this.db.transaction((tx) => {
      const exists = tx
        .select({ id: interviewSessions.id })
        .from(interviewSessions)
        .where(eq(interviewSessions.id, id))
        .get();
      if (!exists) return false;
      tx.delete(interviewSessions).where(eq(interviewSessions.id, id)).run();
      return true;
    });
  }

  countAssociated(id: string) {
    return {
      questions:
        this.db
          .select({ count: max(interviewQuestions.sequence) })
          .from(interviewQuestions)
          .where(eq(interviewQuestions.sessionId, id))
          .get()?.count ?? 0,
      transcript:
        this.db
          .select({ count: max(transcriptItems.sequence) })
          .from(transcriptItems)
          .where(eq(transcriptItems.sessionId, id))
          .get()?.count ?? 0,
      actions: this.db
        .select({ count: max(interviewActions.createdAt) })
        .from(interviewActions)
        .where(eq(interviewActions.sessionId, id))
        .get()?.count
        ? 1
        : 0,
    };
  }
}
