import type OpenAI from "openai";
import type { TextModelProvider } from "../../domain/text-model.port";
import type {
  TextModelRequest,
  TextModelResponse,
} from "../../domain/text-model.types";
import { AiError } from "../../domain/ai-errors";
import { withRetry } from "../../application/retry-policy";
import { mapOpenAIError } from "./openai-error-mapper";

export class OpenAITextModelProvider implements TextModelProvider {
  readonly name = "openai" as const;
  constructor(
    private readonly client: Pick<OpenAI, "responses">,
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
      try {
        const response = await this.client.responses.create(
          {
            model: this.model,
            input: [
              { role: "system", content: request.systemPrompt },
              { role: "user", content: request.userPrompt },
            ],
            ...(request.responseFormat === "json"
              ? { text: { format: { type: "json_object" as const } } }
              : {}),
          },
          { signal: controller.signal, maxRetries: 0 },
        );
        const content = response.output_text?.trim();
        if (response.status === "incomplete")
          throw new AiError(
            "AI_INVALID_RESPONSE",
            "The AI response was incomplete.",
          );
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
                inputTokens: response.usage.input_tokens,
                outputTokens: response.usage.output_tokens,
                totalTokens: response.usage.total_tokens,
              }
            : undefined,
        };
      } catch (error) {
        throw mapOpenAIError(error);
      } finally {
        clearTimeout(timer);
      }
    }, this.maxRetries);
  }
}
