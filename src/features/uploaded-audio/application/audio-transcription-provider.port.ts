import type {
  TranscriptionChunk,
  UploadedAudioSpeakerRole,
} from "../domain/uploaded-audio";

export interface AudioTranscriptionProvider {
  readonly label: string;
  transcribe(
    input: Readonly<{
      assetId: string;
      speakerRole: UploadedAudioSpeakerRole;
      mimeType: string;
      bytes: Uint8Array;
      signal: AbortSignal;
    }>,
  ): Promise<ReadonlyArray<TranscriptionChunk>>;
}

export class AudioTranscriptionProviderError extends Error {
  constructor(
    public readonly safeCode: string,
    public readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = "AudioTranscriptionProviderError";
  }
}
