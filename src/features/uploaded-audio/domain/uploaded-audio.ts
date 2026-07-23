import { z } from "zod";

export const uploadedAudioSpeakerRoles = ["interviewer", "candidate"] as const;
export type UploadedAudioSpeakerRole =
  (typeof uploadedAudioSpeakerRoles)[number];

export const uploadedAudioStatuses = [
  "uploaded",
  "transcribing",
  "completed",
  "failed",
  "deleting",
] as const;
export type UploadedAudioStatus = (typeof uploadedAudioStatuses)[number];

export const uploadedAudioActionTypes = [
  "upload",
  "transcribe",
  "delete",
] as const;
export type UploadedAudioActionType = (typeof uploadedAudioActionTypes)[number];

export const uploadedAudioDeletionScopes = ["asset", "session"] as const;
export type UploadedAudioDeletionScope =
  (typeof uploadedAudioDeletionScopes)[number];

export const uploadedAudioDeletionStatuses = [
  "planned",
  "metadata_deleted",
  "completed",
] as const;
export type UploadedAudioDeletionStatus =
  (typeof uploadedAudioDeletionStatuses)[number];

export const supportedUploadedAudioFormats = Object.freeze([
  { mimeType: "audio/wav", extensions: ["wav"] },
  { mimeType: "audio/x-wav", extensions: ["wav"] },
  { mimeType: "audio/mpeg", extensions: ["mp3"] },
  { mimeType: "audio/mp4", extensions: ["m4a", "mp4"] },
  { mimeType: "audio/ogg", extensions: ["ogg", "oga"] },
  { mimeType: "audio/webm", extensions: ["webm"] },
  { mimeType: "audio/flac", extensions: ["flac"] },
] as const);

const actionIdSchema = z.string().uuid();

export const uploadAudioMetadataSchema = z
  .object({
    actionId: actionIdSchema,
    speakerRole: z.enum(uploadedAudioSpeakerRoles),
    originalFilename: z.string().trim().min(1).max(512),
    mimeType: z.string().trim().min(1).max(100),
    byteSize: z.number().int().positive(),
  })
  .strict();

export const uploadedAudioActionSchema = z
  .object({ actionId: actionIdSchema })
  .strict();

export const transcriptionChunkSchema = z
  .object({
    text: z.string().trim().min(1).max(20_000),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().nonnegative(),
  })
  .strict()
  .refine((value) => value.endMs >= value.startMs, {
    message: "endMs must be greater than or equal to startMs.",
    path: ["endMs"],
  });

export type TranscriptionChunk = z.infer<typeof transcriptionChunkSchema>;

export type UploadedAudioAssetView = Readonly<{
  id: string;
  analysisSessionId: string;
  speakerRole: UploadedAudioSpeakerRole;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  status: UploadedAudioStatus;
  providerLabel: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  failedAt: number | null;
  errorCode: string | null;
  transcriptSegmentCount: number;
}>;

export type UploadedAudioStoredAsset = UploadedAudioAssetView &
  Readonly<{ relativePath: string }>;

export function extensionOf(filename: string) {
  const normalized = filename.trim().toLowerCase();
  const index = normalized.lastIndexOf(".");
  return index > -1 ? normalized.slice(index + 1) : "";
}

export function isSupportedAudioType(filename: string, mimeType: string) {
  const extension = extensionOf(filename);
  return supportedUploadedAudioFormats.some(
    (format) =>
      format.mimeType === mimeType &&
      (format.extensions as readonly string[]).includes(extension),
  );
}

export function normalizeDisplayFilename(filename: string) {
  const normalized = filename
    .normalize("NFKC")
    .replace(/[\\/\u0000-\u001f\u007f]/gu, "_")
    .replace(/\s+/gu, " ")
    .trim();
  return (normalized || "audio").slice(0, 180);
}

export function isValidAudioSignature(mimeType: string, bytes: Uint8Array) {
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.slice(start, end));
  if (mimeType === "audio/wav" || mimeType === "audio/x-wav")
    return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE";
  if (mimeType === "audio/mpeg")
    return (
      ascii(0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
    );
  if (mimeType === "audio/mp4") return ascii(4, 8) === "ftyp";
  if (mimeType === "audio/ogg") return ascii(0, 4) === "OggS";
  if (mimeType === "audio/flac") return ascii(0, 4) === "fLaC";
  if (mimeType === "audio/webm")
    return (
      bytes[0] === 0x1a &&
      bytes[1] === 0x45 &&
      bytes[2] === 0xdf &&
      bytes[3] === 0xa3
    );
  return false;
}
