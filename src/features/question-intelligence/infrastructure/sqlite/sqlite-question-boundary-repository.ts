import "server-only";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { QuestionCandidateBuilder } from "../../application/question-candidate-builder";
import type {
  BoundaryRepositoryResult,
  QuestionBoundaryActionType,
  QuestionBoundaryRepositoryPort,
  QuestionBoundarySnapshot,
} from "../../application/question-boundary-repository.port";
import type { TranscriptSegmentView } from "../../domain/analysis-session";
import {
  immutableCandidate,
  immutableDecision,
  immutableFinalizedQuestion,
  type BoundaryDecision,
  type FinalizedQuestion,
  type QuestionCandidate,
} from "../../domain/question-boundary";
import { getDatabase } from "@/infrastructure/db/client";
import {
  analysisSessions,
  boundaryDecisions,
  finalizedQuestionSegments,
  finalizedQuestions,
  questionBoundaryActions,
  questionCandidateSegments,
  questionCandidates,
  schema,
  transcriptSegments,
} from "@/infrastructure/db/schema";

type AnalysisDatabase = BetterSQLite3Database<typeof schema>;
type AnalysisTransaction = Parameters<
  Parameters<AnalysisDatabase["transaction"]>[0]
>[0];

const allowedStatuses = new Set(["draft", "active", "paused", "completed"]);

export class SqliteQuestionBoundaryRepository implements QuestionBoundaryRepositoryPort {
  private readonly builder = new QuestionCandidateBuilder();

