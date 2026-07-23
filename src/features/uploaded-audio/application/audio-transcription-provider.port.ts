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
    }>,
  ): Promise<ReadonlyArray<TranscriptionChunk>>;
}
