import "server-only";
import { DeterministicQuestionBoundaryDetector } from "../application/deterministic-question-boundary-detector";
import { HybridQuestionBoundaryDetector } from "../application/hybrid-question-boundary-detector";
import { QuestionSegmentationService } from "../application/question-segmentation-service";
import type {
  SemanticBoundaryInput,
  SemanticQuestionBoundaryProvider,
} from "../application/semantic-question-boundary-provider.port";
import { FakeSemanticQuestionBoundaryProvider } from "./fake/fake-semantic-question-boundary-provider";
import { SqliteQuestionBoundaryRepository } from "./sqlite/sqlite-question-boundary-repository";
import {
  getQuestionBoundaryPauseConfig,
  getServerEnv,
} from "@/infrastructure/env/server-env";

class UnavailableSemanticQuestionBoundaryProvider implements SemanticQuestionBoundaryProvider {
  readonly name = "unavailable";

  decide(_: SemanticBoundaryInput, signal: AbortSignal): Promise<never> {
    if (signal.aborted)
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    return Promise.reject(new Error("SEMANTIC_BOUNDARY_PROVIDER_UNAVAILABLE"));
  }
}

export function createQuestionSegmentationService() {
  const env = getServerEnv();
  const pause = getQuestionBoundaryPauseConfig(env);
  const deterministic = new DeterministicQuestionBoundaryDetector();
  const fakeEnabled =
    process.env.NODE_ENV !== "production" &&
    env.QUESTION_BOUNDARY_FAKE_SEMANTIC_ENABLED;
  const semantic = fakeEnabled
    ? new FakeSemanticQuestionBoundaryProvider()
    : new UnavailableSemanticQuestionBoundaryProvider();
  const hybrid = new HybridQuestionBoundaryDetector(
    deterministic,
    semantic,
    pause,
  );
  return new QuestionSegmentationService(
    new SqliteQuestionBoundaryRepository(),
    deterministic,
    hybrid,
    undefined,
    undefined,
    pause.longPauseMs,
  );
}
