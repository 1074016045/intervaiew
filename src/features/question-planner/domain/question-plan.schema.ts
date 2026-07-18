import { z } from "zod";

export const questionSchema = z.object({
  sequence: z.number().int().min(1).max(10),
  question: z.string().trim().min(8).max(1000),
  competency: z.string().trim().min(2).max(120),
  rationale: z.string().trim().min(4).max(500),
  clarification: z.string().trim().min(4).max(500).nullable(),
});

export const questionPlanSchema = z.object({
  sessionSummary: z.string().trim().min(4).max(1000),
  questions: z.array(questionSchema).min(3).max(10),
});
