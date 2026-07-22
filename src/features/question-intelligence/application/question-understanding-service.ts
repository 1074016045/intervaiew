import { z } from "zod";
import { immutableUnderstanding, validateUnderstandingTraceability } from "../domain/question-understanding";
import { QuestionIntelligenceError } from "../domain/question-intelligence-error";
import type { HybridQuestionUnderstander } from "./hybrid-question-understander";
import type { QuestionUnderstandingRepositoryPort, UnderstandingRepositoryResult, UnderstandingSnapshot } from "./question-understanding-repository.port";

const boundedId = z.string().trim().min(1).max(200);
export const analyzeQuestionUnderstandingSchema = z.object({ finalizedQuestionId: boundedId, actionId: boundedId }).strict();

export class QuestionUnderstandingService {
  constructor(private readonly repository: QuestionUnderstandingRepositoryPort, private readonly understander: HybridQuestionUnderstander, private readonly createId: () => string = () => crypto.randomUUID(), private readonly now: () => number = () => Date.now()) {}

  list(analysisSessionId: string) { return this.unwrap(this.repository.listActive(analysisSessionId)); }

  async analyze(analysisSessionId: string, input: unknown, signal?: AbortSignal) {
    const parsed = analyzeQuestionUnderstandingSchema.parse(input);
    const prepared = this.repository.prepare(analysisSessionId, parsed.finalizedQuestionId, parsed.actionId);
    if (prepared.kind !== "success") this.throwRepositoryError(prepared.kind);
    if (prepared.duplicated) return Object.freeze({ ...this.list(analysisSessionId), duplicated: true });
    const question = prepared.value.question;
    const now = this.now();
    const understanding = prepared.value.cached ?? immutableUnderstanding({
      id: this.createId(), analysisSessionId, finalizedQuestionId: question.id,
      finalizedQuestionRevision: question.revision, sourceBoundaryDecisionId: question.boundaryDecisionId,
      understandingRevision: 1, ...(await this.understander.analyze(question.text, signal)), createdAt: now, updatedAt: now,
    });
    validateUnderstandingTraceability(question.text, understanding);
    const committed = this.repository.commit({ analysisSessionId, finalizedQuestion: question, actionId: parsed.actionId, understanding, now: this.now() });
    const snapshot = this.unwrap(committed);
    return Object.freeze({ ...snapshot, duplicated: committed.kind === "success" && committed.duplicated });
  }

  private unwrap(result: UnderstandingRepositoryResult<UnderstandingSnapshot>) {
    if (result.kind !== "success") this.throwRepositoryError(result.kind);
    return result.value;
  }

  private throwRepositoryError(kind: Exclude<UnderstandingRepositoryResult<never>["kind"], "success">): never {
    const errors = {
      "session-not-found": ["QUESTION_UNDERSTANDING_SESSION_NOT_FOUND", "The analysis session could not be found."],
      "question-not-found": ["QUESTION_UNDERSTANDING_QUESTION_NOT_FOUND", "The finalized question could not be found."],
      "question-undone": ["QUESTION_UNDERSTANDING_QUESTION_UNDONE", "The finalized question is no longer active."],
      "ownership-mismatch": ["QUESTION_UNDERSTANDING_OWNERSHIP_MISMATCH", "The finalized question does not belong to this analysis session."],
      "stale-revision": ["QUESTION_UNDERSTANDING_STALE_REVISION", "The finalized question revision changed during analysis."],
      "action-conflict": ["QUESTION_UNDERSTANDING_ACTION_DUPLICATE", "The action identifier is already used for another question."],
    } as const;
    const [code, message] = errors[kind];
    throw new QuestionIntelligenceError(code, message);
  }
}
