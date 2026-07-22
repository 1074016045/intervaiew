import "server-only";
import { z } from "zod";

const optionalString = z
  .string()
  .optional()
  .transform((value) => value?.trim() || undefined);

const booleanString = (defaultValue: "true" | "false") =>
  z
    .preprocess(
      (value) => (typeof value === "boolean" ? String(value) : value),
      z.enum(["true", "false"]).default(defaultValue),
    )
    .transform((value) => value === "true");

export const serverEnvSchema = z.object({
  AI_PROVIDER: z.string().default("mock"),
  DEEPSEEK_API_KEY: optionalString,
  DEEPSEEK_BASE_URL: z.url().default("https://api.deepseek.com"),
  DEEPSEEK_TEXT_MODEL: z.string().min(1).default("deepseek-v4-flash"),
  DEEPSEEK_THINKING_MODE: z.enum(["disabled"]).default("disabled"),
  OPENAI_API_KEY: optionalString,
  OPENAI_TEXT_MODEL: optionalString,
  OPENAI_REALTIME_ENABLED: booleanString("false"),
  REALTIME_FAKE_ENABLED: booleanString("false"),
  TRANSCRIPT_LAB_FAKE_ENABLED: booleanString("false"),
  OPENAI_REALTIME_MODEL: z.string().min(1).default("gpt-realtime-2.1"),
  OPENAI_REALTIME_VOICE: z.string().min(1).default("marin"),
  OPENAI_REALTIME_TRANSCRIPTION_MODEL: z
    .string()
    .min(1)
    .default("gpt-4o-transcribe"),
  OPENAI_REALTIME_BASE_URL: z.url().default("https://api.openai.com"),
  OPENAI_REALTIME_MAX_SESSION_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(3600)
    .default(3300),
  OPENAI_REALTIME_CONNECT_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(60000)
    .default(20000),
  OPENAI_REALTIME_SILENCE_DURATION_MS: z.coerce
    .number()
    .int()
    .min(200)
    .max(5000)
    .default(1200),
  RECORDINGS_ENABLED: booleanString("true"),
  MAX_RECORDING_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(1_073_741_824)
    .default(209_715_200),
  RECORDINGS_PATH: z.string().min(1).default("./data/recordings"),
  DATABASE_PATH: z.string().min(1).default("./data/intervaiew.db"),
  MAX_RESUME_CHARACTERS: z.coerce
    .number()
    .int()
    .min(40)
    .max(100_000)
    .default(20_000),
  MAX_JOB_DESCRIPTION_CHARACTERS: z.coerce
    .number()
    .int()
    .min(40)
    .max(100_000)
    .default(20_000),
  AI_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(180_000)
    .default(60_000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
let cached: ServerEnv | undefined;
export function getServerEnv(): ServerEnv {
  cached ??= serverEnvSchema.parse(process.env);
  return cached;
}
export function resetServerEnvForTests() {
  cached = undefined;
}
