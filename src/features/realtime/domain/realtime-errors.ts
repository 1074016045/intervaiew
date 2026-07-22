export class RealtimeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RealtimeError";
  }
}

export function safeRealtimeMessage(code: string): string {
  const messages: Record<string, string> = {
    REALTIME_DISABLED: "Voice mode is not configured on this server.",
    REALTIME_CONFIGURATION_ERROR: "Voice mode is not configured correctly.",
    REALTIME_AUTHENTICATION_ERROR:
      "OpenAI authentication failed. Contact the server administrator.",
    REALTIME_RATE_LIMITED: "Voice service is busy. Please try again later.",
    REALTIME_PROVIDER_UNAVAILABLE:
      "Voice service is temporarily unavailable.",
    REALTIME_TOKEN_CREATION_FAILED:
      "Could not prepare the voice connection.",
    REALTIME_INTERVIEW_NOT_READY:
      "Generate a question plan before starting voice mode.",
    REALTIME_SESSION_EXPIRED:
      "This voice session has expired. Reconnect to continue.",
    REALTIME_CONNECTION_TIMEOUT: "The voice connection timed out.",
    MICROPHONE_DENIED: "Microphone permission was denied.",
    MICROPHONE_NOT_FOUND: "No microphone was found.",
    WEBRTC_UNSUPPORTED: "This browser does not support WebRTC voice mode.",
  };
  return messages[code] ?? "The voice session encountered an error.";
}
