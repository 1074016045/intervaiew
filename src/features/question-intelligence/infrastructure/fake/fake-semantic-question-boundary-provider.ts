import {
  semanticBoundaryDecisionSchema,
  type SemanticBoundaryDecision,
  type SemanticBoundaryInput,
  type SemanticQuestionBoundaryProvider,
} from "../../application/semantic-question-boundary-provider.port";

export type FakeSemanticBoundaryOptions = Readonly<{
  delayMs?: number;
  fail?: boolean;
  decide?: (input: SemanticBoundaryInput) => SemanticBoundaryDecision;
}>;

export class FakeSemanticQuestionBoundaryProvider implements SemanticQuestionBoundaryProvider {
  readonly name = "fake";
  private calls = 0;

  constructor(private readonly options: FakeSemanticBoundaryOptions = {}) {}

  get callCount() {
    return this.calls;
  }

  async decide(
    input: SemanticBoundaryInput,
    signal: AbortSignal,
  ): Promise<SemanticBoundaryDecision> {
    this.calls += 1;
    await this.delay(this.options.delayMs ?? 0, signal);
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (this.options.fail) throw new Error("FAKE_SEMANTIC_FAILURE");
    const custom = this.options.decide?.(input);
    if (custom)
      return Object.freeze(semanticBoundaryDecisionSchema.parse(custom));

    const text = input.text.trim();
    const trailingConnector =
      /(?:\b(?:and|but|because|so|then|if)|(?:然后|以及|并且|但是|因为|所以|如果|比如|例如|还有|或者))\s*[,;:.!?，。！？；：…-]*$/iu.test(
        text,
      );
    const questionLike =
      /[?？]\s*$/u.test(text) ||
      /^(?:tell me|describe|explain|design|estimate|why|how|what|when|where|who|could you|can you|have you|do you|did you|would you)\b/iu.test(
        text,
      ) ||
      /(?:什么|为什么|怎么|如何|哪些|是否|能不能|介绍|描述|解释|举一个例子|谈谈|说说|讲一下|设计|估算)/u.test(
        text,
      );
    const complete = questionLike && !trailingConnector;
    return Object.freeze(
      semanticBoundaryDecisionSchema.parse({
        complete,
        confidence: complete ? 0.88 : 0.76,
        reasonCode: complete
          ? "medium_pause_semantic_complete"
          : "medium_pause_semantic_incomplete",
        normalizedQuestion: complete ? text : null,
      }),
    );
  }

  private delay(milliseconds: number, signal: AbortSignal) {
    if (milliseconds <= 0) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const finish = () => {
        signal.removeEventListener("abort", abort);
        resolve();
      };
      const timer = setTimeout(finish, milliseconds);
      const abort = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        reject(new DOMException("Aborted", "AbortError"));
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }
}
