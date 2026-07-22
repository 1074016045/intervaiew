import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AiError } from "@/features/ai/domain/ai-errors";
import { InterviewDomainError } from "@/features/interviews/domain/interview-errors";
import { safeLogger } from "@/infrastructure/logging/safe-logger";
import { RealtimeError } from "@/features/realtime/domain/realtime-errors";
import { QuestionIntelligenceError } from "@/features/question-intelligence/domain/question-intelligence-error";

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

const realtimeStatuses: Record<string, number> = {
  INVALID_ORIGIN: 403,
  REALTIME_DISABLED: 503,
  REALTIME_CONFIGURATION_ERROR: 500,
  REALTIME_AUTHENTICATION_ERROR: 502,
  REALTIME_RATE_LIMITED: 429,
  REALTIME_PROVIDER_UNAVAILABLE: 503,
  REALTIME_TOKEN_CREATION_FAILED: 502,
  REALTIME_INTERVIEW_NOT_READY: 409,
  REALTIME_SESSION_EXPIRED: 410,
  RECORDING_DISABLED: 503,
  RECORDING_FILE_REQUIRED: 400,
  UNSAFE_RECORDING_MIME: 415,
  RECORDING_SIZE_INVALID: 413,
  RECORDING_NOT_FOUND: 404,
  UNSAFE_RECORDING_PATH: 400,
};

const questionIntelligenceStatuses: Record<string, number> = {
  ANALYSIS_SESSION_NOT_FOUND: 404,
  ANALYSIS_SESSION_STATE_INVALID: 409,
  TRANSCRIPT_SEGMENT_INVALID: 400,
  TRANSCRIPT_SEGMENT_NOT_FINAL: 400,
  TRANSCRIPT_SEGMENT_DUPLICATE: 409,
  TRANSCRIPT_SEGMENT_SEQUENCE_CONFLICT: 409,
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
  } else if (error instanceof RealtimeError) {
    code = error.code;
    message = error.message;
    status = realtimeStatuses[code] ?? 502;
  } else if (error instanceof QuestionIntelligenceError) {
    code = error.code;
    message = error.message;
    status = questionIntelligenceStatuses[code] ?? 400;
  }
  safeLogger.error("API request failed", {
    errorCode: code,
    route: context.route,
    sessionId: context.sessionId,
    httpStatus: status,
  });
  return NextResponse.json({ error: { code, message } }, { status });
}
