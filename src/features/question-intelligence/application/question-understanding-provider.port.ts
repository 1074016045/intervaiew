import { z } from "zod";
import {
  clarificationReasonVocabulary,
  expectedAnswerModes,
  questionFamilies,
  questionUnderstandingAnalysisSchema,
  requestedDimensionVocabulary,
  understandingConstraintSchema,
  understandingFocusTermSchema,
  understandingLanguages,
} from "../domain/question-understanding";

export const semanticUnderstandingInputSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  deterministic: questionUnderstandingAnalysisSchema,
}).strict();

export const semanticUnderstandingOutputSchema = z.object({
  language: z.enum(understandingLanguages), questionFamily: z.enum(questionFamilies),
  expectedAnswerMode: z.enum(expectedAnswerModes),
  requestedDimensions: z.array(z.enum(requestedDimensionVocabulary)).max(16),
  explicitConstraints: z.array(understandingConstraintSchema).max(12),
  focusTerms: z.array(understandingFocusTermSchema).max(12), requiresClarification: z.boolean(),
  clarificationReasons: z.array(z.enum(clarificationReasonVocabulary)).min(1).max(6),
  confidence: z.number().finite().min(0).max(1),
}).strict();

export type SemanticUnderstandingInput = Readonly<z.infer<typeof semanticUnderstandingInputSchema>>;
export type SemanticUnderstandingOutput = Readonly<z.infer<typeof semanticUnderstandingOutputSchema>>;

export interface QuestionUnderstandingProviderPort {
  readonly name: "fake";
  analyze(input: SemanticUnderstandingInput, signal?: AbortSignal): Promise<SemanticUnderstandingOutput>;
}
