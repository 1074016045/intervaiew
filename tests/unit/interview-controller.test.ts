import { describe, expect, it } from "vitest";
import {
  calculateDurationSeconds,
  InterviewController,
} from "@/features/interviews/domain/interview-controller";

describe("InterviewController", () => {
  it("runs the legal planning and interview lifecycle", () => {
    const controller = new InterviewController({
      status: "draft",
      currentQuestionIndex: 0,
      questionCount: 3,
    });
    expect(controller.beginPlanning().status).toBe("planning");
    expect(controller.completePlanning().status).toBe("ready");
    expect(controller.start().status).toBe("active");
    expect(controller.submitAnswer().currentQuestionIndex).toBe(1);
    expect(controller.submitAnswer().currentQuestionIndex).toBe(2);
    expect(controller.submitAnswer().status).toBe("ending");
    expect(controller.finish()).toEqual({
      status: "completed",
      currentQuestionIndex: 3,
      questionCount: 3,
    });
  });
  it("rejects draft to completed and completed restart", () => {
    const draft = new InterviewController({
      status: "draft",
      currentQuestionIndex: 0,
      questionCount: 3,
    });
    expect(() => draft.finish()).toThrow(/Cannot transition/);
    const completed = new InterviewController({
      status: "completed",
      currentQuestionIndex: 3,
      questionCount: 3,
    });
    expect(() => completed.start()).toThrow(/Cannot transition/);
    expect(() => completed.finish()).toThrow(/Cannot transition/);
  });
  it("rejects cancelled continuation", () => {
    const cancelled = new InterviewController({
      status: "cancelled",
      currentQuestionIndex: 1,
      questionCount: 3,
    });
    expect(() => cancelled.submitAnswer()).toThrow(/not active/);
  });
  it("rejects invalid indexes", () => {
    expect(
      () =>
        new InterviewController({
          status: "active",
          currentQuestionIndex: -1,
          questionCount: 3,
        }),
    ).toThrow(/negative/);
    expect(
      () =>
        new InterviewController({
          status: "active",
          currentQuestionIndex: 3,
          questionCount: 3,
        }),
    ).toThrow(/bounds/);
  });
  it("repeat and clarification do not advance", () => {
    const controller = new InterviewController({
      status: "active",
      currentQuestionIndex: 1,
      questionCount: 3,
    });
    expect(controller.repeatCurrentQuestion().currentQuestionIndex).toBe(1);
    expect(controller.requestClarification().currentQuestionIndex).toBe(1);
  });
  it("calculates duration in whole seconds and never negative", () => {
    expect(calculateDurationSeconds(new Date(1_000), new Date(4_900))).toBe(3);
    expect(calculateDurationSeconds(new Date(5_000), new Date(4_000))).toBe(0);
    expect(calculateDurationSeconds(null, new Date())).toBe(0);
  });
});
