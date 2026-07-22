export const recordingTrackRoles = ["candidate", "interviewer"] as const;
export type RecordingTrackRole = (typeof recordingTrackRoles)[number];

export const safeRecordingMimeTypes = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/ogg",
] as const;
