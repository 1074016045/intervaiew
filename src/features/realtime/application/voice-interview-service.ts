import "server-only";
import { and, eq, max } from "drizzle-orm";
import { z } from "zod";
import {
  InterviewController,
  calculateDurationSeconds,
} from "@/features/interviews/domain/interview-controller";
import { InterviewDomainError } from "@/features/interviews/domain/interview-errors";
import { getDatabase } from "@/infrastructure/db/client";
import {
  interviewActions,
  interviewQuestions,
  interviewSessions,
  realtimeAttempts,
  transcriptItems,
} from "@/infrastructure/db/schema";
import type { AppDatabase } from "@/infrastructure/repositories/interview.repository";

export const voiceInterviewActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start-voice"),
    actionId: z.uuid(),
    attemptId: z.uuid(),
    recordingConsent: z.boolean().default(false),
  }),
  z.object({
    action: z.literal("submit-voice-answer"),
    actionId: z.uuid(),
    providerItemId: z.string().trim().min(1).max(200),
    answer: z.string().trim().min(1).max(20_000),
  }),
  z.object({ action: z.literal("repeat-voice-question"), actionId: z.uuid() }),
  z.object({ action: z.literal("clarify-voice-question"), actionId: z.uuid() }),
  z.object({ action: z.literal("cancel-voice"), actionId: z.uuid() }),
  z.object({
    action: z.literal("resume-voice"),
    actionId: z.uuid(),
    attemptId: z.uuid(),
    recordingConsent: z.boolean().default(false),
  }),
  z.object({
    action: z.literal("disconnect-voice"),
    actionId: z.uuid(),
    attemptId: z.uuid(),
  }),
]);

export class VoiceInterviewService {
  constructor(private readonly db: AppDatabase = getDatabase().db) {}

