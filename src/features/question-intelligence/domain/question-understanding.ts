import { z } from "zod";

export const understandingLanguages = ["en", "zh", "mixed", "unknown"] as const;
export const questionFamilies = [
  "behavioral", "project_experience", "technical_concept", "coding",
  "quantitative", "system_design", "situational", "motivation", "role_fit",
  "collaboration", "leadership", "clarification", "other",
] as const;
export const expectedAnswerModes = [
  "narrative", "explanation", "design", "calculation", "code", "comparison",
  "concise_fact", "mixed",
] as const;
export const requestedDimensionVocabulary = [
  "context", "goal", "challenge", "responsibility", "actions", "reasoning",
  "implementation", "technical_details", "assumptions", "constraints",
  "tradeoffs", "alternatives", "collaboration", "leadership", "conflict",
  "failure", "recovery", "outcome", "impact", "metrics", "lessons",
  "complexity", "edge_cases", "testing", "scalability", "reliability",
  "security", "clarification",
] as const;
export const understandingConstraintKinds = [
  "time_limit", "count", "technology", "role", "scope", "comparison",
  "format", "other",
] as const;
export const clarificationReasonVocabulary = [
  "ambiguous_subject", "missing_scope", "missing_constraints",
  "multiple_questions", "incomplete_question", "unclear_reference", "none",
] as const;
export const understandingDecisionSources = [
  "deterministic", "fake_semantic", "hybrid",
] as const;
export const understandingStatuses = ["completed", "failed", "superseded"] as const;

const boundedId = z.string().trim().min(1).max(200);
const boundedSource = z.string().min(1).max(240);
const sequence = z.number().int().positive();

export const understandingConstraintSchema = z.object({
  kind: z.enum(understandingConstraintKinds),
  value: z.string().trim().min(1).max(160),
  sourceText: boundedSource,
  sequence,
}).strict();

export const understandingFocusTermSchema = z.object({
  normalized: z.string().trim().min(1).max(80),
  sourceText: boundedSource,
  sequence,
}).strict();

const orderedUnique = <T>(values: ReadonlyArray<T>) =>
  new Set(values).size === values.length;
const sequential = (values: ReadonlyArray<{ sequence: number }>) =>
  values.every((value, index) => value.sequence === index + 1);

export const questionUnderstandingAnalysisSchema = z.object({
  language: z.enum(understandingLanguages),
  questionFamily: z.enum(questionFamilies),
  expectedAnswerMode: z.enum(expectedAnswerModes),
  requestedDimensions: z.array(z.enum(requestedDimensionVocabulary)).max(16),
  explicitConstraints: z.array(understandingConstraintSchema).max(12),
  focusTerms: z.array(understandingFocusTermSchema).max(12),
  requiresClarification: z.boolean(),
  clarificationReasons: z.array(z.enum(clarificationReasonVocabulary)).min(1).max(6),
  confidence: z.number().finite().min(0).max(1),
  decidedBy: z.enum(understandingDecisionSources),
  semanticProviderUsed: z.boolean(),
  status: z.enum(understandingStatuses),
}).strict().superRefine((value, context) => {
  if (!orderedUnique(value.requestedDimensions)) context.addIssue({ code: "custom", path: ["requestedDimensions"], message: "Dimensions must be unique." });
  if (!orderedUnique(value.clarificationReasons)) context.addIssue({ code: "custom", path: ["clarificationReasons"], message: "Clarification reasons must be unique." });
  if (!sequential(value.explicitConstraints)) context.addIssue({ code: "custom", path: ["explicitConstraints"], message: "Constraint sequences must be contiguous." });
  if (!sequential(value.focusTerms)) context.addIssue({ code: "custom", path: ["focusTerms"], message: "Focus-term sequences must be contiguous." });
  const constraintKeys = value.explicitConstraints.map((item) => `${item.kind}:${item.value.toLocaleLowerCase()}`);
  if (!orderedUnique(constraintKeys)) context.addIssue({ code: "custom", path: ["explicitConstraints"], message: "Constraints must be deduplicated." });
  const focusKeys = value.focusTerms.map((item) => item.normalized.toLocaleLowerCase());
  if (!orderedUnique(focusKeys)) context.addIssue({ code: "custom", path: ["focusTerms"], message: "Focus terms must be deduplicated." });
  if (!value.requiresClarification && (value.clarificationReasons.length !== 1 || value.clarificationReasons[0] !== "none"))
    context.addIssue({ code: "custom", path: ["clarificationReasons"], message: 'Non-clarifying results require exactly ["none"].' });
  if (value.requiresClarification && value.clarificationReasons.includes("none"))
    context.addIssue({ code: "custom", path: ["clarificationReasons"], message: 'Clarifying results cannot include "none".' });
  if (value.semanticProviderUsed !== (value.decidedBy !== "deterministic"))
    context.addIssue({ code: "custom", path: ["semanticProviderUsed"], message: "Semantic provider use must match the decision source." });
});

export const questionUnderstandingSchema = questionUnderstandingAnalysisSchema.extend({
  id: boundedId,
  analysisSessionId: boundedId,
  finalizedQuestionId: boundedId,
  finalizedQuestionRevision: z.number().int().positive(),
  sourceBoundaryDecisionId: boundedId,
  understandingRevision: z.number().int().positive(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}).strict();

export type QuestionUnderstandingAnalysis = Readonly<z.infer<typeof questionUnderstandingAnalysisSchema>>;
type ParsedQuestionUnderstanding = z.infer<typeof questionUnderstandingSchema>;
export type QuestionUnderstanding = Readonly<
  Omit<ParsedQuestionUnderstanding, "requestedDimensions" | "explicitConstraints" | "focusTerms" | "clarificationReasons"> & {
    requestedDimensions: ReadonlyArray<ParsedQuestionUnderstanding["requestedDimensions"][number]>;
    explicitConstraints: ReadonlyArray<Readonly<ParsedQuestionUnderstanding["explicitConstraints"][number]>>;
    focusTerms: ReadonlyArray<Readonly<ParsedQuestionUnderstanding["focusTerms"][number]>>;
    clarificationReasons: ReadonlyArray<ParsedQuestionUnderstanding["clarificationReasons"][number]>;
  }
>;
export type QuestionFamily = (typeof questionFamilies)[number];
export type ExpectedAnswerMode = (typeof expectedAnswerModes)[number];
export type RequestedDimension = (typeof requestedDimensionVocabulary)[number];
export type ClarificationReason = (typeof clarificationReasonVocabulary)[number];

export function validateUnderstandingTraceability(source: string, input: Readonly<{
  explicitConstraints: ReadonlyArray<Readonly<{ sourceText: string }>>;
  focusTerms: ReadonlyArray<Readonly<{ sourceText: string }>>;
}>) {
  for (const item of [...input.explicitConstraints, ...input.focusTerms])
    if (!source.includes(item.sourceText)) throw new Error("QUESTION_UNDERSTANDING_SOURCE_MISMATCH");
}

export function immutableUnderstanding(input: unknown): QuestionUnderstanding {
  const parsed = questionUnderstandingSchema.parse(input);
  return Object.freeze({
    ...parsed,
    requestedDimensions: Object.freeze([...parsed.requestedDimensions]),
    explicitConstraints: Object.freeze(parsed.explicitConstraints.map((item) => Object.freeze(item))),
    focusTerms: Object.freeze(parsed.focusTerms.map((item) => Object.freeze(item))),
    clarificationReasons: Object.freeze([...parsed.clarificationReasons]),
  });
}
