import type { AiProviderName } from "@/features/ai/domain/ai-provider-name";
import type {
  InterviewDifficulty,
  InterviewLanguage,
  InterviewStatus,
  InterviewType,
} from "./interview.types";

export type QuestionView = {
  id: string;
  sessionId: string;
  sequence: number;
  question: string;
  competency: string;
  rationale: string;
  clarification: string | null;
  createdAt: string;
};
export type InterviewDetailView = {
  id: string;
  title: string;
  targetRole: string;
  targetCompany: string | null;
  interviewType: InterviewType;
  difficulty: InterviewDifficulty;
  language: InterviewLanguage;
  questionCount: number;
  status: InterviewStatus;
  aiProvider: AiProviderName | null;
  aiModel: string | null;
  questionPlanSummary: string | null;
  currentQuestionIndex: number;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  failureCode: string | null;
  createdAt: string;
  updatedAt: string;
  resumeCharacters: number;
  jobDescriptionCharacters: number;
  questions: QuestionView[];
};
export type TranscriptView = {
  id: string;
  sessionId: string;
  sequence: number;
  role: "interviewer" | "candidate" | "system";
  source: "text" | "control" | "voice";
  eventType: string;
  text: string;
  questionSequence: number | null;
  actionId: string | null;
  providerItemId?: string | null;
  createdAt: string;
};
export type InterviewSummaryView = Pick<
  InterviewDetailView,
  | "id"
  | "title"
  | "targetRole"
  | "targetCompany"
  | "interviewType"
  | "difficulty"
  | "language"
  | "questionCount"
  | "status"
  | "aiProvider"
  | "aiModel"
  | "currentQuestionIndex"
  | "durationSeconds"
  | "createdAt"
  | "updatedAt"
>;
