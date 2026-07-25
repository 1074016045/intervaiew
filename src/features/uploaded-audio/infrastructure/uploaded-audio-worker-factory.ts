import "server-only";
import { TranscriptIngestionService } from "@/features/question-intelligence/application/transcript-ingestion-service";
import { SqliteAnalysisRepository } from "@/features/question-intelligence/infrastructure/sqlite/sqlite-analysis-repository";
import { getServerEnv } from "@/infrastructure/env/server-env";
import { UploadedAudioTranscriptionWorker } from "../application/uploaded-audio-transcription-worker";
import { FakeAudioTranscriptionProvider } from "./fake/fake-audio-transcription-provider";
import { FilesystemUploadedAudioStorage } from "./filesystem/filesystem-uploaded-audio-storage";
import { SqliteTranscriptionJobQueue } from "./sqlite/sqlite-transcription-job-queue";

export function uploadedAudioWorkerIsExplicitlyEnabled() {
  const env = getServerEnv();
  return (
    typeof process !== "undefined" &&
    process.release?.name === "node" &&
    process.env.NODE_ENV !== "production" &&
    env.UPLOADED_AUDIO_ENABLED &&
    env.UPLOADED_AUDIO_TRANSCRIPTION_WORKER_ENABLED &&
    env.UPLOADED_AUDIO_FAKE_TRANSCRIPTION_ENABLED
  );
}

export function createUploadedAudioTranscriptionWorker() {
  const env = getServerEnv();
  return new UploadedAudioTranscriptionWorker(
    new SqliteTranscriptionJobQueue(),
    new FilesystemUploadedAudioStorage(env.UPLOADED_AUDIO_PATH),
    new FakeAudioTranscriptionProvider(),
    new TranscriptIngestionService(new SqliteAnalysisRepository()),
  );
}
