import { semanticUnderstandingOutputSchema, type QuestionUnderstandingProviderPort, type SemanticUnderstandingInput } from "../../application/question-understanding-provider.port";

export class FakeQuestionUnderstandingProvider implements QuestionUnderstandingProviderPort {
  readonly name = "fake" as const;
  private calls = 0;
  constructor(private readonly options: Readonly<{ fail?: boolean }> = {}) {}
  get callCount() { return this.calls; }
  async analyze(input: SemanticUnderstandingInput, signal?: AbortSignal) {
    this.calls += 1;
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (this.options.fail || /\[fake-fail\]/iu.test(input.text)) throw new Error("FAKE_UNDERSTANDING_FAILURE");
    const reasons = input.deterministic.requiresClarification
        ? input.deterministic.clarificationReasons.filter((reason) => reason !== "none")
        : ["none" as const];
    return Object.freeze(semanticUnderstandingOutputSchema.parse({
      language: input.deterministic.language,
      questionFamily: input.deterministic.questionFamily,
      expectedAnswerMode: input.deterministic.expectedAnswerMode,
      requestedDimensions: input.deterministic.requestedDimensions,
      explicitConstraints: input.deterministic.explicitConstraints,
      focusTerms: input.deterministic.focusTerms,
      clarificationReasons: reasons,
      requiresClarification: reasons[0] !== "none",
      confidence: Math.max(.72, input.deterministic.confidence),
    }));
  }
}
