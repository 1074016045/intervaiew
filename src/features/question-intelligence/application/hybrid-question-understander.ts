import { questionUnderstandingAnalysisSchema, type QuestionUnderstandingAnalysis } from "../domain/question-understanding";
import type { QuestionUnderstandingProviderPort } from "./question-understanding-provider.port";
import { DeterministicQuestionUnderstander } from "./deterministic-question-understander";

export class HybridQuestionUnderstander {
  constructor(private readonly deterministic: DeterministicQuestionUnderstander, private readonly semantic: QuestionUnderstandingProviderPort | null, private readonly confidenceThreshold = .88) {}

  async analyze(text: string, signal?: AbortSignal): Promise<QuestionUnderstandingAnalysis> {
    const deterministic = this.deterministic.analyze(text);
    const analysis = questionUnderstandingAnalysisSchema.parse({
      language: deterministic.language, questionFamily: deterministic.questionFamily,
      expectedAnswerMode: deterministic.expectedAnswerMode, requestedDimensions: deterministic.requestedDimensions,
      explicitConstraints: deterministic.explicitConstraints, focusTerms: deterministic.focusTerms,
      requiresClarification: deterministic.requiresClarification, clarificationReasons: deterministic.clarificationReasons,
      confidence: deterministic.confidence, decidedBy: deterministic.decidedBy,
      semanticProviderUsed: deterministic.semanticProviderUsed, status: deterministic.status,
    });
    if ((!deterministic.ambiguous && deterministic.confidence >= this.confidenceThreshold) || !this.semantic)
      return questionUnderstandingAnalysisSchema.parse(analysis);
    try {
      const semantic = await this.semantic.analyze({ text, deterministic: analysis }, signal);
      return questionUnderstandingAnalysisSchema.parse({ ...semantic, decidedBy: "fake_semantic", semanticProviderUsed: true, status: "completed" });
    } catch {
      return questionUnderstandingAnalysisSchema.parse({ ...analysis, decidedBy: "hybrid", semanticProviderUsed: true, confidence: Math.min(deterministic.confidence, .65), status: "completed" });
    }
  }
}
