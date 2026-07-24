import {
  AudioTranscriptionProviderError,
  type AudioTranscriptionProvider,
} from "../../application/audio-transcription-provider.port";
import { UploadedAudioError } from "../../domain/uploaded-audio-error";

export type FakeAudioTranscriptionFailureMode =
  "never" | "once-per-asset" | "always";

export class FakeAudioTranscriptionProvider implements AudioTranscriptionProvider {
  readonly label = "fake-uploaded-audio-v0.5";
  private readonly attempts = new Map<string, number>();

  constructor(
    failure:
      | FakeAudioTranscriptionFailureMode
      | Readonly<{
          failureMode?: FakeAudioTranscriptionFailureMode;
          delayMs?: number;
          setTimeout?: (callback: () => void, delayMs: number) => unknown;
          clearTimeout?: (handle: unknown) => void;
        }> = "never",
  ) {
    this.failureMode = typeof failure === "string" ? failure : (failure.failureMode ?? "never");
    this.delayMs = typeof failure === "string" ? 0 : (failure.delayMs ?? 0);
    this.schedule =
      typeof failure === "string"
        ? (callback, delayMs) => globalThis.setTimeout(callback, delayMs)
        : (failure.setTimeout ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs)));
    this.cancel =
      typeof failure === "string"
        ? (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>)
        : (failure.clearTimeout ?? ((handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>)));
  }

  private readonly failureMode: FakeAudioTranscriptionFailureMode;
  private readonly delayMs: number;
  private readonly schedule: (callback: () => void, delayMs: number) => unknown;
  private readonly cancel: (handle: unknown) => void;

  async transcribe(
    input: Parameters<AudioTranscriptionProvider["transcribe"]>[0],
  ) {
    if (input.signal.aborted)
      throw new AudioTranscriptionProviderError(
        "UPLOADED_AUDIO_TRANSCRIPTION_ABORTED",
        true,
        "The deterministic Fake transcription was aborted.",
      );
    if (this.delayMs > 0)
      await new Promise<void>((resolve, reject) => {
        const handle = this.schedule(done, this.delayMs);
        const abort = () => {
          this.cancel(handle);
          input.signal.removeEventListener("abort", abort);
          reject(
            new AudioTranscriptionProviderError(
              "UPLOADED_AUDIO_TRANSCRIPTION_ABORTED",
              true,
              "The deterministic Fake transcription was aborted.",
            ),
          );
        };
        function done() {
          input.signal.removeEventListener("abort", abort);
          resolve();
        }
        input.signal.addEventListener("abort", abort, { once: true });
      });
    const attempt = (this.attempts.get(input.assetId) ?? 0) + 1;
    this.attempts.set(input.assetId, attempt);
    if (
      this.failureMode === "always" ||
      (this.failureMode === "once-per-asset" && attempt === 1)
    )
      throw new AudioTranscriptionProviderError(
        "UPLOADED_AUDIO_PROVIDER_TEMPORARY",
        true,
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
