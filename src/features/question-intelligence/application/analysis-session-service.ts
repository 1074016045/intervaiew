import {
  createAnalysisSessionSchema,
  updateAnalysisSessionStatusSchema,
} from "../domain/analysis-session";
import { QuestionIntelligenceError } from "../domain/question-intelligence-error";
import type { AnalysisRepositoryPort } from "./analysis-repository.port";

export class AnalysisSessionService {
  constructor(private readonly repository: AnalysisRepositoryPort) {}

  create(input: unknown) {
    return this.repository.createSession(
      createAnalysisSessionSchema.parse(input),
    );
  }

  get(id: string) {
    const detail = this.repository.getSession(id);
    if (!detail)
      throw new QuestionIntelligenceError(
        "ANALYSIS_SESSION_NOT_FOUND",
        "The analysis session could not be found.",
      );
    return detail;
  }

  delete(id: string) {
    return this.repository.deleteSession(id);
  }

  updateStatus(id: string, input: unknown) {
    const { status } = updateAnalysisSessionStatusSchema.parse(input);
    const result = this.repository.updateSessionStatus(id, status);
    if (result.kind === "session-not-found")
      throw new QuestionIntelligenceError(
        "ANALYSIS_SESSION_NOT_FOUND",
        "The analysis session could not be found.",
      );
    if (result.kind === "session-state-invalid")
      throw new QuestionIntelligenceError(
        "ANALYSIS_SESSION_STATE_INVALID",
        "The analysis session cannot enter that state.",
      );
    return result.session;
  }
}
