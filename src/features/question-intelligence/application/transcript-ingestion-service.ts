import { ZodError } from "zod";
import { QuestionIntelligenceError } from "../domain/question-intelligence-error";
import { transcriptChunkSchema } from "../domain/transcript";
import type { AnalysisRepositoryPort } from "./analysis-repository.port";
import { z } from "zod";

const uploadedFinalsSchema = z
  .object({
    assetId: z.string().uuid(),
    actionId: z.string().uuid(),
    jobId: z.string().uuid(),
    leaseToken: z.string().min(1).max(200),
    providerLabel: z.string().trim().min(1).max(80),
    speakerRole: z.enum(["interviewer", "candidate"]),
    chunks: z
      .array(
        z
          .object({
            text: z.string().trim().min(1).max(20_000),
            startMs: z.number().int().nonnegative(),
            endMs: z.number().int().nonnegative(),
          })
          .strict()
          .refine((value) => value.endMs >= value.startMs, {
            path: ["endMs"],
            message: "Invalid transcript timing.",
          }),
      )
      .min(1)
      .max(50),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();

export class TranscriptIngestionService {
  constructor(private readonly repository: AnalysisRepositoryPort) {}

  ingest(sessionId: string, input: unknown) {
    let chunk;
    try {
      chunk = transcriptChunkSchema.parse(input);
    } catch (error) {
      if (error instanceof ZodError)
        throw new QuestionIntelligenceError(
          "TRANSCRIPT_SEGMENT_INVALID",
          "The transcript segment was invalid.",
        );
      throw error;
    }
    if (!chunk.isFinal)
      throw new QuestionIntelligenceError(
        "TRANSCRIPT_SEGMENT_NOT_FINAL",
        "Only finalized transcript segments can be persisted.",
      );
    if (chunk.sourceSessionId !== sessionId)
      throw new QuestionIntelligenceError(
        "TRANSCRIPT_SEGMENT_INVALID",
        "The transcript segment was invalid.",
      );
    const result = this.repository.ingestFinalChunk(sessionId, chunk);
    if (result.kind === "session-not-found")
      throw new QuestionIntelligenceError(
        "ANALYSIS_SESSION_NOT_FOUND",
        "The analysis session could not be found.",
      );
    if (result.kind === "session-state-invalid")
      throw new QuestionIntelligenceError(
        "ANALYSIS_SESSION_STATE_INVALID",
        "The analysis session does not accept transcript segments.",
      );
    if (result.kind === "sequence-conflict")
      throw new QuestionIntelligenceError(
        "TRANSCRIPT_SEGMENT_SEQUENCE_CONFLICT",
        "That transcript sequence is already assigned to another segment.",
      );
    return {
      segment: result.segment,
      duplicated: result.kind === "duplicate",
    } as const;
  }

  ingestUploadedAudio(sessionId: string, input: unknown) {
    let parsed;
    try {
      parsed = uploadedFinalsSchema.parse(input);
    } catch (error) {
      if (error instanceof ZodError)
        throw new QuestionIntelligenceError(
          "TRANSCRIPT_SEGMENT_INVALID",
          "The uploaded-audio transcript was invalid.",
        );
      throw error;
    }
    const result = this.repository.ingestUploadedFinals({
      sessionId,
      ...parsed,
    });
    if (result.kind === "session-not-found")
      throw new QuestionIntelligenceError(
        "ANALYSIS_SESSION_NOT_FOUND",
        "The analysis session could not be found.",
      );
    if (result.kind === "session-state-invalid")
      throw new QuestionIntelligenceError(
        "ANALYSIS_SESSION_STATE_INVALID",
        "The analysis session does not accept transcript segments.",
      );
    if (
      result.kind === "asset-not-found" ||
      result.kind === "asset-state-invalid" ||
      result.kind === "action-invalid" ||
      result.kind === "job-invalid"
    )
      throw new QuestionIntelligenceError(
        "TRANSCRIPT_SEGMENT_INVALID",
        "The uploaded-audio source was invalid.",
      );
    return result;
  }
}
