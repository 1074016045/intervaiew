export const realtimeConnectionStates = [
  "idle",
  "requesting-permission",
  "connecting",
  "connected",
  "reconnecting",
  "disconnecting",
  "disconnected",
  "failed",
] as const;

export type RealtimeConnectionState =
  (typeof realtimeConnectionStates)[number];

export type RealtimeTranscriptEvent = {
  providerItemId: string;
  role: "candidate" | "interviewer";
  text: string;
  isFinal: boolean;
  createdAt: number;
};

export type RealtimeConnectInput = {
  clientSecret: string;
  model: string;
  voice: string;
  baseUrl: string;
  mediaStream: unknown;
  audioElement: unknown;
  language: "English" | "Chinese" | "Bilingual";
  silenceDurationMs: number;
  transcriptionModel: string;
  connectTimeoutMs: number;
  interviewTitle: string;
  onInterviewerStream?: (stream: unknown) => void;
};

export type RealtimeEvent =
  | { type: "state"; state: RealtimeConnectionState }
  | { type: "transcript"; transcript: RealtimeTranscriptEvent }
  | { type: "interviewer-speaking"; speaking: boolean }
  | { type: "candidate-speaking"; speaking: boolean }
  | { type: "interrupted" }
  | { type: "error"; code: string; message: string };

export type RealtimeEventListener = (event: RealtimeEvent) => void;

export type RealtimeQuestionSpeechInput = {
  question: string;
  questionSequence: number;
};

export type RealtimeClarificationSpeechInput = {
  clarification: string;
  questionSequence: number;
};

export type ClientSecretResponse = {
  clientSecret: string;
  expiresAt: number;
  model: string;
  voice: string;
  baseUrl: string;
  transcriptionModel: string;
  silenceDurationMs: number;
  maxSessionSeconds: number;
  connectTimeoutMs: number;
  attemptId: string;
};
