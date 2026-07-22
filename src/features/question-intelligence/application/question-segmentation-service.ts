import { z } from "zod";
import {
  immutableDecision,
  type BoundaryDecision,
  type DeterministicBoundaryResult,
  type QuestionCandidate,
} from "../domain/question-boundary";
import { QuestionIntelligenceError } from "../domain/question-intelligence-error";
import type { HybridBoundaryDetectorPort } from "./question-boundary-detector.port";
import type {
  BoundaryRepositoryResult,
  QuestionBoundaryRepositoryPort,
  QuestionBoundarySnapshot,
} from "./question-boundary-repository.port";
import type { QuestionBoundaryDetector } from "./question-boundary-detector.port";

const actionIdSchema = z.string().trim().min(1).max(200);
export const evaluateBoundarySchema = z
  .object({
    actionId: actionIdSchema,
    candidateRevision: z.number().int().positive(),
  })
  .strict();
export const forceFinalizeSchema = evaluateBoundarySchema;
export const questionTargetActionSchema = z
  .object({
    actionId: actionIdSchema,
    targetQuestionId: z.string().trim().min(1).max(200),
  })
  .strict();

export type QuestionBoundaryState = Readonly<
  QuestionBoundarySnapshot & {
    deterministic: DeterministicBoundaryResult | null;
    latestDecision: BoundaryDecision | null;
    semanticProviderCallCount: number;
  }
>;

export class QuestionSegmentationService {
  constructor(
    private readonly repository: QuestionBoundaryRepositoryPort,
    private readonly deterministic: QuestionBoundaryDetector,
    private readonly hybrid: HybridBoundaryDetectorPort,
    private readonly createId: () => string = () => crypto.randomUUID(),
    private readonly now: () => number = () => Date.now(),
    private readonly longPauseMs: number = 3000,
  ) {}

  getCurrentCandidate(analysisSessionId: string) {
    return this.getState(analysisSessionId).candidate;
  }

  listFinalizedQuestions(analysisSessionId: string) {
    return this.getState(analysisSessionId).finalizedQuestions;
  }

  listBoundaryDecisions(analysisSessionId: string) {
    return this.getState(analysisSessionId).decisions;
  }

  getState(analysisSessionId: string): QuestionBoundaryState {
    return this.stateFromResult(
      this.repository.getSnapshot(analysisSessionId, this.now()),
    );
  }

  async evaluateCandidate(analysisSessionId: string, input: unknown) {
    const parsed = evaluateBoundarySchema.parse(input);
    const duplicate = this.repository.getActionSnapshot(
      analysisSessionId,
      parsed.actionId,
      "evaluate",
      this.now(),
    );
    if (duplicate) return this.actionState(duplicate);
    const initial = this.getState(analysisSessionId);
    const candidate = this.requireCandidate(initial.candidate);
    if (candidate.revision !== parsed.candidateRevision)
      throw this.error(
        "QUESTION_BOUNDARY_STALE_REVISION",
        "The candidate revision is no longer current.",
      );

    const cached = this.repository.findDecisionForCandidateRevision(
      analysisSessionId,
      candidate.id,
      candidate.revision,
    );
    const decision =
      (cached && candidate.pauseAfterMs < this.longPauseMs ? cached : null) ??
      (await this.hybrid.evaluate(candidate, { actionId: parsed.actionId }));
    const result = this.repository.saveEvaluation({
      analysisSessionId,
      candidateRevision: parsed.candidateRevision,
      actionId: parsed.actionId,
      decision: cached && candidate.pauseAfterMs < this.longPauseMs
        ? immutableDecision({ ...cached, actionId: parsed.actionId })
        : decision,
      now: this.now(),
    });
    return this.actionState(result);
  }

  forceFinalize(analysisSessionId: string, input: unknown) {
    const parsed = forceFinalizeSchema.parse(input);
    const duplicate = this.repository.getActionSnapshot(
      analysisSessionId,
      parsed.actionId,
      "force_finalize",
      this.now(),
    );
    if (duplicate) return this.actionState(duplicate);
    const state = this.getState(analysisSessionId);
    const candidate = this.requireCandidate(state.candidate);
    if (candidate.revision !== parsed.candidateRevision)
      throw this.error(
        "QUESTION_BOUNDARY_STALE_REVISION",
        "The candidate revision is no longer current.",
      );
    if (!this.deterministic.detect(candidate).validContent)
      throw this.error(
        "QUESTION_CANDIDATE_INVALID",
        "The current candidate does not contain a valid question phrase.",
      );
    return this.actionState(
      this.repository.forceFinalize({
        analysisSessionId,
        candidateRevision: candidate.revision,
        actionId: parsed.actionId,
        decision: this.manualDecision(
          candidate,
          parsed.actionId,
          "manual_force_finalize",
          true,
        ),
        now: this.now(),
      }),
    );
  }

  mergeWithPrevious(analysisSessionId: string, input: unknown) {
    const parsed = questionTargetActionSchema.parse(input);
    const duplicate = this.repository.getActionSnapshot(
      analysisSessionId,
      parsed.actionId,
      "merge_previous",
      this.now(),
    );
    if (duplicate) return this.actionState(duplicate);
    const state = this.getState(analysisSessionId);
    const target = state.finalizedQuestions.find(
      (question) => question.id === parsed.targetQuestionId,
    );
    if (!target)
      throw this.error(
        "FINALIZED_QUESTION_NOT_FOUND",
        "The finalized question could not be found.",
      );
    const sourceDecision = state.decisions.find(
      (decision) => decision.id === target.boundaryDecisionId,
    );
    if (!sourceDecision)
      throw this.error(
        "FINALIZED_QUESTION_NOT_FOUND",
        "The finalized question could not be found.",
      );
    return this.actionState(
      this.repository.mergeWithPrevious({
        analysisSessionId,
        targetQuestionId: target.id,
        actionId: parsed.actionId,
        decision: this.manualDecisionFromSource(
          sourceDecision,
          parsed.actionId,
          "manual_merge_previous",
        ),
        now: this.now(),
      }),
    );
  }

