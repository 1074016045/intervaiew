import type { AudioTranscriptionProvider } from "../../application/audio-transcription-provider.port";
import { UploadedAudioError } from "../../domain/uploaded-audio-error";

export type FakeAudioTranscriptionFailureMode =
  "never" | "once-per-asset" | "always";

export class FakeAudioTranscriptionProvider implements AudioTranscriptionProvider {
  readonly label = "fake-uploaded-audio-v0.4";
  private readonly attempts = new Map<string, number>();

  constructor(
    private readonly failureMode: FakeAudioTranscriptionFailureMode = "never",
  ) {}

  async transcribe(
    input: Parameters<AudioTranscriptionProvider["transcribe"]>[0],
  ) {
    const attempt = (this.attempts.get(input.assetId) ?? 0) + 1;
    this.attempts.set(input.assetId, attempt);
    if (
      this.failureMode === "always" ||
      (this.failureMode === "once-per-asset" && attempt === 1)
    )
      throw new UploadedAudioError(
        "UPLOADED_AUDIO_TRANSCRIPTION_FAILED",
        "The deterministic Fake transcription failed as configured.",
      );
    if (!input.bytes.byteLength)
      throw new UploadedAudioError(
        "UPLOADED_AUDIO_TRANSCRIPTION_FAILED",
        "The deterministic Fake transcription received no audio bytes.",
      );
    return input.speakerRole === "interviewer"
      ? Object.freeze([
          Object.freeze({
            text: "Tell me about a project you are proud of?",
            startMs: 0,
            endMs: 1_600,
          }),
          Object.freeze({
            text: "What tradeoffs did you consider?",
            startMs: 1_700,
            endMs: 3_200,
          }),
        ])
      : Object.freeze([
          Object.freeze({
            text: "I led a careful migration and validated each release.",
            startMs: 0,
            endMs: 2_400,
          }),
        ]);
  }

  attemptCount(assetId: string) {
    return this.attempts.get(assetId) ?? 0;
  }
}
