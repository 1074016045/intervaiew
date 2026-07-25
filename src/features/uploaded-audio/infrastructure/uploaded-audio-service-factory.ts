import "server-only";
import { getServerEnv } from "@/infrastructure/env/server-env";
import { UploadedAudioService } from "../application/uploaded-audio-service";
import { UploadedAudioError } from "../domain/uploaded-audio-error";
import { FilesystemUploadedAudioStorage } from "./filesystem/filesystem-uploaded-audio-storage";
import { SqliteUploadedAudioRepository } from "./sqlite/sqlite-uploaded-audio-repository";
import { SqliteTranscriptionJobQueue } from "./sqlite/sqlite-transcription-job-queue";

export function createUploadedAudioService(options?: {
  ignoreEnabled?: boolean;
}) {
  const env = getServerEnv();
  if (!env.UPLOADED_AUDIO_ENABLED && !options?.ignoreEnabled)
    throw new UploadedAudioError(
      "UPLOADED_AUDIO_DISABLED",
      "Uploaded Audio is disabled on this server.",
    );
  const repository = new SqliteUploadedAudioRepository();
  return new UploadedAudioService(
    repository,
    new FilesystemUploadedAudioStorage(env.UPLOADED_AUDIO_PATH),
    new SqliteTranscriptionJobQueue(),
    env.UPLOADED_AUDIO_MAX_BYTES,
    process.env.NODE_ENV !== "production" &&
      env.UPLOADED_AUDIO_TRANSCRIPTION_WORKER_ENABLED &&
      env.UPLOADED_AUDIO_FAKE_TRANSCRIPTION_ENABLED,
  );
}
