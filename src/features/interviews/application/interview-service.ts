import "server-only";
import { AiError } from "@/features/ai/domain/ai-errors";
import { createTextModelProvider } from "@/features/ai/application/text-model-provider-factory";
import { InterviewController } from "../domain/interview-controller";
import { InterviewDomainError } from "../domain/interview-errors";
import {
  createInterviewSchemaWithLimits,
  type CreateInterviewInput,
  type InterviewStatus,
} from "../domain/interview.types";
import { StructuredQuestionPlanner } from "@/features/question-planner/application/structured-question-planner";
import { getDatabase } from "@/infrastructure/db/client";
import { getServerEnv } from "@/infrastructure/env/server-env";
import { InterviewRepository } from "@/infrastructure/repositories/interview.repository";
import { RecordingStorageService } from "@/features/recording/application/recording-storage-service";

export class InterviewService {
  constructor(
    private readonly repository = new InterviewRepository(getDatabase().db),
    private readonly recordingStorage = new RecordingStorageService(),
  ) {}
  create(input: unknown) {
    const env = getServerEnv();
    return this.repository.create(
      createInterviewSchemaWithLimits(
        env.MAX_RESUME_CHARACTERS,
        env.MAX_JOB_DESCRIPTION_CHARACTERS,
      ).parse(input),
    );
  }
  list(filters?: { status?: InterviewStatus; search?: string }) {
    return this.repository.list(filters);
  }
  get(id: string) {
    return this.repository.getSafeDetail(id);
  }
  transcript(id: string) {
    return this.repository.getTranscript(id);
  }
  recordings(id: string) {
    return this.recordingStorage.list(id);
  }
  async delete(id: string) {
    await this.recordingStorage.deleteForInterview(id);
    return this.repository.delete(id);
  }

  async generateQuestions(id: string) {
    const session = this.repository.getPrivate(id);
    if (!session)
      throw new InterviewDomainError(
        "INTERVIEW_NOT_FOUND",
        "The interview could not be found.",
      );
    const controller = new InterviewController({
      status: session.status,
      currentQuestionIndex: session.currentQuestionIndex,
      questionCount: session.questionCount,
    });
    if (session.status === "draft") controller.beginPlanning();
    else controller.regeneratePlan();
    this.repository.beginPlanning(id, "planning");
    const env = getServerEnv();
    const provider = createTextModelProvider(env);
    const planner = new StructuredQuestionPlanner(
      provider,
      env.AI_REQUEST_TIMEOUT_MS,
    );
    try {
      const plan = await planner.createPlan({
        targetRole: session.targetRole,
        targetCompany: session.targetCompany,
        interviewType: session.interviewType,
        difficulty: session.difficulty,
        language: session.language,
        resumeText: session.resumeText,
        jobDescription: session.jobDescription,
        questionCount: session.questionCount,
      });
      controller.completePlanning(plan.questions.length);
      const model =
        provider.name === "mock"
          ? "mock-deterministic"
          : provider.name === "deepseek"
            ? env.DEEPSEEK_TEXT_MODEL
            : env.OPENAI_TEXT_MODEL!;
      this.repository.savePlan(id, plan, provider.name, model);
      return this.repository.getSafeDetail(id);
    } catch (error) {
      const code = error instanceof AiError ? error.code : "AI_UNKNOWN_ERROR";
      controller.failPlanning();
      this.repository.failPlanning(id, code);
      throw error;
    }
  }
}

export type { CreateInterviewInput };
