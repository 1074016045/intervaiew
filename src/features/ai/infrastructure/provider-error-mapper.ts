import { AiError } from "../domain/ai-errors";

type StatusError = Error & { status?: number; code?: string };

export function mapProviderError(error: unknown): AiError {
  if (error instanceof AiError) return error;
  const candidate = error instanceof Error ? (error as StatusError) : undefined;
  if (
    candidate?.name === "AbortError" ||
    candidate?.name === "APIConnectionTimeoutError" ||
    candidate?.code === "ETIMEDOUT"
  ) {
    return new AiError(
      "AI_TIMEOUT",
      "The AI provider request timed out.",
      true,
      { cause: error },
    );
  }
  if (
    candidate?.name === "APIConnectionError" ||
    [
      "ECONNRESET",
      "ECONNREFUSED",
      "EPIPE",
      "EAI_AGAIN",
      "ENETUNREACH",
    ].includes(candidate?.code ?? "")
  ) {
    return new AiError(
      "AI_PROVIDER_UNAVAILABLE",
      "The AI provider is temporarily unavailable.",
      true,
      { cause: error },
    );
  }
  switch (candidate?.status) {
    case 400:
    case 422:
      return new AiError(
        "AI_INVALID_REQUEST",
        "The AI provider rejected the request.",
        false,
        { cause: error },
      );
    case 401:
      return new AiError(
        "AI_AUTHENTICATION_ERROR",
        "The AI provider credentials were rejected.",
        false,
        { cause: error },
      );
    case 402:
      return new AiError(
        "AI_INSUFFICIENT_BALANCE",
        "The AI provider account has insufficient balance.",
        false,
        { cause: error },
      );
    case 429:
      return new AiError(
        "AI_RATE_LIMITED",
        "The AI provider rate limit was reached.",
        true,
        { cause: error },
      );
    case 500:
    case 503:
      return new AiError(
        "AI_PROVIDER_UNAVAILABLE",
        "The AI provider is temporarily unavailable.",
        true,
        { cause: error },
      );
    default:
      return new AiError(
        "AI_UNKNOWN_ERROR",
        "The AI provider request failed.",
        false,
        { cause: error },
      );
  }
}