  perform(id: string, rawAction: unknown) {
    const action = voiceInterviewActionSchema.parse(rawAction);
    return this.db.transaction((tx) => {
      const duplicateAction = tx
        .select({ id: interviewActions.id })
        .from(interviewActions)
        .where(
          and(
            eq(interviewActions.sessionId, id),
            eq(interviewActions.actionId, action.actionId),
          ),
        )
        .get();
      if (duplicateAction) return this.snapshot(tx, id);
      if (
        action.action === "submit-voice-answer" &&
        tx
          .select({ id: transcriptItems.id })
          .from(transcriptItems)
          .where(
            and(
              eq(transcriptItems.sessionId, id),
              eq(transcriptItems.providerItemId, action.providerItemId),
            ),
          )
          .get()
      ) {
        this.addReceipt(tx, id, action.actionId, action.action);
        return this.snapshot(tx, id);
      }
      const session = tx
        .select()
        .from(interviewSessions)
        .where(eq(interviewSessions.id, id))
        .get();
      if (!session)
        throw new InterviewDomainError(
          "INTERVIEW_NOT_FOUND",
          "The interview could not be found.",
        );
      const questions = tx
        .select()
        .from(interviewQuestions)
        .where(eq(interviewQuestions.sessionId, id))
        .orderBy(interviewQuestions.sequence)
        .all();
      if (!questions.length)
        throw new InterviewDomainError(
          "QUESTION_PLAN_REQUIRED",
          "Generate questions before starting.",
        );
      const controller = new InterviewController({
        status: session.status,
        currentQuestionIndex: session.currentQuestionIndex,
        questionCount: session.questionCount,
      });
      const now = new Date();
      let sequence =
        (tx
          .select({ value: max(transcriptItems.sequence) })
          .from(transcriptItems)
          .where(eq(transcriptItems.sessionId, id))
          .get()?.value ?? 0) + 1;
      const addTranscript = (
        item: Omit<
          typeof transcriptItems.$inferInsert,
          "id" | "sessionId" | "sequence" | "createdAt"
        >,
      ) => {
        tx.insert(transcriptItems)
          .values({
            id: crypto.randomUUID(),
            sessionId: id,
            sequence: sequence++,
            createdAt: now,
            ...item,
          })
          .run();
      };
      const current = () => questions[controller.snapshot().currentQuestionIndex];

      if (action.action === "start-voice") {
        const attempt = this.getAttempt(tx, id, action.attemptId);
        if (session.status !== "ready")
          throw new InterviewDomainError(
            "REALTIME_INTERVIEW_NOT_READY",
            "The interview is not ready to start.",
          );
        const state = controller.start();
        const question = current();
        addTranscript({
          role: "interviewer",
          source: "voice",
          eventType: "question",
          text: question.question,
          questionSequence: question.sequence,
          actionId: action.actionId,
          providerItemId: null,
        });
        tx.update(interviewSessions)
          .set({
            status: state.status,
            startedAt: session.startedAt ?? now,
            updatedAt: now,
          })
          .where(eq(interviewSessions.id, id))
          .run();
        tx.update(realtimeAttempts)
          .set({
            status: "connected",
            recordingConsent: action.recordingConsent,
            connectedAt: attempt.connectedAt ?? now,
            updatedAt: now,
          })
          .where(eq(realtimeAttempts.id, action.attemptId))
          .run();
      } else if (action.action === "resume-voice") {
        this.getAttempt(tx, id, action.attemptId);
        if (session.status !== "active")
          throw new InterviewDomainError(
            "INTERVIEW_NOT_ACTIVE",
            "Only an active interview can be resumed.",
          );
        tx.update(realtimeAttempts)
          .set({
            status: "connected",
            recordingConsent: action.recordingConsent,
            connectedAt: now,
            updatedAt: now,
          })
          .where(eq(realtimeAttempts.id, action.attemptId))
          .run();
      } else if (action.action === "disconnect-voice") {
        this.getAttempt(tx, id, action.attemptId);
        if (session.status === "active") {
          tx.update(realtimeAttempts)
            .set({
              status: "disconnected",
              disconnectedAt: now,
              updatedAt: now,
            })
            .where(eq(realtimeAttempts.id, action.attemptId))
            .run();
        }
      } else if (action.action === "submit-voice-answer") {
        const answered = current();
        if (!answered)
          throw new InterviewDomainError(
            "QUESTION_NOT_FOUND",
            "The current question could not be found.",
          );
        addTranscript({
          role: "candidate",
          source: "voice",
          eventType: "answer",
          text: action.answer,
          questionSequence: answered.sequence,
          actionId: action.actionId,
          providerItemId: action.providerItemId,
        });
        const state = controller.submitAnswer();
        if (state.status === "ending") {
          const completed = controller.finish();
          addTranscript({
            role: "interviewer",
            source: "voice",
            eventType: "completion",
            text: "Thank you. This practice interview is complete.",
            questionSequence: answered.sequence,
            actionId: action.actionId,
            providerItemId: null,
          });
          tx.update(interviewSessions)
            .set({
              status: completed.status,
              currentQuestionIndex: completed.currentQuestionIndex,
              endedAt: now,
              durationSeconds: calculateDurationSeconds(session.startedAt, now),
              updatedAt: now,
            })
            .where(eq(interviewSessions.id, id))
            .run();
          tx.update(realtimeAttempts)
            .set({ status: "completed", endedAt: now, updatedAt: now })
            .where(eq(realtimeAttempts.sessionId, id))
            .run();
        } else {
          const next = questions[state.currentQuestionIndex];
          addTranscript({
            role: "interviewer",
            source: "voice",
            eventType: "question",
            text: next.question,
            questionSequence: next.sequence,
            actionId: action.actionId,
            providerItemId: null,
          });
          tx.update(interviewSessions)
            .set({
              currentQuestionIndex: state.currentQuestionIndex,
              updatedAt: now,
            })
            .where(eq(interviewSessions.id, id))
            .run();
        }
      } else if (action.action === "repeat-voice-question") {
        controller.repeatCurrentQuestion();
        const question = current();
        addTranscript({
          role: "system",
          source: "control",
          eventType: "repeat_request",
          text: "The candidate asked to repeat the question.",
          questionSequence: question.sequence,
          actionId: action.actionId,
          providerItemId: null,
        });
      } else if (action.action === "clarify-voice-question") {
        controller.requestClarification();
        const question = current();
        addTranscript({
          role: "system",
          source: "control",
          eventType: "clarification_request",
          text: "The candidate asked for clarification.",
          questionSequence: question.sequence,
          actionId: action.actionId,
          providerItemId: null,
        });
        addTranscript({
          role: "interviewer",
          source: "voice",
          eventType: "clarification_response",
          text:
            question.clarification ??
            "Please explain your own experience, decisions, constraints, and outcome. No specific answer is expected.",
          questionSequence: question.sequence,
          actionId: action.actionId,
          providerItemId: null,
        });
      } else {
        const state = controller.cancel();
        addTranscript({
          role: "system",
          source: "control",
          eventType: "cancellation",
          text: "The candidate ended this practice interview early.",
          questionSequence: session.currentQuestionIndex + 1,
          actionId: action.actionId,
          providerItemId: null,
        });
        tx.update(interviewSessions)
          .set({
            status: state.status,
            endedAt: now,
            durationSeconds: calculateDurationSeconds(session.startedAt, now),
            updatedAt: now,
          })
          .where(eq(interviewSessions.id, id))
          .run();
        tx.update(realtimeAttempts)
          .set({ status: "cancelled", endedAt: now, updatedAt: now })
          .where(eq(realtimeAttempts.sessionId, id))
          .run();
      }
      this.addReceipt(tx, id, action.actionId, action.action, now);
      return this.snapshot(tx, id);
    });
  }

  private getAttempt(db: AppDatabase, sessionId: string, attemptId: string) {
    const attempt = db
      .select()
      .from(realtimeAttempts)
      .where(
        and(
          eq(realtimeAttempts.id, attemptId),
          eq(realtimeAttempts.sessionId, sessionId),
        ),
      )
      .get();
    if (!attempt)
      throw new InterviewDomainError(
        "REALTIME_ATTEMPT_NOT_FOUND",
        "The voice connection attempt could not be found.",
      );
    return attempt;
  }

  private addReceipt(
    db: AppDatabase,
    sessionId: string,
    actionId: string,
    actionType: string,
    createdAt = new Date(),
  ) {
    db.insert(interviewActions)
      .values({
        id: crypto.randomUUID(),
        sessionId,
        actionId,
        actionType,
        createdAt,
      })
      .run();
  }

  private snapshot(db: AppDatabase, id: string) {
    const session = db
      .select()
      .from(interviewSessions)
      .where(eq(interviewSessions.id, id))
      .get();
    if (!session)
      throw new InterviewDomainError(
        "INTERVIEW_NOT_FOUND",
        "The interview could not be found.",
      );
    return {
      session,
      transcript: db
        .select()
        .from(transcriptItems)
        .where(eq(transcriptItems.sessionId, id))
        .orderBy(transcriptItems.sequence)
        .all(),
    };
  }
}
