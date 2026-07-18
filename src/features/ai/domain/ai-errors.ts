export const aiErrorCodes = [
  "AI_CONFIGURATION_ERROR",
  "AI_AUTHENTICATION_ERROR",
  "AI_INSUFFICIENT_BALANCE",
  "AI_RATE_LIMITED",
  "AI_INVALID_REQUEST",
  "AI_PROVIDER_UNAVAILABLE",
  "AI_TIMEOUT",
  "AI_INVALID_RESPONSE",
  "AI_UNKNOWN_ERROR",
] as const;

export type AiErrorCode = (typeof aiErrorCodes)[number];

export class AiError extends Error {
  constructor(
    public readonly code: AiErrorCode,
    message: string,
    public readonly retryable = false,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AiError";
  }
}
