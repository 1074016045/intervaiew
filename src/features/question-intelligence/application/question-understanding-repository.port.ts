import type { FinalizedQuestion } from "../domain/question-boundary";
import type { QuestionUnderstanding } from "../domain/question-understanding";

export type UnderstandingQuestionView = Readonly<{ question: FinalizedQuestion; understanding: QuestionUnderstanding | null }>;
export type UnderstandingSnapshot = Readonly<{ questions: ReadonlyArray<UnderstandingQuestionView> }>;
export type UnderstandingRepositoryResult<T> =
  | Readonly<{ kind: "success"; value: T; duplicated: boolean }>
  | Readonly<{ kind: "session-not-found" | "question-not-found" | "question-undone" | "ownership-mismatch" | "stale-revision" | "action-conflict" }>;

export interface QuestionUnderstandingRepositoryPort {
  listActive(analysisSessionId: string): UnderstandingRepositoryResult<UnderstandingSnapshot>;
  prepare(analysisSessionId: string, finalizedQuestionId: string, actionId: string): UnderstandingRepositoryResult<Readonly<{ question: FinalizedQuestion; cached: QuestionUnderstanding | null }>>;
  commit(input: { analysisSessionId: string; finalizedQuestion: FinalizedQuestion; actionId: string; understanding: QuestionUnderstanding; now: number }): UnderstandingRepositoryResult<UnderstandingSnapshot>;
}
