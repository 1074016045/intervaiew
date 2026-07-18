import { describe, expect, it, vi } from "vitest";
import { AiError } from "@/features/ai/domain/ai-errors";
import { InterviewDomainError } from "@/features/interviews/domain/interview-errors";
import { apiErrorResponse } from "@/shared/errors/api-error";

describe("API error sanitization", () => {
  it("maps domain not-found to the shared envelope", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = apiErrorResponse(
      new InterviewDomainError(
        "INTERVIEW_NOT_FOUND",
        "The interview could not be found.",
      ),
      { route: "/test" },
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: {
        code: "INTERVIEW_NOT_FOUND",
        message: "The interview could not be found.",
      },
    });
  });
  it("does not expose raw provider text, stack, resume, or key", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const raw = new Error("raw response with resume and sk-secret");
    const response = apiErrorResponse(
      new AiError(
        "AI_PROVIDER_UNAVAILABLE",
        "The AI provider is temporarily unavailable.",
        true,
        { cause: raw },
      ),
      { route: "/test", sessionId: "safe-id" },
    );
    const body = JSON.stringify(await response.json());
    expect(response.status).toBe(503);
    expect(body).not.toContain("raw response");
    expect(body).not.toContain("sk-secret");
    expect(body).not.toContain("stack");
  });
});
