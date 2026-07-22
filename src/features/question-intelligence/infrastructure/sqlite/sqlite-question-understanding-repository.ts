import "server-only";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { QuestionUnderstandingRepositoryPort, UnderstandingSnapshot } from "../../application/question-understanding-repository.port";
import { immutableFinalizedQuestion } from "../../domain/question-boundary";
import { immutableUnderstanding, type QuestionUnderstanding } from "../../domain/question-understanding";
import { getDatabase } from "@/infrastructure/db/client";
import { analysisSessions, finalizedQuestionSegments, finalizedQuestions, questionUnderstandingActions, questionUnderstandingClarifications, questionUnderstandingConstraints, questionUnderstandingDimensions, questionUnderstandingFocusTerms, questionUnderstandings, schema } from "@/infrastructure/db/schema";

type Database = BetterSQLite3Database<typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export class SqliteQuestionUnderstandingRepository implements QuestionUnderstandingRepositoryPort {
  constructor(private readonly db: Database = getDatabase().db, private readonly createId: () => string = () => crypto.randomUUID()) {}

  listActive(analysisSessionId: string) {
    return this.db.transaction((tx) => {
      if (!this.sessionExists(tx, analysisSessionId)) return { kind: "session-not-found" } as const;
      return { kind: "success", value: this.snapshot(tx, analysisSessionId), duplicated: false } as const;
    });
  }

  prepare(analysisSessionId: string, finalizedQuestionId: string, actionId: string) {
    return this.db.transaction((tx) => {
      if (!this.sessionExists(tx, analysisSessionId)) return { kind: "session-not-found" } as const;
      const question = tx.select().from(finalizedQuestions).where(eq(finalizedQuestions.id, finalizedQuestionId)).get();
      if (!question) return { kind: "question-not-found" } as const;
      if (question.analysisSessionId !== analysisSessionId) return { kind: "ownership-mismatch" } as const;
      if (question.undoneAt) return { kind: "question-undone" } as const;
      const action = this.findAction(tx, analysisSessionId, actionId);
      if (action && action.finalizedQuestionId !== finalizedQuestionId) return { kind: "action-conflict" } as const;
      const understanding = this.findUnderstanding(tx, finalizedQuestionId, question.revision);
      return { kind: "success", value: { question: this.questionView(tx, question), cached: understanding }, duplicated: Boolean(action) } as const;
    });
  }

  commit(input: { analysisSessionId: string; finalizedQuestion: ReturnType<typeof immutableFinalizedQuestion>; actionId: string; understanding: QuestionUnderstanding; now: number }) {
    return this.db.transaction((tx) => {
      const action = this.findAction(tx, input.analysisSessionId, input.actionId);
      if (action) {
        if (action.finalizedQuestionId !== input.finalizedQuestion.id) return { kind: "action-conflict" } as const;
        return { kind: "success", value: this.snapshot(tx, input.analysisSessionId), duplicated: true } as const;
      }
      const current = tx.select().from(finalizedQuestions).where(eq(finalizedQuestions.id, input.finalizedQuestion.id)).get();
      if (!current) return { kind: "question-not-found" } as const;
      if (current.analysisSessionId !== input.analysisSessionId) return { kind: "ownership-mismatch" } as const;
      if (current.undoneAt) return { kind: "question-undone" } as const;
      if (current.revision !== input.finalizedQuestion.revision || current.boundaryDecisionId !== input.finalizedQuestion.boundaryDecisionId) return { kind: "stale-revision" } as const;
      let stored = this.findUnderstanding(tx, current.id, current.revision);
      if (!stored) {
        tx.update(questionUnderstandings).set({ status: "superseded", updatedAt: new Date(input.now) }).where(and(eq(questionUnderstandings.finalizedQuestionId, current.id), ne(questionUnderstandings.finalizedQuestionRevision, current.revision), eq(questionUnderstandings.status, "completed"))).run();
        this.insertUnderstanding(tx, input.understanding);
        stored = input.understanding;
      }
      tx.insert(questionUnderstandingActions).values({ id: this.createId(), analysisSessionId: input.analysisSessionId, actionId: input.actionId, finalizedQuestionId: current.id, resultUnderstandingId: stored.id, createdAt: new Date(input.now) }).run();
      return { kind: "success", value: this.snapshot(tx, input.analysisSessionId), duplicated: false } as const;
    });
  }

  private snapshot(tx: Transaction, analysisSessionId: string): UnderstandingSnapshot {
    const questions = tx.select().from(finalizedQuestions).where(and(eq(finalizedQuestions.analysisSessionId, analysisSessionId), isNull(finalizedQuestions.undoneAt))).orderBy(asc(finalizedQuestions.firstSequence)).all();
    return Object.freeze({ questions: Object.freeze(questions.map((row) => ({ question: this.questionView(tx, row), understanding: this.findUnderstanding(tx, row.id, row.revision) }))) });
  }

  private insertUnderstanding(tx: Transaction, value: QuestionUnderstanding) {
    tx.insert(questionUnderstandings).values({
      id: value.id, analysisSessionId: value.analysisSessionId, finalizedQuestionId: value.finalizedQuestionId,
      finalizedQuestionRevision: value.finalizedQuestionRevision, sourceBoundaryDecisionId: value.sourceBoundaryDecisionId,
      understandingRevision: value.understandingRevision, language: value.language, questionFamily: value.questionFamily,
      expectedAnswerMode: value.expectedAnswerMode, requiresClarification: value.requiresClarification,
      confidence: Math.round(value.confidence * 10_000), decidedBy: value.decidedBy,
      semanticProviderUsed: value.semanticProviderUsed, status: value.status,
      createdAt: new Date(value.createdAt), updatedAt: new Date(value.updatedAt),
    }).run();
    if (value.requestedDimensions.length) tx.insert(questionUnderstandingDimensions).values(value.requestedDimensions.map((dimension, index) => ({ understandingId: value.id, dimension, sequence: index + 1 }))).run();
    if (value.explicitConstraints.length) tx.insert(questionUnderstandingConstraints).values(value.explicitConstraints.map((item) => ({ understandingId: value.id, ...item }))).run();
    if (value.focusTerms.length) tx.insert(questionUnderstandingFocusTerms).values(value.focusTerms.map((item) => ({ understandingId: value.id, ...item }))).run();
    tx.insert(questionUnderstandingClarifications).values(value.clarificationReasons.map((reason, index) => ({ understandingId: value.id, reason, sequence: index + 1 }))).run();
  }

  private findUnderstanding(tx: Transaction, finalizedQuestionId: string, revision: number) {
    const row = tx.select().from(questionUnderstandings).where(and(eq(questionUnderstandings.finalizedQuestionId, finalizedQuestionId), eq(questionUnderstandings.finalizedQuestionRevision, revision))).get();
    if (!row) return null;
    const dimensions = tx.select().from(questionUnderstandingDimensions).where(eq(questionUnderstandingDimensions.understandingId, row.id)).orderBy(asc(questionUnderstandingDimensions.sequence)).all().map((item) => item.dimension);
    const constraints = tx.select().from(questionUnderstandingConstraints).where(eq(questionUnderstandingConstraints.understandingId, row.id)).orderBy(asc(questionUnderstandingConstraints.sequence)).all().map(({ kind, value, sourceText, sequence }) => ({ kind, value, sourceText, sequence }));
    const focusTerms = tx.select().from(questionUnderstandingFocusTerms).where(eq(questionUnderstandingFocusTerms.understandingId, row.id)).orderBy(asc(questionUnderstandingFocusTerms.sequence)).all().map(({ normalized, sourceText, sequence }) => ({ normalized, sourceText, sequence }));
    const reasons = tx.select().from(questionUnderstandingClarifications).where(eq(questionUnderstandingClarifications.understandingId, row.id)).orderBy(asc(questionUnderstandingClarifications.sequence)).all().map((item) => item.reason);
    return immutableUnderstanding({ ...row, requestedDimensions: dimensions, explicitConstraints: constraints, focusTerms, clarificationReasons: reasons, confidence: row.confidence / 10_000, createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime() });
  }

  private questionView(tx: Transaction, row: typeof finalizedQuestions.$inferSelect) {
    const sourceSegmentIds = tx.select({ id: finalizedQuestionSegments.transcriptSegmentId }).from(finalizedQuestionSegments).where(eq(finalizedQuestionSegments.finalizedQuestionId, row.id)).orderBy(asc(finalizedQuestionSegments.sequence)).all().map((item) => item.id);
    return immutableFinalizedQuestion({ id: row.id, analysisSessionId: row.analysisSessionId, text: row.text, sourceSegmentIds, firstSequence: row.firstSequence, lastSequence: row.lastSequence, boundaryDecisionId: row.boundaryDecisionId, revision: row.revision, finalizedAt: row.finalizedAt.getTime(), undoneAt: row.undoneAt?.getTime() ?? null });
  }
  private sessionExists(tx: Transaction, id: string) { return Boolean(tx.select({ id: analysisSessions.id }).from(analysisSessions).where(eq(analysisSessions.id, id)).get()); }
  private findAction(tx: Transaction, sessionId: string, actionId: string) { return tx.select().from(questionUnderstandingActions).where(and(eq(questionUnderstandingActions.analysisSessionId, sessionId), eq(questionUnderstandingActions.actionId, actionId))).get(); }
}
