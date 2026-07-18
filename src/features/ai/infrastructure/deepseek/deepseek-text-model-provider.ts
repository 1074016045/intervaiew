import type OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions/completions";
import { AiError } from "../../domain/ai-errors";
import type { TextModelProvider } from "../../domain/text-model.port";
import type {
  TextModelRequest,
  TextModelResponse,
} from "../../domain/text-model.types";
import { withRetry } from "../../application/retry-policy";
import { mapDeepSeekError } from "./deepseek-error-mapper";

type DeepSeekRequest = ChatCompletionCreateParamsNonStreaming & {
  thinking: { type: "disabled" };
};

export class DeepSeekTextModelProvider implements TextModelProvider {
  readonly name = "deepseek" as const;
  constructor(
    private readonly client: Pick<OpenAI, "chat">,
    private readonly model: string,
    private readonly timeoutMs: number,
    private readonly maxRetries: number,
  ) {}

  async generate(request: TextModelRequest): Promise<TextModelResponse> {
    return withRetry(async () => {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        request.timeoutMs ?? this.timeoutMs,
      );
      const body: DeepSeekRequest = {
        model: this.model,
        messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: request.userPrompt },
        ],
        stream: false,
        ...(request.responseFormat === "json"
          ? { response_format: { type: "json_object" as const } }
          : {}),
        thinking: { type: "disabled" },
      };
      try {
        // `thinking` is a DeepSeek-only OpenAI-compatible extension; the local
        // intersection above preserves precise SDK typing for the extension.
        const response = await this.client.chat.completions.create(body, {
          signal: controller.signal,
          maxRetries: 0,
        });
        const choice = response.choices[0];
        if (choice?.finish_reason === "length")
          throw new AiError(
            "AI_INVALID_RESPONSE",
            "The AI response was truncated.",
          );
        const content = choice?.message.content?.trim();
        if (!content)
          throw new AiError(
            "AI_INVALID_RESPONSE",
            "The AI provider returned no content.",
          );
        return {
          content,
          provider: this.name,
          model: this.model,
          requestId: response.id,
          usage: response.usage
            ? {
                inputTokens: response.usage.prompt_tokens,
                outputTokens: response.usage.completion_tokens,
                totalTokens: response.usage.total_tokens,
              }
            : undefined,
        };
      } catch (error) {
        throw mapDeepSeekError(error);
      } finally {
        clearTimeout(timer);
      }
    }, this.maxRetries);
  }
}
