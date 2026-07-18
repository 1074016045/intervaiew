import { z } from "zod";
import type { AiProviderName } from "@/features/ai/domain/ai-provider-name";

export const interviewTypes = [
  "behavioral",
  "general-technical",
  "software-engineering",
  "data-science",
  "machine-learning",
  "llm-generative-ai",
  "ai-agent-engineering",
  "system-design",
  "custom",
] as const;
export const interviewTypeSchema = z.enum(interviewTypes);
export type InterviewType = z.infer<typeof interviewTypeSchema>;

export const interviewDifficulties = [
  "internship",
  "graduate",
  "entry-level",
  "mid-level",
  "senior",
] as const;
export const interviewDifficultySchema = z.enum(interviewDifficulties);
export type InterviewDifficulty = z.infer<typeof interviewDifficultySchema>;

export const interviewLanguages = ["English", "Chinese", "Bilingual"] as const;
export const interviewLanguageSchema = z.enum(interviewLanguages);
export type InterviewLanguage = z.infer<typeof interviewLanguageSchema>;

export interface InterviewSession {
  id: string;
  title: string;
  targetRole: string;
  targetCompany: string | null;
  interviewType: InterviewType;
  difficulty: InterviewDifficulty;
  language: InterviewLanguage;
  resumeText: string;
  jobDescription: string;
  questionCount: number;
  status: InterviewStatus;
  aiProvider: AiProviderName | null;
  aiModel: string | null;
  questionPlanSummary: string | null;
  currentQuestionIndex: number;
  startedAt: Date | null;
  endedAt: Date | null;
  durationSeconds: number | null;
  failureCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const interviewStatuses = [
  "draft",
  "planning",
  "ready",
  "active",
  "ending",
  "completed",
  "cancelled",
  "failed",
] as const;
export const interviewStatusSchema = z.enum(interviewStatuses);
export type InterviewStatus = z.infer<typeof interviewStatusSchema>;

export function createInterviewSchemaWithLimits(
  resumeCharacters = 20_000,
  jobDescriptionCharacters = 20_000,
) {
  return z.object({
    title: z.string().trim().min(2).max(120),
    targetRole: z.string().trim().min(2).max(120),
    targetCompany: z
      .string()
      .trim()
      .max(120)
      .optional()
      .nullable()
      .transform((v) => v || null),
    interviewType: interviewTypeSchema,
    difficulty: interviewDifficultySchema,
    language: interviewLanguageSchema,
    questionCount: z.coerce.number().int().min(3).max(10),
    resumeText: z.string().trim().min(40).max(resumeCharacters),
    jobDescription: z.string().trim().min(40).max(jobDescriptionCharacters),
  });
}
export const createInterviewSchema = createInterviewSchemaWithLimits();
export type CreateInterviewInput = z.infer<typeof createInterviewSchema>;
