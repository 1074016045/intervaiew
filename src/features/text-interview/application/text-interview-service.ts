import "server-only";
import { and, eq, max } from "drizzle-orm";
import { z } from "zod";
import {
  InterviewController,
  calculateDurationSeconds,
} from "@/features/interviews/domain/interview-controller";
import { InterviewDomainError } from "@/features/interviews/domain/interview-errors";
import type { AppDatabase } from "@/infrastructure/repositories/interview.repository";
import { getDatabase } from "@/infrastructure/db/client";
import {
  interviewActions,
  interviewQuestions,
  interviewSessions,
  transcriptItems,
} from "@/infrastructure/db/schema";

export const interviewActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), actionId: z.uuid() }),
  z.object({
    action: z.literal("submit-answer"),
    actionId: z.uuid(),
    answer: z.string().trim().min(1).max(20_000),
  }),
  z.object({ action: z.literal("repeat-question"), actionId: z.uuid() }),
  z.object({ action: z.literal("request-clarification"), actionId: z.uuid() }),
  z.object({ action: z.literal("cancel"), actionId: z.uuid() }),
]);
export type InterviewAction = z.infer<typeof interviewActionSchema>;

export class TextInterviewService {
  constructor(private readonly db: AppDatabase = getDatabase().db) {}

  perform(id: string, rawAction: unknown) {
    const action = interviewActionSchema.parse(rawAction);
    return this.db.transaction((tx) => {
      const existing = tx
        .select()
        .from(interviewActions)
        .where(
          and(
            eq(interviewActions.sessionId, id),
            eq(interviewActions.actionId, action.actionId),
          ),
        )
        .get();
      if (existing) return this.snapshot(tx, id);
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
      const controller = new InterviewController({
        status: session.status,
        currentQuestionIndex: session.currentQuestionIndex,
        questionCount: session.questionCount,
      });
      const now = new Date();
      let nextSequence =
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
            sequence: nextSequence++,
            createdAt: now,
            ...item,
          })
          .run();
      };
      const currentQuestion = () =>
        questions[controller.snapshot().currentQuestionIndex];

      if (action.action === "start") {
        if (!questions.length)
          throw new InterviewDomainError(
            "QUESTION_PLAN_REQUIRED",
            "Generate questions before starting.",
          );
        const state = controller.start();
        const question = currentQuestion();
        tx.update(interviewSessions)
          .set({
            status: state.status,
            startedAt: session.startedAt ?? now,
            updatedAt: now,
          })
          .where(eq(interviewSessions.id, id))
          .run();
        addTranscript({
          role: "interviewer",
          source: "text",
          eventType: "question",
          text: question.question,
          questionSequence: question.sequence,
          actionId: action.actionId,
        });
      } else if (action.action === "submit-answer") {
        const answered = currentQuestion();
        if (!answered)
          throw new InterviewDomainError(
            "QUESTION_NOT_FOUND",
            "The current question could not be found.",
          );
        addTranscript({
          role: "candidate",
          source: "text",
          eventType: "answer",
          text: action.answer,
          questionSequence: answered.sequence,
          actionId: action.actionId,
        });
        const state = controller.submitAnswer();
        if (state.status === "ending") {
          const completed = controller.finish();
          addTranscript({
            role: "interviewer",
            source: "control",
            eventType: "completion",
            text: "Thank you. This practice interview is complete.",
            questionSequence: answered.sequence,
            actionId: action.actionId,
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
        } else {
          const next = questions[state.currentQuestionIndex];
          addTranscript({
            role: "interviewer",
            source: "text",
            eventType: "question",
            text: next.question,
            questionSequence: next.sequence,
            actionId: action.actionId,
          });
          tx.update(interviewSessions)
            .set({
              currentQuestionIndex: state.currentQuestionIndex,
              updatedAt: now,
            })
            .where(eq(interviewSessions.id, id))
            .run();
        }
      } else if (action.action === "repeat-question") {
        controller.repeatCurrentQuestion();
        const question = currentQuestion();
        addTranscript({
          role: "system",
          source: "control",
          eventType: "repeat_request",
          text: "The candidate asked to repeat the question.",
          questionSequence: question.sequence,
          actionId: action.actionId,
        });
        addTranscript({
          role: "interviewer",
          source: "text",
          eventType: "question",
          text: question.question,
          questionSequence: question.sequence,
          actionId: action.actionId,
        });
      } else if (action.action === "request-clarification") {
        controller.requestClarification();
        const question = currentQuestion();
        addTranscript({
          role: "system",
          source: "control",
          eventType: "clarification_request",
          text: "The candidate asked for clarification.",
          questionSequence: question.sequence,
          actionId: action.actionId,
        });
        addTranscript({
          role: "interviewer",
          source: "control",
          eventType: "clarification_response",
          text:
            question.clarification ??
            "Please explain your own experience, decisions, constraints, and outcome. No specific answer is expected.",
          questionSequence: question.sequence,
          actionId: action.actionId,
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
      }
      tx.insert(interviewActions)
        .values({
          id: crypto.randomUUID(),
          sessionId: id,
          actionId: action.actionId,
          actionType: action.action,
          createdAt: now,
        })
        .run();
      return this.snapshot(tx, id);
    });
  }

  private snapshot(db: AppDatabase, id: string) {
    const session = db
      .select({
        id: interviewSessions.id,
        status: interviewSessions.status,
        currentQuestionIndex: interviewSessions.currentQuestionIndex,
        questionCount: interviewSessions.questionCount,
        startedAt: interviewSessions.startedAt,
        endedAt: interviewSessions.endedAt,
        durationSeconds: interviewSessions.durationSeconds,
      })
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
