export const transcriptRoles = ["interviewer", "candidate", "system"] as const;
export const transcriptSources = ["text", "control", "voice"] as const;
export const transcriptEventTypes = [
  "question",
  "answer",
  "clarification_request",
  "clarification_response",
  "repeat_request",
  "completion",
  "cancellation",
  "system_message",
] as const;

export type TranscriptItem = {
  id: string;
  sessionId: string;
  sequence: number;
  role: (typeof transcriptRoles)[number];
  source: (typeof transcriptSources)[number];
  eventType: (typeof transcriptEventTypes)[number];
  text: string;
  questionSequence: number | null;
  actionId: string | null;
  providerItemId: string | null;
  createdAt: Date;
};
