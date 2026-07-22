import "server-only";
import { DeterministicQuestionUnderstander } from "../application/deterministic-question-understander";
import { HybridQuestionUnderstander } from "../application/hybrid-question-understander";
import { QuestionUnderstandingService } from "../application/question-understanding-service";
import { FakeQuestionUnderstandingProvider } from "./fake/fake-question-understanding-provider";
import { SqliteQuestionUnderstandingRepository } from "./sqlite/sqlite-question-understanding-repository";
import { getServerEnv } from "@/infrastructure/env/server-env";

export function createQuestionUnderstandingService() {
  const env = getServerEnv();
  const fakeEnabled = process.env.NODE_ENV !== "production" && env.QUESTION_UNDERSTANDING_FAKE_SEMANTIC_ENABLED;
  const deterministic = new DeterministicQuestionUnderstander();
  return new QuestionUnderstandingService(new SqliteQuestionUnderstandingRepository(), new HybridQuestionUnderstander(deterministic, fakeEnabled ? new FakeQuestionUnderstandingProvider() : null));
}
