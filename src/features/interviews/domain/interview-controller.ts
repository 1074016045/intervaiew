import type { InterviewStatus } from "./interview.types";
import { InterviewDomainError } from "./interview-errors";

export interface InterviewControllerState {
  status: InterviewStatus;
  currentQuestionIndex: number;
  questionCount: number;
}

const allowed: Record<InterviewStatus, InterviewStatus[]> = {
  draft: ["planning"],
  planning: ["ready", "draft"],
  ready: ["planning", "active", "cancelled"],
  active: ["ending", "cancelled", "failed"],
  ending: ["completed", "failed"],
  completed: [],
  cancelled: [],
  failed: [],
};

export class InterviewController {
  private state: InterviewControllerState;

  constructor(state: InterviewControllerState) {
    if (state.questionCount < 0 || state.currentQuestionIndex < 0) {
      throw new InterviewDomainError(
        "INVALID_INTERVIEW_STATE",
        "Interview indexes cannot be negative.",
      );
    }
    const completeSentinel =
      state.status === "completed" &&
      state.currentQuestionIndex === state.questionCount;
    if (
      state.questionCount > 0 &&
      state.currentQuestionIndex >= state.questionCount &&
      !completeSentinel
    ) {
      throw new InterviewDomainError(
        "INVALID_INTERVIEW_STATE",
        "Current question index is out of bounds.",
      );
    }
    this.state = { ...state };
  }

  snapshot(): InterviewControllerState {
    return { ...this.state };
  }
  private transition(next: InterviewStatus) {
    if (!allowed[this.state.status].includes(next)) {
      throw new InterviewDomainError(
        "INVALID_STATUS_TRANSITION",
        `Cannot transition from ${this.state.status} to ${next}.`,
      );
    }
    this.state.status = next;
  }
  beginPlanning() {
    this.transition("planning");
    return this.snapshot();
  }
  completePlanning(questionCount = this.state.questionCount) {
    if (questionCount < 1)
      throw new InterviewDomainError(
        "QUESTION_PLAN_REQUIRED",
        "A question plan is required.",
      );
    this.state.questionCount = questionCount;
    this.state.currentQuestionIndex = 0;
    this.transition("ready");
    return this.snapshot();
  }
  failPlanning() {
    this.transition("draft");
    return this.snapshot();
  }
  regeneratePlan() {
    this.transition("planning");
    return this.snapshot();
  }
  start() {
    this.transition("active");
    return this.snapshot();
  }
  submitAnswer() {
    if (this.state.status !== "active")
      throw new InterviewDomainError(
        "INTERVIEW_NOT_ACTIVE",
        "The interview is not active.",
      );
    if (this.state.currentQuestionIndex === this.state.questionCount - 1) {
      this.transition("ending");
    } else {
      this.state.currentQuestionIndex += 1;
    }
    return this.snapshot();
  }
  repeatCurrentQuestion() {
    this.assertActive();
    return this.snapshot();
  }
  requestClarification() {
    this.assertActive();
    return this.snapshot();
  }
  advance() {
    if (
      this.state.status !== "active" ||
      this.state.currentQuestionIndex >= this.state.questionCount - 1
    ) {
      throw new InterviewDomainError(
        "CANNOT_ADVANCE",
        "The interview cannot advance.",
      );
    }
    this.state.currentQuestionIndex += 1;
    return this.snapshot();
  }
  beginEnding() {
    this.transition("ending");
    return this.snapshot();
  }
  finish() {
    this.transition("completed");
    this.state.currentQuestionIndex = this.state.questionCount;
    return this.snapshot();
  }
  cancel() {
    this.transition("cancelled");
    return this.snapshot();
  }
  fail() {
    this.transition("failed");
    return this.snapshot();
  }
  private assertActive() {
    if (this.state.status !== "active")
      throw new InterviewDomainError(
        "INTERVIEW_NOT_ACTIVE",
        "The interview is not active.",
      );
  }
}

export function calculateDurationSeconds(
  startedAt: Date | null,
  endedAt: Date,
): number {
  if (!startedAt) return 0;
  return Math.max(
    0,
    Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000),
  );
}
