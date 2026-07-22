import {
  immutableDecision,
  type BoundaryDecision,
  type BoundaryDecisionReasonCode,
  type BoundaryDecisionSource,
  type BoundaryDecisionStatus,
  type DeterministicBoundaryResult,
  type QuestionBoundaryPauseConfig,
  type QuestionCandidate,
} from "../domain/question-boundary";
import type {
  HybridBoundaryDetectorPort,
  HybridBoundaryEvaluationOptions,
  QuestionBoundaryDetector,
} from "./question-boundary-detector.port";
import {
  semanticBoundaryDecisionSchema,
  type SemanticQuestionBoundaryProvider,
} from "./semantic-question-boundary-provider.port";

type ActiveRequest = Readonly<{
  revision: number;
  controller: AbortController;
}>;

export class HybridQuestionBoundaryDetector implements HybridBoundaryDetectorPort {
  private readonly semanticCache = new Map<string, BoundaryDecision>();
  private readonly active = new Map<string, ActiveRequest>();

  constructor(
    private readonly deterministic: QuestionBoundaryDetector,
    private readonly semantic: SemanticQuestionBoundaryProvider,
    private readonly pause: QuestionBoundaryPauseConfig,
    private readonly createId: () => string = () => crypto.randomUUID(),
    private readonly now: () => number = () => Date.now(),
  ) {}

  async evaluate(
    candidate: QuestionCandidate,
    options: HybridBoundaryEvaluationOptions = {},
  ): Promise<BoundaryDecision> {
    const prior = this.active.get(candidate.id);
    if (prior && prior.revision !== candidate.revision)
      prior.controller.abort();

    const deterministic = this.deterministic.detect(candidate);
    const immediate = this.immediateDecision(candidate, deterministic, options);
    if (immediate) return immediate;

    const semanticKey = this.semanticKey(candidate);
    const cached = this.semanticCache.get(semanticKey);
    if (cached) return cached;

    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });
    this.active.set(candidate.id, {
      revision: candidate.revision,
      controller,
    });
    try {
      const semantic = semanticBoundaryDecisionSchema.parse(
        await this.semantic.decide(
          {
            text: candidate.text,
            languageHint: deterministic.languageHint,
            deterministicSignals: deterministic.signals,
            pauseAfterMs: candidate.pauseAfterMs,
            candidateRevision: candidate.revision,
          },
          controller.signal,
        ),
      );
      const current = this.active.get(candidate.id);
      if (
        controller.signal.aborted ||
        !current ||
        current.revision !== candidate.revision ||
        current.controller !== controller
      )
        return this.decision(candidate, options, {
          status: "superseded",
          shouldFinalize: false,
          confidence: 1,
          reasonCode: "stale_revision",
          decidedBy: "hybrid",
          semanticProviderUsed: true,
        });
      const decision = this.decision(candidate, options, {
        status: semantic.complete ? "finalized" : "waiting",
        shouldFinalize: semantic.complete,
        confidence: semantic.confidence,
        reasonCode: semantic.reasonCode,
        decidedBy: "semantic",
        semanticProviderUsed: true,
      });
      this.semanticCache.set(semanticKey, decision);
      return decision;
    } catch {
      if (controller.signal.aborted)
        return this.decision(candidate, options, {
          status: "superseded",
          shouldFinalize: false,
          confidence: 1,
          reasonCode: "stale_revision",
          decidedBy: "hybrid",
          semanticProviderUsed: true,
        });
      const nearLongPause =
        candidate.pauseAfterMs >= Math.floor(this.pause.longPauseMs * 0.9) &&
        deterministic.validContent;
      const decision = this.decision(candidate, options, {
        status: nearLongPause ? "finalized" : "waiting",
        shouldFinalize: nearLongPause,
        confidence: nearLongPause ? 0.65 : 0.35,
        reasonCode: nearLongPause
          ? "semantic_failed_fallback_finalize"
          : "semantic_failed_fallback_wait",
        decidedBy: "hybrid",
        semanticProviderUsed: true,
      });
      this.semanticCache.set(semanticKey, decision);
      return decision;
    } finally {
      options.signal?.removeEventListener("abort", abortFromCaller);
      const current = this.active.get(candidate.id);
      if (current?.controller === controller) this.active.delete(candidate.id);
    }
  }

  dispose() {
    for (const request of this.active.values()) request.controller.abort();
    this.active.clear();
    this.semanticCache.clear();
  }

  private immediateDecision(
    candidate: QuestionCandidate,
    deterministic: DeterministicBoundaryResult,
    options: HybridBoundaryEvaluationOptions,
  ) {
    if (candidate.pauseAfterMs < this.pause.shortPauseMs)
      return this.decision(candidate, options, {
        status: "waiting",
        shouldFinalize: false,
        confidence: 1,
        reasonCode: "short_pause",
        decidedBy: "deterministic",
        semanticProviderUsed: false,
      });

    if (candidate.pauseAfterMs >= this.pause.longPauseMs) {
      const finalize = deterministic.validContent;
      return this.decision(candidate, options, {
        status: finalize ? "finalized" : "rejected",
        shouldFinalize: finalize,
        confidence: finalize ? 0.95 : deterministic.confidence,
        reasonCode: finalize ? "long_pause_forced" : "deterministic_incomplete",
        decidedBy: "hybrid",
        semanticProviderUsed: false,
      });
    }

    if (deterministic.classification === "complete")
      return this.decision(candidate, options, {
        status: "finalized",
        shouldFinalize: true,
        confidence: deterministic.confidence,
        reasonCode: "deterministic_complete",
        decidedBy: "deterministic",
        semanticProviderUsed: false,
      });

    if (candidate.pauseAfterMs < this.pause.mediumPauseMs)
      return this.decision(candidate, options, {
        status: "waiting",
        shouldFinalize: false,
        confidence: deterministic.confidence,
        reasonCode: "deterministic_incomplete",
        decidedBy: "deterministic",
        semanticProviderUsed: false,
      });

    if (
      deterministic.classification === "incomplete" ||
      deterministic.classification === "invalid"
    )
      return this.decision(candidate, options, {
        status:
          deterministic.classification === "invalid" ? "rejected" : "waiting",
        shouldFinalize: false,
        confidence: deterministic.confidence,
        reasonCode: "deterministic_incomplete",
        decidedBy: "deterministic",
        semanticProviderUsed: false,
      });

    return null;
  }

  private decision(
    candidate: QuestionCandidate,
    options: HybridBoundaryEvaluationOptions,
    input: Readonly<{
      status: BoundaryDecisionStatus;
      shouldFinalize: boolean;
      confidence: number;
      reasonCode: BoundaryDecisionReasonCode;
      decidedBy: BoundaryDecisionSource;
      semanticProviderUsed: boolean;
    }>,
  ) {
    return immutableDecision({
      id: this.createId(),
      analysisSessionId: candidate.analysisSessionId,
      candidateId: candidate.id,
      candidateRevision: candidate.revision,
      ...input,
      actionId: options.actionId ?? null,
      createdAt: this.now(),
    });
  }

  private semanticKey(candidate: QuestionCandidate) {
    return `${candidate.id}:${candidate.revision}`;
  }
}
