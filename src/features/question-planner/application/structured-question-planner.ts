import { AiError } from "@/features/ai/domain/ai-errors";
import type { TextModelProvider } from "@/features/ai/domain/text-model.port";
import { createInterviewSchemaWithLimits } from "@/features/interviews/domain/interview.types";
import { questionPlanSchema } from "../domain/question-plan.schema";
import type {
  CreateQuestionPlanInput,
  QuestionPlan,
} from "../domain/question-plan.types";
import type { QuestionPlanner } from "./question-planner.port";
import {
  buildQuestionPlanPrompt,
  buildRepairPrompt,
  QUESTION_PLAN_SYSTEM_PROMPT,
} from "./question-plan-prompt";

function validatePlan(content: string, expectedCount: number): QuestionPlan {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    throw new AiError(
      "AI_INVALID_RESPONSE",
      "The AI provider returned invalid JSON.",
    );
  }
  const result = questionPlanSchema.safeParse(json);
  if (!result.success)
    throw new AiError(
      "AI_INVALID_RESPONSE",
      "The AI response did not match the question plan schema.",
    );
  if (result.data.questions.length !== expectedCount)
    throw new AiError(
      "AI_INVALID_RESPONSE",
      "The AI response contained an incorrect number of questions.",
    );
  result.data.questions.forEach((question, index) => {
    if (question.sequence !== index + 1)
      throw new AiError(
        "AI_INVALID_RESPONSE",
        "Question sequence values were invalid.",
      );
  });
  const normalized = result.data.questions.map((item) =>
    item.question.toLocaleLowerCase().replace(/\s+/g, " ").trim(),
  );
  if (new Set(normalized).size !== normalized.length)
    throw new AiError(
      "AI_INVALID_RESPONSE",
      "The AI response contained duplicate questions.",
    );
  return result.data;
}

export class StructuredQuestionPlanner implements QuestionPlanner {
  constructor(
    private readonly provider: TextModelProvider,
    private readonly timeoutMs?: number,
  ) {}
  async createPlan(input: CreateQuestionPlanInput): Promise<QuestionPlan> {
    const validation = createInterviewSchemaWithLimits(100_000, 100_000)
      .pick({
        targetRole: true,
        targetCompany: true,
        interviewType: true,
        difficulty: true,
        language: true,
        questionCount: true,
        resumeText: true,
        jobDescription: true,
      })
      .safeParse(input);
    if (!validation.success)
      throw new AiError(
        "AI_INVALID_REQUEST",
        "Question plan input was invalid.",
      );
    const prompts = buildQuestionPlanPrompt(input);
    const first = await this.provider.generate({
      ...prompts,
      responseFormat: "json",
      timeoutMs: this.timeoutMs,
    });
    try {
      return validatePlan(first.content, input.questionCount);
    } catch (error) {
      if (!(error instanceof AiError) || error.code !== "AI_INVALID_RESPONSE")
        throw error;
      const repaired = await this.provider.generate({
        systemPrompt: QUESTION_PLAN_SYSTEM_PROMPT,
        userPrompt: buildRepairPrompt(first.content, input.questionCount),
        responseFormat: "json",
        timeoutMs: this.timeoutMs,
      });
      return validatePlan(repaired.content, input.questionCount);
    }
  }
}
