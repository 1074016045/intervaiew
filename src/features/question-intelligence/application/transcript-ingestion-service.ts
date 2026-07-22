import { ZodError } from "zod";
import { QuestionIntelligenceError } from "../domain/question-intelligence-error";
import { transcriptChunkSchema } from "../domain/transcript";
import type { AnalysisRepositoryPort } from "./analysis-repository.port";

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
}
