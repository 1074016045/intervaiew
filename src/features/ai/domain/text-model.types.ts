import type { AiProviderName } from "./ai-provider-name";

export interface TextModelRequest {
  systemPrompt: string;
  userPrompt: string;
  responseFormat: "text" | "json";
  timeoutMs?: number;
}

export interface TextModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface TextModelResponse {
  content: string;
  provider: AiProviderName;
  model: string;
  requestId?: string;
  usage?: TextModelUsage;
}
