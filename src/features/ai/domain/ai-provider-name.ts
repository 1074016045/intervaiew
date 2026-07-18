import { z } from "zod";

export const aiProviderNameSchema = z.enum(["mock", "deepseek", "openai"]);
export type AiProviderName = z.infer<typeof aiProviderNameSchema>;
