import "server-only";
import { z } from "zod";
import type { ServerEnv } from "@/infrastructure/env/server-env";
import { buildRealtimeInterviewerInstructions } from "../../application/build-realtime-interviewer-instructions";
import { RealtimeError } from "../../domain/realtime-errors";

const clientSecretPayloadSchema = z.object({
  value: z.string().startsWith("ek_").min(8),
  expires_at: z.number().int().positive(),
});

export async function createOpenAIRealtimeClientSecret(
  env: ServerEnv,
  interview: {
    title: string;
    language: "English" | "Chinese" | "Bilingual";
  },
  fetcher: typeof fetch = fetch,
) {
  if (!env.OPENAI_REALTIME_ENABLED)
    throw new RealtimeError(
      "REALTIME_DISABLED",
      "Voice mode is not configured on this server.",
    );
  if (!env.OPENAI_API_KEY)
    throw new RealtimeError(
      "REALTIME_CONFIGURATION_ERROR",
      "Voice mode is not configured correctly.",
    );
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    env.OPENAI_REALTIME_CONNECT_TIMEOUT_MS,
  );
  let response: Response;
  try {
    response = await fetcher(
      `${env.OPENAI_REALTIME_BASE_URL.replace(/\/$/, "")}/v1/realtime/client_secrets`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          expires_after: {
            anchor: "created_at",
            seconds: env.OPENAI_REALTIME_MAX_SESSION_SECONDS,
          },
          session: {
            type: "realtime",
            model: env.OPENAI_REALTIME_MODEL,
            instructions: buildRealtimeInterviewerInstructions({
              interviewTitle: interview.title,
              language: interview.language,
            }),
            output_modalities: ["audio"],
            tools: [],
            tool_choice: "none",
            tracing: null,
            audio: {
              input: {
                transcription: {
                  model: env.OPENAI_REALTIME_TRANSCRIPTION_MODEL,
                },
                noise_reduction: { type: "far_field" },
                turn_detection: {
                  type: "server_vad",
                  create_response: false,
                  interrupt_response: true,
                  prefix_padding_ms: 300,
                  silence_duration_ms:
                    env.OPENAI_REALTIME_SILENCE_DURATION_MS,
                },
              },
              output: { voice: env.OPENAI_REALTIME_VOICE },
            },
          },
        }),
        signal: controller.signal,
        cache: "no-store",
      },
    );
  } catch (error) {
    throw new RealtimeError(
      "REALTIME_PROVIDER_UNAVAILABLE",
      "Voice service is temporarily unavailable.",
      { cause: error },
    );
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    const code =
      response.status === 401 || response.status === 403
        ? "REALTIME_AUTHENTICATION_ERROR"
        : response.status === 429
          ? "REALTIME_RATE_LIMITED"
          : response.status >= 500
            ? "REALTIME_PROVIDER_UNAVAILABLE"
            : "REALTIME_TOKEN_CREATION_FAILED";
    throw new RealtimeError(
      code,
      code === "REALTIME_AUTHENTICATION_ERROR"
        ? "OpenAI authentication failed."
        : code === "REALTIME_RATE_LIMITED"
          ? "Voice service is busy. Please try again later."
          : code === "REALTIME_PROVIDER_UNAVAILABLE"
            ? "Voice service is temporarily unavailable."
            : "Could not prepare the voice connection.",
    );
  }
  const parsed = clientSecretPayloadSchema.safeParse(await response.json());
  if (!parsed.success)
    throw new RealtimeError(
      "REALTIME_TOKEN_CREATION_FAILED",
      "Could not prepare the voice connection.",
    );
  return parsed.data;
}
