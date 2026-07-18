import type {
  CreateQuestionPlanInput,
  QuestionPlan,
} from "../domain/question-plan.types";

export interface QuestionPlanner {
  createPlan(input: CreateQuestionPlanInput): Promise<QuestionPlan>;
}
