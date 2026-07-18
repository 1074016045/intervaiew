import { z } from "zod";
import { questionPlanSchema } from "./question-plan.schema";
import type {
  InterviewDifficulty,
  InterviewLanguage,
  InterviewType,
} from "@/features/interviews/domain/interview.types";

export type QuestionPlan = z.infer<typeof questionPlanSchema>;
export type InterviewQuestion = QuestionPlan["questions"][number];

export type CreateQuestionPlanInput = {
  targetRole: string;
  targetCompany: string | null;
  interviewType: InterviewType;
  difficulty: InterviewDifficulty;
  language: InterviewLanguage;
  resumeText: string;
  jobDescription: string;
  questionCount: number;
};
