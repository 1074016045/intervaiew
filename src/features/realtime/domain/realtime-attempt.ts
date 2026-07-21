export const realtimeAttemptStatuses = [
  "created",
  "connecting",
  "connected",
  "reconnecting",
  "disconnected",
  "completed",
  "cancelled",
  "failed",
] as const;

export type RealtimeAttemptStatus =
  (typeof realtimeAttemptStatuses)[number];