  undoFinalize(analysisSessionId: string, input: unknown) {
    const parsed = questionTargetActionSchema.parse(input);
    const duplicate = this.repository.getActionSnapshot(
      analysisSessionId,
      parsed.actionId,
      "undo",
      this.now(),
    );
    if (duplicate) return this.actionState(duplicate);
    const state = this.getState(analysisSessionId);
    const target = state.finalizedQuestions.find(
      (question) => question.id === parsed.targetQuestionId,
    );
    if (!target)
      throw this.error(
        "FINALIZED_QUESTION_NOT_FOUND",
        "The finalized question could not be found.",
      );
    const sourceDecision = state.decisions.find(
      (decision) => decision.id === target.boundaryDecisionId,
    );
    if (!sourceDecision)
      throw this.error(
        "FINALIZED_QUESTION_NOT_FOUND",
        "The finalized question could not be found.",
      );
    return this.actionState(
      this.repository.undoFinalize({
        analysisSessionId,
        targetQuestionId: target.id,
        actionId: parsed.actionId,
        decision: this.manualDecisionFromSource(
          sourceDecision,
          parsed.actionId,
          "manual_undo",
        ),
        now: this.now(),
      }),
    );
  }

  private manualDecision(
    candidate: QuestionCandidate,
    actionId: string,
    reasonCode: "manual_force_finalize",
    shouldFinalize: boolean,
  ) {
    return immutableDecision({
      id: this.createId(),
      analysisSessionId: candidate.analysisSessionId,
      candidateId: candidate.id,
      candidateRevision: candidate.revision,
      status: "finalized",
      shouldFinalize,
      confidence: 1,
      reasonCode,
      decidedBy: "manual",
      semanticProviderUsed: false,
      actionId,
      createdAt: this.now(),
    });
  }

  private manualDecisionFromSource(
    source: BoundaryDecision,
    actionId: string,
    reasonCode: "manual_merge_previous" | "manual_undo",
  ) {
    return immutableDecision({
      ...source,
      id: this.createId(),
      status: reasonCode === "manual_undo" ? "rejected" : "finalized",
      shouldFinalize: reasonCode !== "manual_undo",
      confidence: 1,
      reasonCode,
      decidedBy: "manual",
      semanticProviderUsed: false,
      actionId,
      createdAt: this.now(),
    });
  }

  private requireCandidate(candidate: QuestionCandidate | null) {
    if (!candidate)
      throw this.error(
        "QUESTION_CANDIDATE_NOT_FOUND",
        "No current question candidate is available.",
      );
    return candidate;
  }

  private actionState(
    result: BoundaryRepositoryResult<QuestionBoundarySnapshot>,
  ) {
    const state = this.stateFromResult(result);
    return Object.freeze({
      ...state,
      duplicated: result.kind === "success" && result.duplicated,
    });
  }

  private stateFromResult(
    result: BoundaryRepositoryResult<QuestionBoundarySnapshot>,
  ): QuestionBoundaryState {
    if (result.kind !== "success") this.throwRepositoryError(result.kind);
    const value = result.value;
    const deterministic = value.candidate
      ? this.deterministic.detect(value.candidate)
      : null;
    return Object.freeze({
      ...value,
      deterministic,
      latestDecision: value.decisions.at(-1) ?? null,
      semanticProviderCallCount: value.decisions.filter(
        (decision) => decision.semanticProviderUsed,
      ).length,
    });
  }

  private throwRepositoryError(
    kind: Exclude<BoundaryRepositoryResult<never>["kind"], "success">,
  ): never {
    const errors = {
      "session-not-found": [
        "QUESTION_BOUNDARY_SESSION_INVALID",
        "The analysis session could not be found.",
      ],
      "session-state-invalid": [
        "QUESTION_BOUNDARY_SESSION_INVALID",
        "The analysis session state does not allow this action.",
      ],
      "candidate-not-found": [
        "QUESTION_CANDIDATE_NOT_FOUND",
        "No current question candidate is available.",
      ],
      "stale-revision": [
        "QUESTION_BOUNDARY_STALE_REVISION",
        "The candidate revision is no longer current.",
      ],
      "action-conflict": [
        "QUESTION_BOUNDARY_ACTION_DUPLICATE",
        "The action identifier is already used by another action.",
      ],
      "question-not-found": [
        "FINALIZED_QUESTION_NOT_FOUND",
        "The finalized question could not be found.",
      ],
      "previous-not-found": [
        "FINALIZED_QUESTION_PREVIOUS_NOT_FOUND",
        "No previous finalized question is available.",
      ],
      "already-undone": [
        "FINALIZED_QUESTION_ALREADY_UNDONE",
        "The finalized question has already been undone.",
      ],
    } as const;
    const [code, message] = errors[kind];
    throw this.error(code, message);
  }

  private error(
    code: ConstructorParameters<typeof QuestionIntelligenceError>[0],
    message: string,
  ) {
    return new QuestionIntelligenceError(code, message);
  }
}
