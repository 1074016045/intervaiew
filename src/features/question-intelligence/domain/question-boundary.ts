import { z } from "zod";

const epochMillisecondsSchema = z.number().int().nonnegative();

export const questionCandidateStatuses = [
  "active",
  "finalized",
  "superseded",
] as const;
export type QuestionCandidateStatus =
  (typeof questionCandidateStatuses)[number];

export const questionCandidateSchema = z
  .object({
    id: z.string().trim().min(1),
    analysisSessionId: z.string().trim().min(1),
    revision: z.number().int().positive(),
    text: z.string().trim().min(1),
    segmentIds: z.array(z.string().trim().min(1)).min(1),
    firstSequence: z.number().int().nonnegative(),
    lastSequence: z.number().int().nonnegative(),
    speakerRole: z.literal("interviewer"),
    startedAtMs: z.number().finite().nonnegative(),
    endedAtMs: z.number().finite().nonnegative(),
    pauseAfterMs: z.number().int().nonnegative(),
    status: z.enum(questionCandidateStatuses).default("active"),
    createdAt: epochMillisecondsSchema,
    updatedAt: epochMillisecondsSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.segmentIds).size !== value.segmentIds.length)
      context.addIssue({
        code: "custom",
        message: "segmentIds must be unique.",
        path: ["segmentIds"],
      });
    if (value.lastSequence < value.firstSequence)
      context.addIssue({
        code: "custom",
        message: "lastSequence must be greater than or equal to firstSequence.",
        path: ["lastSequence"],
      });
    if (value.endedAtMs < value.startedAtMs)
      context.addIssue({
        code: "custom",
        message: "endedAtMs must be greater than or equal to startedAtMs.",
        path: ["endedAtMs"],
      });
  });

export type QuestionCandidate = Readonly<
  Omit<z.infer<typeof questionCandidateSchema>, "segmentIds"> & {
    segmentIds: ReadonlyArray<string>;
  }
>;

export const boundaryDecisionStatuses = [
  "pending",
  "finalized",
  "waiting",
  "rejected",
  "superseded",
  "failed",
] as const;
export type BoundaryDecisionStatus = (typeof boundaryDecisionStatuses)[number];

export const boundaryDecisionReasonCodes = [
  "deterministic_complete",
  "deterministic_incomplete",
  "short_pause",
  "medium_pause_semantic_complete",
  "medium_pause_semantic_incomplete",
  "long_pause_forced",
  "manual_force_finalize",
  "manual_merge_previous",
  "manual_undo",
  "stale_revision",
  "semantic_failed_fallback_wait",
  "semantic_failed_fallback_finalize",
] as const;
export type BoundaryDecisionReasonCode =
  (typeof boundaryDecisionReasonCodes)[number];

export const boundaryDecisionSources = [
  "deterministic",
  "semantic",
  "hybrid",
  "manual",
] as const;
export type BoundaryDecisionSource = (typeof boundaryDecisionSources)[number];

export const boundaryDecisionSchema = z
  .object({
    id: z.string().trim().min(1),
    analysisSessionId: z.string().trim().min(1),
    candidateId: z.string().trim().min(1),
    candidateRevision: z.number().int().positive(),
    status: z.enum(boundaryDecisionStatuses),
    shouldFinalize: z.boolean(),
    confidence: z.number().finite().min(0).max(1),
    reasonCode: z.enum(boundaryDecisionReasonCodes),
    decidedBy: z.enum(boundaryDecisionSources),
    semanticProviderUsed: z.boolean(),
    actionId: z.string().trim().min(1).nullable().default(null),
    createdAt: epochMillisecondsSchema,
  })
  .strict();

export type BoundaryDecision = Readonly<z.infer<typeof boundaryDecisionSchema>>;

export const finalizedQuestionSchema = z
  .object({
    id: z.string().trim().min(1),
    analysisSessionId: z.string().trim().min(1),
    text: z.string().trim().min(1),
    sourceSegmentIds: z.array(z.string().trim().min(1)).min(1),
    firstSequence: z.number().int().nonnegative(),
    lastSequence: z.number().int().nonnegative(),
    boundaryDecisionId: z.string().trim().min(1),
    revision: z.number().int().positive(),
    finalizedAt: epochMillisecondsSchema,
    undoneAt: epochMillisecondsSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.sourceSegmentIds).size !== value.sourceSegmentIds.length)
      context.addIssue({
        code: "custom",
        message: "sourceSegmentIds must be unique.",
        path: ["sourceSegmentIds"],
      });
    if (value.lastSequence < value.firstSequence)
      context.addIssue({
        code: "custom",
        message: "lastSequence must be greater than or equal to firstSequence.",
        path: ["lastSequence"],
      });
  });

export type FinalizedQuestion = Readonly<
  Omit<z.infer<typeof finalizedQuestionSchema>, "sourceSegmentIds"> & {
    sourceSegmentIds: ReadonlyArray<string>;
  }
>;

export const boundarySignalKinds = [
  "complete",
  "incomplete",
  "invalid",
] as const;
export type BoundarySignalKind = (typeof boundarySignalKinds)[number];

export type BoundarySignal = Readonly<{
  code: string;
  kind: BoundarySignalKind;
  confidence: number;
}>;

export type DeterministicBoundaryResult = Readonly<{
  classification: "complete" | "incomplete" | "gray" | "invalid";
  confidence: number;
  validContent: boolean;
  languageHint: "en" | "zh" | "mixed" | "unknown";
  signals: ReadonlyArray<BoundarySignal>;
}>;

export const questionBoundaryPauseConfigSchema = z
  .object({
    shortPauseMs: z.number().int().positive(),
    mediumPauseMs: z.number().int().positive(),
    longPauseMs: z.number().int().positive(),
  })
  .strict()
  .refine(
    (value) =>
      value.shortPauseMs < value.mediumPauseMs &&
      value.mediumPauseMs < value.longPauseMs,
    { message: "Pause thresholds must satisfy short < medium < long." },
  );

export type QuestionBoundaryPauseConfig = Readonly<
  z.infer<typeof questionBoundaryPauseConfigSchema>
>;

export function immutableCandidate(input: unknown): QuestionCandidate {
  const candidate = questionCandidateSchema.parse(input);
  return Object.freeze({
    ...candidate,
    segmentIds: Object.freeze([...candidate.segmentIds]),
  });
}

export function immutableDecision(input: unknown): BoundaryDecision {
  return Object.freeze(boundaryDecisionSchema.parse(input));
}

export function immutableFinalizedQuestion(input: unknown): FinalizedQuestion {
  const question = finalizedQuestionSchema.parse(input);
  return Object.freeze({
    ...question,
    sourceSegmentIds: Object.freeze([...question.sourceSegmentIds]),
  });
}