  constructor(
    private readonly db: AnalysisDatabase = getDatabase().db,
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {}

  getActionSnapshot(
    analysisSessionId: string,
    actionId: string,
    actionType: QuestionBoundaryActionType,
    now: number,
  ): BoundaryRepositoryResult<QuestionBoundarySnapshot> | null {
    return this.db.transaction((tx) => {
      const action = this.findAction(tx, analysisSessionId, actionId);
      if (!action) return null;
      if (action.actionType !== actionType)
        return { kind: "action-conflict" } as const;
      const refreshed = this.refreshCandidate(tx, analysisSessionId, now);
      if (refreshed !== "ok") return this.refreshError(refreshed);
      return {
        kind: "success",
        value: this.snapshot(tx, analysisSessionId),
        duplicated: true,
      } as const;
    });
  }

  getSnapshot(analysisSessionId: string, now: number) {
    return this.db.transaction((tx) => {
      const refreshed = this.refreshCandidate(tx, analysisSessionId, now);
      if (refreshed !== "ok") return this.refreshError(refreshed);
      return {
        kind: "success",
        value: this.snapshot(tx, analysisSessionId),
        duplicated: false,
      } as const;
    });
  }

  findDecisionForCandidateRevision(
    analysisSessionId: string,
    candidateId: string,
    candidateRevision: number,
  ) {
    const row = this.db
      .select()
      .from(boundaryDecisions)
      .where(
        and(
          eq(boundaryDecisions.analysisSessionId, analysisSessionId),
          eq(boundaryDecisions.candidateId, candidateId),
          eq(boundaryDecisions.candidateRevision, candidateRevision),
          eq(boundaryDecisions.semanticProviderUsed, true),
        ),
      )
      .orderBy(desc(boundaryDecisions.createdAt))
      .get();
    return row ? this.decisionView(row) : null;
  }

  saveEvaluation(input: {
    analysisSessionId: string;
    candidateRevision: number;
    actionId: string;
    decision: BoundaryDecision;
    now: number;
  }) {
    return this.persistCandidateDecision("evaluate", input);
  }

  forceFinalize(input: {
    analysisSessionId: string;
    candidateRevision: number;
    actionId: string;
    decision: BoundaryDecision;
    now: number;
  }) {
    return this.persistCandidateDecision("force_finalize", input);
  }

  mergeWithPrevious(input: {
    analysisSessionId: string;
    targetQuestionId: string;
    actionId: string;
    decision: BoundaryDecision;
    now: number;
  }) {
    return this.db.transaction((tx) => {
      const duplicate = this.actionResult(
        tx,
        input.analysisSessionId,
        input.actionId,
        "merge_previous",
      );
      if (duplicate) return duplicate;
      const session = this.sessionStatus(tx, input.analysisSessionId);
      if (session !== "ok") return this.refreshError(session);
      const target = tx
        .select()
        .from(finalizedQuestions)
        .where(
          and(
            eq(finalizedQuestions.analysisSessionId, input.analysisSessionId),
            eq(finalizedQuestions.id, input.targetQuestionId),
          ),
        )
        .get();
      if (!target) return { kind: "question-not-found" } as const;
      if (target.undoneAt) return { kind: "already-undone" } as const;
      const activeQuestions = tx
        .select()
        .from(finalizedQuestions)
        .where(
          and(
            eq(finalizedQuestions.analysisSessionId, input.analysisSessionId),
            isNull(finalizedQuestions.undoneAt),
          ),
        )
        .orderBy(asc(finalizedQuestions.firstSequence))
        .all();
      const targetIndex = activeQuestions.findIndex(
        (question) => question.id === target.id,
      );
      if (targetIndex <= 0) return { kind: "previous-not-found" } as const;
      const previous = activeQuestions[targetIndex - 1];
      this.insertDecision(tx, input.decision);

      const combinedRows = tx
        .select({
          id: transcriptSegments.id,
          sequence: transcriptSegments.sequence,
          text: transcriptSegments.text,
        })
        .from(finalizedQuestionSegments)
        .innerJoin(
          transcriptSegments,
          eq(
            finalizedQuestionSegments.transcriptSegmentId,
            transcriptSegments.id,
          ),
        )
        .where(
          // Both questions belong to the checked session; selecting by the two
          // explicit ids avoids accepting client-provided segment identifiers.
          eq(finalizedQuestionSegments.finalizedQuestionId, previous.id),
        )
        .all();
      const targetRows = tx
        .select({
          id: transcriptSegments.id,
          sequence: transcriptSegments.sequence,
          text: transcriptSegments.text,
        })
        .from(finalizedQuestionSegments)
        .innerJoin(
          transcriptSegments,
          eq(
            finalizedQuestionSegments.transcriptSegmentId,
            transcriptSegments.id,
          ),
        )
        .where(eq(finalizedQuestionSegments.finalizedQuestionId, target.id))
        .all();
      const combined = [...combinedRows, ...targetRows]
        .filter(
          (row, index, rows) =>
            rows.findIndex((item) => item.id === row.id) === index,
        )
        .sort((left, right) => left.sequence - right.sequence);
      const first = combined[0];
      const last = combined.at(-1);
      if (!first || !last) return { kind: "question-not-found" } as const;
      tx.update(finalizedQuestions)
        .set({
          text: combined.map((row) => row.text.trim()).join(" "),
          firstSequence: first.sequence,
          lastSequence: last.sequence,
          boundaryDecisionId: input.decision.id,
          revision: previous.revision + 1,
          finalizedAt: new Date(input.now),
        })
        .where(eq(finalizedQuestions.id, previous.id))
        .run();
      tx.delete(finalizedQuestionSegments)
        .where(eq(finalizedQuestionSegments.finalizedQuestionId, previous.id))
        .run();
      tx.insert(finalizedQuestionSegments)
        .values(
          combined.map((row) => ({
            finalizedQuestionId: previous.id,
            transcriptSegmentId: row.id,
            sequence: row.sequence,
          })),
        )
        .run();
      tx.update(finalizedQuestions)
        .set({ undoneAt: new Date(input.now) })
        .where(eq(finalizedQuestions.id, target.id))
        .run();
      this.insertAction(tx, {
        analysisSessionId: input.analysisSessionId,
        actionId: input.actionId,
        actionType: "merge_previous",
        targetQuestionId: target.id,
        resultEntityId: previous.id,
        now: input.now,
      });
      const refreshed = this.refreshCandidate(
        tx,
        input.analysisSessionId,
        input.now,
      );
      if (refreshed !== "ok") return this.refreshError(refreshed);
      return this.success(tx, input.analysisSessionId, false);
    });
  }

  undoFinalize(input: {
    analysisSessionId: string;
    targetQuestionId: string;
    actionId: string;
    decision: BoundaryDecision;
    now: number;
  }) {
    return this.db.transaction((tx) => {
      const duplicate = this.actionResult(
        tx,
        input.analysisSessionId,
        input.actionId,
        "undo",
      );
      if (duplicate) return duplicate;
      const session = this.sessionStatus(tx, input.analysisSessionId);
      if (session !== "ok") return this.refreshError(session);
      const target = tx
        .select()
        .from(finalizedQuestions)
        .where(
          and(
            eq(finalizedQuestions.analysisSessionId, input.analysisSessionId),
            eq(finalizedQuestions.id, input.targetQuestionId),
          ),
        )
        .get();
      if (!target) return { kind: "question-not-found" } as const;
      if (target.undoneAt) return { kind: "already-undone" } as const;
      this.insertDecision(tx, input.decision);
      tx.update(finalizedQuestions)
        .set({ undoneAt: new Date(input.now) })
        .where(eq(finalizedQuestions.id, target.id))
        .run();
      this.insertAction(tx, {
        analysisSessionId: input.analysisSessionId,
        actionId: input.actionId,
        actionType: "undo",
        targetQuestionId: target.id,
        resultEntityId: target.id,
        now: input.now,
      });
      const refreshed = this.refreshCandidate(
        tx,
        input.analysisSessionId,
        input.now,
      );
      if (refreshed !== "ok") return this.refreshError(refreshed);
      return this.success(tx, input.analysisSessionId, false);
    });
  }

  private persistCandidateDecision(
    actionType: "evaluate" | "force_finalize",
    input: {
      analysisSessionId: string;
      candidateRevision: number;
      actionId: string;
      decision: BoundaryDecision;
      now: number;
    },
  ) {
    return this.db.transaction((tx) => {
      const duplicate = this.actionResult(
        tx,
        input.analysisSessionId,
        input.actionId,
        actionType,
      );
      if (duplicate) return duplicate;
      const refreshed = this.refreshCandidate(
        tx,
        input.analysisSessionId,
        input.now,
      );
      if (refreshed !== "ok") return this.refreshError(refreshed);
      const candidate = this.activeCandidate(tx, input.analysisSessionId);
      if (!candidate) return { kind: "candidate-not-found" } as const;
      if (
        candidate.revision !== input.candidateRevision ||
        candidate.id !== input.decision.candidateId ||
        input.decision.candidateRevision !== input.candidateRevision
      )
        return { kind: "stale-revision" } as const;

      const existingDecision = tx
        .select({ id: boundaryDecisions.id })
        .from(boundaryDecisions)
        .where(eq(boundaryDecisions.id, input.decision.id))
        .get();
      if (!existingDecision) this.insertDecision(tx, input.decision);

      let resultEntityId = input.decision.id;
      if (input.decision.shouldFinalize) {
        const questionId = this.createId();
        tx.insert(finalizedQuestions)
          .values({
            id: questionId,
            analysisSessionId: input.analysisSessionId,
            text: candidate.text,
            firstSequence: candidate.firstSequence,
            lastSequence: candidate.lastSequence,
            boundaryDecisionId: input.decision.id,
            revision: 1,
            finalizedAt: new Date(input.now),
            undoneAt: null,
          })
          .run();
        const mappings = tx
          .select()
          .from(questionCandidateSegments)
          .where(eq(questionCandidateSegments.candidateId, candidate.id))
          .orderBy(asc(questionCandidateSegments.sequence))
          .all();
        tx.insert(finalizedQuestionSegments)
          .values(
            mappings.map((mapping) => ({
              finalizedQuestionId: questionId,
              transcriptSegmentId: mapping.transcriptSegmentId,
              sequence: mapping.sequence,
            })),
          )
          .run();
        tx.update(questionCandidates)
          .set({ status: "finalized", updatedAt: new Date(input.now) })
          .where(eq(questionCandidates.id, candidate.id))
          .run();
        resultEntityId = questionId;
      }
      this.insertAction(tx, {
        analysisSessionId: input.analysisSessionId,
        actionId: input.actionId,
        actionType,
        targetQuestionId: null,
        resultEntityId,
        now: input.now,
      });
      const after = this.refreshCandidate(
        tx,
        input.analysisSessionId,
        input.now,
      );
      if (after !== "ok") return this.refreshError(after);
      return this.success(tx, input.analysisSessionId, false);
    });
  }

  private refreshCandidate(
    tx: AnalysisTransaction,
    analysisSessionId: string,
    now: number,
  ): "ok" | "session-not-found" | "session-state-invalid" {
    const status = this.sessionStatus(tx, analysisSessionId);
    if (status !== "ok") return status;
    const previousRow = this.activeCandidate(tx, analysisSessionId);
    const previous = previousRow ? this.candidateView(tx, previousRow) : null;
    const assigned = new Set(
      tx
        .select({ id: finalizedQuestionSegments.transcriptSegmentId })
        .from(finalizedQuestionSegments)
        .innerJoin(
          finalizedQuestions,
          eq(
            finalizedQuestionSegments.finalizedQuestionId,
            finalizedQuestions.id,
          ),
        )
        .where(
          and(
            eq(finalizedQuestions.analysisSessionId, analysisSessionId),
            isNull(finalizedQuestions.undoneAt),
          ),
        )
        .all()
        .map((row) => row.id),
    );
    const segments = tx
      .select()
      .from(transcriptSegments)
      .where(eq(transcriptSegments.analysisSessionId, analysisSessionId))
      .orderBy(asc(transcriptSegments.sequence))
      .all()
      .map((row) => this.segmentView(row));
    const candidate = this.builder.build({
      analysisSessionId,
      segments,
      assignedSegmentIds: assigned,
      previousCandidate: previous,
      now,
      createId: this.createId,
    });
    if (!candidate) {
      if (previousRow)
        tx.update(questionCandidates)
          .set({ status: "superseded", updatedAt: new Date(now) })
          .where(eq(questionCandidates.id, previousRow.id))
          .run();
      return "ok";
    }
    if (previousRow) {
      tx.update(questionCandidates)
        .set({
          revision: candidate.revision,
          text: candidate.text,
          firstSequence: candidate.firstSequence,
          lastSequence: candidate.lastSequence,
          startedAtMs: candidate.startedAtMs,
          endedAtMs: candidate.endedAtMs,
          pauseAfterMs: candidate.pauseAfterMs,
          updatedAt: new Date(candidate.updatedAt),
        })
        .where(eq(questionCandidates.id, candidate.id))
        .run();
      if (candidate.revision !== previousRow.revision) {
        tx.delete(questionCandidateSegments)
          .where(eq(questionCandidateSegments.candidateId, candidate.id))
          .run();
        this.insertCandidateMappings(tx, candidate, segments);
      }
    } else {
      tx.insert(questionCandidates)
        .values({
          id: candidate.id,
          analysisSessionId,
          revision: candidate.revision,
          text: candidate.text,
          firstSequence: candidate.firstSequence,
          lastSequence: candidate.lastSequence,
          speakerRole: candidate.speakerRole,
          startedAtMs: candidate.startedAtMs,
          endedAtMs: candidate.endedAtMs,
          pauseAfterMs: candidate.pauseAfterMs,
          status: candidate.status,
          createdAt: new Date(candidate.createdAt),
          updatedAt: new Date(candidate.updatedAt),
        })
        .run();
      this.insertCandidateMappings(tx, candidate, segments);
    }
    return "ok";
  }

  private insertCandidateMappings(
    tx: AnalysisTransaction,
    candidate: QuestionCandidate,
    segments: ReadonlyArray<TranscriptSegmentView>,
  ) {
    const byId = new Map(segments.map((segment) => [segment.id, segment]));
    tx.insert(questionCandidateSegments)
      .values(
        candidate.segmentIds.map((id) => {
          const segment = byId.get(id);
          if (!segment) throw new Error("QUESTION_BOUNDARY_SEGMENT_MISSING");
          return {
            candidateId: candidate.id,
            transcriptSegmentId: id,
            sequence: segment.sequence,
          };
        }),
      )
      .run();
  }

  private snapshot(
    tx: AnalysisTransaction,
    analysisSessionId: string,
  ): QuestionBoundarySnapshot {
    const candidateRow = this.activeCandidate(tx, analysisSessionId);
    const decisions = tx
      .select()
      .from(boundaryDecisions)
      .where(eq(boundaryDecisions.analysisSessionId, analysisSessionId))
      .orderBy(asc(boundaryDecisions.createdAt), asc(boundaryDecisions.id))
      .all()
      .map((row) => this.decisionView(row));
    const questions = tx
      .select()
      .from(finalizedQuestions)
      .where(eq(finalizedQuestions.analysisSessionId, analysisSessionId))
      .orderBy(
        asc(finalizedQuestions.firstSequence),
        asc(finalizedQuestions.finalizedAt),
      )
      .all()
      .map((row) => this.questionView(tx, row));
    return Object.freeze({
      candidate: candidateRow ? this.candidateView(tx, candidateRow) : null,
      decisions: Object.freeze(decisions),
      finalizedQuestions: Object.freeze(questions),
    });
  }

  private success(
    tx: AnalysisTransaction,
    analysisSessionId: string,
    duplicated: boolean,
  ) {
    return {
      kind: "success",
      value: this.snapshot(tx, analysisSessionId),
      duplicated,
    } as const;
  }

  private actionResult(
    tx: AnalysisTransaction,
    analysisSessionId: string,
    actionId: string,
    actionType: QuestionBoundaryActionType,
  ) {
    const existing = this.findAction(tx, analysisSessionId, actionId);
    if (!existing) return null;
    if (existing.actionType !== actionType)
      return { kind: "action-conflict" } as const;
    return this.success(tx, analysisSessionId, true);
  }

  private findAction(
    tx: AnalysisTransaction,
    analysisSessionId: string,
    actionId: string,
  ) {
    return tx
      .select()
      .from(questionBoundaryActions)
      .where(
        and(
          eq(questionBoundaryActions.analysisSessionId, analysisSessionId),
          eq(questionBoundaryActions.actionId, actionId),
        ),
      )
      .get();
  }

  private insertAction(
    tx: AnalysisTransaction,
    input: {
      analysisSessionId: string;
      actionId: string;
      actionType: QuestionBoundaryActionType;
      targetQuestionId: string | null;
      resultEntityId: string | null;
      now: number;
    },
  ) {
    tx.insert(questionBoundaryActions)
      .values({
        id: this.createId(),
        analysisSessionId: input.analysisSessionId,
        actionId: input.actionId,
        actionType: input.actionType,
        targetQuestionId: input.targetQuestionId,
        resultEntityId: input.resultEntityId,
        createdAt: new Date(input.now),
      })
      .run();
  }

  private insertDecision(tx: AnalysisTransaction, decision: BoundaryDecision) {
    tx.insert(boundaryDecisions)
      .values({
        id: decision.id,
        analysisSessionId: decision.analysisSessionId,
        candidateId: decision.candidateId,
        candidateRevision: decision.candidateRevision,
        status: decision.status,
        shouldFinalize: decision.shouldFinalize,
        confidence: Math.round(decision.confidence * 10_000),
        reasonCode: decision.reasonCode,
        decidedBy: decision.decidedBy,
        semanticProviderUsed: decision.semanticProviderUsed,
        actionId: decision.actionId,
        createdAt: new Date(decision.createdAt),
      })
      .run();
  }

  private sessionStatus(tx: AnalysisTransaction, analysisSessionId: string) {
    const session = tx
      .select({ status: analysisSessions.status })
      .from(analysisSessions)
      .where(eq(analysisSessions.id, analysisSessionId))
      .get();
    if (!session) return "session-not-found" as const;
    return allowedStatuses.has(session.status)
      ? ("ok" as const)
      : ("session-state-invalid" as const);
  }

  private refreshError(kind: "session-not-found" | "session-state-invalid") {
    return { kind } as const;
  }

  private activeCandidate(tx: AnalysisTransaction, analysisSessionId: string) {
    return tx
      .select()
      .from(questionCandidates)
      .where(
        and(
          eq(questionCandidates.analysisSessionId, analysisSessionId),
          eq(questionCandidates.status, "active"),
        ),
      )
      .orderBy(desc(questionCandidates.updatedAt))
      .get();
  }

  private candidateView(
    tx: AnalysisTransaction,
    row: typeof questionCandidates.$inferSelect,
  ) {
    const segmentIds = tx
      .select({ id: questionCandidateSegments.transcriptSegmentId })
      .from(questionCandidateSegments)
      .where(eq(questionCandidateSegments.candidateId, row.id))
      .orderBy(asc(questionCandidateSegments.sequence))
      .all()
      .map((mapping) => mapping.id);
    return immutableCandidate({
      id: row.id,
      analysisSessionId: row.analysisSessionId,
      revision: row.revision,
      text: row.text,
      segmentIds,
      firstSequence: row.firstSequence,
      lastSequence: row.lastSequence,
      speakerRole: row.speakerRole,
      startedAtMs: row.startedAtMs,
      endedAtMs: row.endedAtMs,
      pauseAfterMs: row.pauseAfterMs,
      status: row.status,
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    });
  }

  private decisionView(row: typeof boundaryDecisions.$inferSelect) {
    return immutableDecision({
      id: row.id,
      analysisSessionId: row.analysisSessionId,
      candidateId: row.candidateId,
      candidateRevision: row.candidateRevision,
      status: row.status,
      shouldFinalize: row.shouldFinalize,
      confidence: row.confidence / 10_000,
      reasonCode: row.reasonCode,
      decidedBy: row.decidedBy,
      semanticProviderUsed: row.semanticProviderUsed,
      actionId: row.actionId,
      createdAt: row.createdAt.getTime(),
    });
  }

  private questionView(
    tx: AnalysisTransaction,
    row: typeof finalizedQuestions.$inferSelect,
  ): FinalizedQuestion {
    const sourceSegmentIds = tx
      .select({ id: finalizedQuestionSegments.transcriptSegmentId })
      .from(finalizedQuestionSegments)
      .where(eq(finalizedQuestionSegments.finalizedQuestionId, row.id))
      .orderBy(asc(finalizedQuestionSegments.sequence))
      .all()
      .map((mapping) => mapping.id);
    return immutableFinalizedQuestion({
      id: row.id,
      analysisSessionId: row.analysisSessionId,
      text: row.text,
      sourceSegmentIds,
      firstSequence: row.firstSequence,
      lastSequence: row.lastSequence,
      boundaryDecisionId: row.boundaryDecisionId,
      revision: row.revision,
      finalizedAt: row.finalizedAt.getTime(),
      undoneAt: row.undoneAt?.getTime() ?? null,
    });
  }

  private segmentView(
    segment: typeof transcriptSegments.$inferSelect,
  ): TranscriptSegmentView {
    return Object.freeze({
      id: segment.id,
      analysisSessionId: segment.analysisSessionId,
      providerSegmentId: segment.providerSegmentId,
      sequence: segment.sequence,
      speakerRole: segment.speakerRole,
      text: segment.text,
      startMs: segment.startMs,
      endMs: segment.endMs,
      createdAt: segment.createdAt.getTime(),
    });
  }
}
