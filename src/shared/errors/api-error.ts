import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AiError } from "@/features/ai/domain/ai-errors";
import { InterviewDomainError } from "@/features/interviews/domain/interview-errors";
import { safeLogger } from "@/infrastructure/logging/safe-logger";

const aiStatuses: Record<string, number> = {
  AI_CONFIGURATION_ERROR: 500,
  AI_AUTHENTICATION_ERROR: 502,
  AI_INSUFFICIENT_BALANCE: 402,
  AI_RATE_LIMITED: 429,
  AI_INVALID_REQUEST: 400,
  AI_PROVIDER_UNAVAILABLE: 503,
  AI_TIMEOUT: 504,
  AI_INVALID_RESPONSE: 502,
  AI_UNKNOWN_ERROR: 502,
};

export function apiErrorResponse(
  error: unknown,
  context: { route: string; sessionId?: string },
) {
  let code = "INTERNAL_ERROR";
  let message = "An unexpected error occurred.";
  let status = 500;
  if (error instanceof ZodError) {
    code = "VALIDATION_ERROR";
    message = "The request data was invalid.";
    status = 400;
  } else if (error instanceof InterviewDomainError) {
    code = error.code;
    message = error.message;
    status = code === "INTERVIEW_NOT_FOUND" ? 404 : 409;
  } else if (error instanceof AiError) {
    code = error.code;
    message = error.message;
    status = aiStatuses[code] ?? 502;
  }
  safeLogger.error("API request failed", {
    errorCode: code,
    route: context.route,
    sessionId: context.sessionId,
    httpStatus: status,
  });
  return NextResponse.json({ error: { code, message } }, { status });
}
