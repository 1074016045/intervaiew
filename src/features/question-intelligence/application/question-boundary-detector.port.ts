import type {
  BoundaryDecision,
  DeterministicBoundaryResult,
  QuestionCandidate,
} from "../domain/question-boundary";

export interface QuestionBoundaryDetector {
  detect(candidate: QuestionCandidate): DeterministicBoundaryResult;
}

export type HybridBoundaryEvaluationOptions = Readonly<{
  actionId?: string | null;
  signal?: AbortSignal;
}>;

export interface HybridBoundaryDetectorPort {
  evaluate(
    candidate: QuestionCandidate,
    options?: HybridBoundaryEvaluationOptions,
  ): Promise<BoundaryDecision>;
  dispose(): void;
}
