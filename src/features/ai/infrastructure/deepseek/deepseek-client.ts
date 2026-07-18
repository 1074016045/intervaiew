import "server-only";
import OpenAI from "openai";

export function createDeepSeekClient(apiKey: string, baseURL: string): OpenAI {
  return new OpenAI({ apiKey, baseURL, maxRetries: 0 });
}
