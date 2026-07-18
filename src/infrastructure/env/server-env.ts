import "server-only";
import { z } from "zod";

const optionalString = z
  .string()
  .optional()
  .transform((value) => value?.trim() || undefined);

export const serverEnvSchema = z.object({
  AI_PROVIDER: z.string().default("mock"),
  DEEPSEEK_API_KEY: optionalString,
  DEEPSEEK_BASE_URL: z.url().default("https://api.deepseek.com"),
  DEEPSEEK_TEXT_MODEL: z.string().min(1).default("deepseek-v4-flash"),
  DEEPSEEK_THINKING_MODE: z.enum(["disabled"]).default("disabled"),
  OPENAI_API_KEY: optionalString,
  OPENAI_TEXT_MODEL: optionalString,
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
