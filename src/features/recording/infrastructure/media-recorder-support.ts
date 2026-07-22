export const recordingMimeCandidates = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
] as const;

export function selectRecordingMimeType(
  recorder: Pick<typeof MediaRecorder, "isTypeSupported"> | undefined,
) {
  if (!recorder) return null;
  return (
    recordingMimeCandidates.find((mime) => recorder.isTypeSupported(mime)) ??
    ""
  );
}

export function recordingExtension(mimeType: string) {
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("ogg")) return "ogg";
  return "audio";
}
