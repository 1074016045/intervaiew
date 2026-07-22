export type QuestionIntelligenceErrorCode =
  | "ANALYSIS_SESSION_NOT_FOUND"
  | "ANALYSIS_SESSION_STATE_INVALID"
  | "TRANSCRIPT_SEGMENT_INVALID"
  | "TRANSCRIPT_SEGMENT_NOT_FINAL"
  | "TRANSCRIPT_SEGMENT_DUPLICATE"
  | "TRANSCRIPT_SEGMENT_SEQUENCE_CONFLICT";

export class QuestionIntelligenceError extends Error {
  constructor(
    public readonly code: QuestionIntelligenceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "QuestionIntelligenceError";
  }
}
