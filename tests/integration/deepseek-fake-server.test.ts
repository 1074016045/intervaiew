import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import OpenAI from "openai";
import { DeepSeekTextModelProvider } from "@/features/ai/infrastructure/deepseek/deepseek-text-model-provider";

type RequestBody = {
  model: string;
  response_format?: { type: string };
  thinking?: { type: string };
  messages?: unknown[];
};
describe("DeepSeek adapter fake HTTP server", () => {
  let server: Server | undefined;
  afterEach(
    () =>
      new Promise<void>((resolve) =>
        server ? server.close(() => resolve()) : resolve(),
      ),
  );
  it("uses chat completions, authorization, configured model, JSON mode and disabled thinking", async () => {
    let body: RequestBody | undefined;
    let authorizationPresent = false;
    let path = "";
    server = createServer((request, response) => {
      path = request.url ?? "";
      authorizationPresent = Boolean(request.headers.authorization);
      let raw = "";
      request.on("data", (chunk) => {
        raw += String(chunk);
      });
      request.on("end", () => {
        body = JSON.parse(raw) as RequestBody;
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            id: "fake-request",
            object: "chat.completion",
            created: 1,
            model: "deepseek-v4-flash",
            choices: [
              {
                index: 0,
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  content: '{"sessionSummary":"ok","questions":[]}',
                  reasoning_content: "must-not-leak",
                },
              },
            ],
            usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
          }),
        );
      });
    });
    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", () => resolve()),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Fake server address unavailable");
    const client = new OpenAI({
      apiKey: "fake-local-key",
      baseURL: `http://127.0.0.1:${address.port}`,
      maxRetries: 0,
    });
    const provider = new DeepSeekTextModelProvider(
      client,
      "deepseek-v4-flash",
      3000,
      0,
    );
    const result = await provider.generate({
      systemPrompt: "system",
      userPrompt: "user",
      responseFormat: "json",
    });
    expect(path).toBe("/chat/completions");
    expect(authorizationPresent).toBe(true);
    expect(body).toMatchObject({
      model: "deepseek-v4-flash",
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
    });
    expect(result.content).not.toContain("must-not-leak");
  });
});
