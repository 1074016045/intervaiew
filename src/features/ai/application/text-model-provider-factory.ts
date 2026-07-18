import "server-only";
import { AiError } from "../domain/ai-errors";
import type { TextModelProvider } from "../domain/text-model.port";
import type { ServerEnv } from "@/infrastructure/env/server-env";
import { MockTextModelProvider } from "../infrastructure/mock/mock-text-model-provider";
import { createDeepSeekClient } from "../infrastructure/deepseek/deepseek-client";
import { DeepSeekTextModelProvider } from "../infrastructure/deepseek/deepseek-text-model-provider";
import { createOpenAIClient } from "../infrastructure/openai/openai-client";
import { OpenAITextModelProvider } from "../infrastructure/openai/openai-text-model-provider";

export function createTextModelProvider(env: ServerEnv): TextModelProvider {
  switch (env.AI_PROVIDER) {
    case "mock":
      return new MockTextModelProvider();
    case "deepseek":
      if (!env.DEEPSEEK_API_KEY)
        throw new AiError(
          "AI_CONFIGURATION_ERROR",
          "DEEPSEEK_API_KEY is required for the configured provider.",
        );
      return new DeepSeekTextModelProvider(
        createDeepSeekClient(env.DEEPSEEK_API_KEY, env.DEEPSEEK_BASE_URL),
        env.DEEPSEEK_TEXT_MODEL,
        env.AI_REQUEST_TIMEOUT_MS,
        env.AI_MAX_RETRIES,
      );
    case "openai":
      if (!env.OPENAI_API_KEY || !env.OPENAI_TEXT_MODEL)
        throw new AiError(
          "AI_CONFIGURATION_ERROR",
          "OPENAI_API_KEY and OPENAI_TEXT_MODEL are required for the configured provider.",
        );
      return new OpenAITextModelProvider(
        createOpenAIClient(env.OPENAI_API_KEY),
        env.OPENAI_TEXT_MODEL,
        env.AI_REQUEST_TIMEOUT_MS,
        env.AI_MAX_RETRIES,
      );
    default:
      throw new AiError(
        "AI_CONFIGURATION_ERROR",
        `Unknown AI provider: ${env.AI_PROVIDER}.`,
      );
  }
}
