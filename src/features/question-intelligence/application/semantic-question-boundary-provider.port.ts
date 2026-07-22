import { z } from "zod";
import type {
  BoundarySignal,
  DeterministicBoundaryResult,
} from "../domain/question-boundary";

export const semanticBoundaryReasonCodes = [
  "medium_pause_semantic_complete",
  "medium_pause_semantic_incomplete",
] as const;

export const semanticBoundaryDecisionSchema = z
  .object({
    complete: z.boolean(),
    confidence: z.number().finite().min(0).max(1),
    reasonCode: z.enum(semanticBoundaryReasonCodes),
    normalizedQuestion: z.string().trim().min(1).max(20_000).nullable(),
  })
  .strict();

export type SemanticBoundaryDecision = Readonly<
  z.infer<typeof semanticBoundaryDecisionSchema>
>;

export type SemanticBoundaryInput = Readonly<{
  text: string;
  languageHint: DeterministicBoundaryResult["languageHint"];
  deterministicSignals: ReadonlyArray<BoundarySignal>;
  pauseAfterMs: number;
  candidateRevision: number;
}>;

export interface SemanticQuestionBoundaryProvider {
  readonly name: string;
  decide(
    input: SemanticBoundaryInput,
    signal: AbortSignal,
  ): Promise<SemanticBoundaryDecision>;
}
