import "server-only";
import { TranscriptIngestionService } from "@/features/question-intelligence/application/transcript-ingestion-service";
import { SqliteAnalysisRepository } from "@/features/question-intelligence/infrastructure/sqlite/sqlite-analysis-repository";
import { getServerEnv } from "@/infrastructure/env/server-env";
import type { AudioTranscriptionProvider } from "../application/audio-transcription-provider.port";
import { UploadedAudioService } from "../application/uploaded-audio-service";
import { UploadedAudioError } from "../domain/uploaded-audio-error";
import { FakeAudioTranscriptionProvider } from "./fake/fake-audio-transcription-provider";
import { FilesystemUploadedAudioStorage } from "./filesystem/filesystem-uploaded-audio-storage";
import { SqliteUploadedAudioRepository } from "./sqlite/sqlite-uploaded-audio-repository";

class DisabledAudioTranscriptionProvider implements AudioTranscriptionProvider {
  readonly label = "disabled";

  async transcribe(): Promise<never> {
    throw new UploadedAudioError(
      "UPLOADED_AUDIO_PROVIDER_DISABLED",
      "Uploaded-audio transcription is disabled on this server.",
    );
  }
}

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
  const provider =
    process.env.NODE_ENV !== "production" &&
    env.UPLOADED_AUDIO_FAKE_TRANSCRIPTION_ENABLED
      ? new FakeAudioTranscriptionProvider()
      : new DisabledAudioTranscriptionProvider();
  return new UploadedAudioService(
    repository,
    new FilesystemUploadedAudioStorage(env.UPLOADED_AUDIO_PATH),
    provider,
    new TranscriptIngestionService(new SqliteAnalysisRepository()),
    env.UPLOADED_AUDIO_MAX_BYTES,
  );
}
