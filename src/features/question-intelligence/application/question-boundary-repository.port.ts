import type {
  BoundaryDecision,
  FinalizedQuestion,
  QuestionCandidate,
} from "../domain/question-boundary";

export const questionBoundaryActionTypes = [
  "evaluate",
  "force_finalize",
  "merge_previous",
  "undo",
] as const;
export type QuestionBoundaryActionType =
  (typeof questionBoundaryActionTypes)[number];

export type QuestionBoundarySnapshot = Readonly<{
  candidate: QuestionCandidate | null;
  decisions: ReadonlyArray<BoundaryDecision>;
  finalizedQuestions: ReadonlyArray<FinalizedQuestion>;
}>;

export type BoundaryRepositoryResult<T> =
  | Readonly<{ kind: "success"; value: T; duplicated: boolean }>
  | Readonly<{ kind: "session-not-found" }>
  | Readonly<{ kind: "session-state-invalid" }>
  | Readonly<{ kind: "candidate-not-found" }>
  | Readonly<{ kind: "stale-revision" }>
  | Readonly<{ kind: "action-conflict" }>
  | Readonly<{ kind: "question-not-found" }>
  | Readonly<{ kind: "previous-not-found" }>
  | Readonly<{ kind: "already-undone" }>;

export interface QuestionBoundaryRepositoryPort {
  getActionSnapshot(
    analysisSessionId: string,
    actionId: string,
    actionType: QuestionBoundaryActionType,
    now: number,
  ): BoundaryRepositoryResult<QuestionBoundarySnapshot> | null;
  getSnapshot(
    analysisSessionId: string,
    now: number,
  ): BoundaryRepositoryResult<QuestionBoundarySnapshot>;
  findDecisionForCandidateRevision(
    analysisSessionId: string,
    candidateId: string,
    candidateRevision: number,
  ): BoundaryDecision | null;
  saveEvaluation(input: {
    analysisSessionId: string;
    candidateRevision: number;
    actionId: string;
    decision: BoundaryDecision;
    now: number;
  }): BoundaryRepositoryResult<QuestionBoundarySnapshot>;
  forceFinalize(input: {
    analysisSessionId: string;
    candidateRevision: number;
    actionId: string;
    decision: BoundaryDecision;
    now: number;
  }): BoundaryRepositoryResult<QuestionBoundarySnapshot>;
  mergeWithPrevious(input: {
    analysisSessionId: string;
    targetQuestionId: string;
    actionId: string;
    decision: BoundaryDecision;
    now: number;
  }): BoundaryRepositoryResult<QuestionBoundarySnapshot>;
  undoFinalize(input: {
    analysisSessionId: string;
    targetQuestionId: string;
    actionId: string;
    decision: BoundaryDecision;
    now: number;
  }): BoundaryRepositoryResult<QuestionBoundarySnapshot>;
}
