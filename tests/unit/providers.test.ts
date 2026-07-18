import { describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";
import { serverEnvSchema } from "@/infrastructure/env/server-env";
import { createTextModelProvider } from "@/features/ai/application/text-model-provider-factory";
import { MockTextModelProvider } from "@/features/ai/infrastructure/mock/mock-text-model-provider";
import { DeepSeekTextModelProvider } from "@/features/ai/infrastructure/deepseek/deepseek-text-model-provider";
import { OpenAITextModelProvider } from "@/features/ai/infrastructure/openai/openai-text-model-provider";

const base = serverEnvSchema.parse({ AI_PROVIDER: "mock" });
describe("provider factory", () => {
  it("selects all configured providers", () => {
    expect(createTextModelProvider(base).name).toBe("mock");
    expect(
      createTextModelProvider({
        ...base,
        AI_PROVIDER: "deepseek",
        DEEPSEEK_API_KEY: "test",
      }).name,
    ).toBe("deepseek");
    expect(
      createTextModelProvider({
        ...base,
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "test",
        OPENAI_TEXT_MODEL: "configured-model",
      }).name,
    ).toBe("openai");
  });
  it("rejects unknown provider and missing configuration without fallback", () => {
    expect(() =>
      createTextModelProvider({ ...base, AI_PROVIDER: "unknown" }),
    ).toThrow(/Unknown/);
    expect(() =>
      createTextModelProvider({ ...base, AI_PROVIDER: "deepseek" }),
    ).toThrow(/DEEPSEEK_API_KEY/);
    expect(() =>
      createTextModelProvider({ ...base, AI_PROVIDER: "openai" }),
    ).toThrow(/OPENAI_API_KEY/);
  });
});
describe("mock provider", () => {
  it("is deterministic and returns the requested count", async () => {
    const provider = new MockTextModelProvider();
    const request = {
      systemPrompt: "system",
      userPrompt:
        '<settings_json>{"interviewType":"ai-agent-engineering","language":"Chinese","questionCount":5,"targetRole":"Engineer"}</settings_json>',
      responseFormat: "json" as const,
    };
    const first = await provider.generate(request);
    const second = await provider.generate(request);
    expect(first.content).toBe(second.content);
    expect(JSON.parse(first.content).questions).toHaveLength(5);
  });
});
describe("DeepSeek adapter", () => {
  it("sends configured model, JSON mode and thinking disabled without returning reasoning", async () => {
    let captured: unknown;
    const create = vi.fn(async (body: unknown) => {
      captured = body;
      return {
        id: "r1",
        choices: [
          {
            finish_reason: "stop",
            message: { content: '{"ok":true}', reasoning_content: "secret" },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      };
    });
    const client = { chat: { completions: { create } } } as unknown as Pick<
      OpenAI,
      "chat"
    >;
    const provider = new DeepSeekTextModelProvider(
      client,
      "deepseek-v4-flash",
      1000,
      0,
    );
    const result = await provider.generate({
      systemPrompt: "s",
      userPrompt: "u",
      responseFormat: "json",
    });
    expect(captured).toMatchObject({
      model: "deepseek-v4-flash",
      stream: false,
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
    });
    expect(result.content).toBe('{"ok":true}');
    expect(result).not.toHaveProperty("reasoning_content");
  });
  it.each([
    [401, "AI_AUTHENTICATION_ERROR", 1],
    [402, "AI_INSUFFICIENT_BALANCE", 1],
    [429, "AI_RATE_LIMITED", 3],
    [500, "AI_PROVIDER_UNAVAILABLE", 3],
    [503, "AI_PROVIDER_UNAVAILABLE", 3],
  ])("maps status %i with bounded retries", async (status, code, calls) => {
    const error = Object.assign(new Error("raw"), { status });
    const create = vi.fn(async () => {
      throw error;
    });
    const client = { chat: { completions: { create } } } as unknown as Pick<
      OpenAI,
      "chat"
    >;
    const provider = new DeepSeekTextModelProvider(
      client,
      "deepseek-v4-flash",
      1000,
      2,
    );
    await expect(
      provider.generate({
        systemPrompt: "s",
        userPrompt: "u",
        responseFormat: "json",
      }),
    ).rejects.toMatchObject({ code });
    expect(create).toHaveBeenCalledTimes(calls);
  });
  it("aborts a timed-out request", async () => {
    const create = vi.fn(
      async (_body: unknown, options: { signal?: AbortSignal | null }) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        }),
    );
    const client = { chat: { completions: { create } } } as unknown as Pick<
      OpenAI,
      "chat"
    >;
    const provider = new DeepSeekTextModelProvider(
      client,
      "deepseek-v4-flash",
      10,
      0,
    );
    await expect(
      provider.generate({
        systemPrompt: "s",
        userPrompt: "u",
        responseFormat: "json",
      }),
    ).rejects.toMatchObject({ code: "AI_TIMEOUT" });
  });
});

describe("OpenAI adapter", () => {
  it("uses the configured Responses model and returns output_text", async () => {
    let captured: unknown;
    const create = vi.fn(async (body: unknown) => {
      captured = body;
      return {
        id: "response-id",
        status: "completed",
        output_text: '{"ok":true}',
        usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
      };
    });
    const client = { responses: { create } } as unknown as Pick<
      OpenAI,
      "responses"
    >;
    const provider = new OpenAITextModelProvider(
      client,
      "configured-model",
      1000,
      0,
    );
    const response = await provider.generate({
      systemPrompt: "s",
      userPrompt: "u",
      responseFormat: "json",
    });
    expect(captured).toMatchObject({
      model: "configured-model",
      text: { format: { type: "json_object" } },
    });
    expect(response).toMatchObject({
      provider: "openai",
      model: "configured-model",
      content: '{"ok":true}',
    });
  });
});
