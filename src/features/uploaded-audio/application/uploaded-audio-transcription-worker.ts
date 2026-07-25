import { ZodError } from "zod";
import { TranscriptIngestionService } from "@/features/question-intelligence/application/transcript-ingestion-service";
import { QuestionIntelligenceError } from "@/features/question-intelligence/domain/question-intelligence-error";
import {
  AudioTranscriptionProviderError,
  type AudioTranscriptionProvider,
} from "./audio-transcription-provider.port";
import type { TranscriptionJobQueuePort } from "./transcription-job-queue.port";
import type { UploadedAudioStoragePort } from "./uploaded-audio-storage.port";
import { transcriptionChunkSchema } from "../domain/uploaded-audio";
import { UploadedAudioError } from "../domain/uploaded-audio-error";

export type WorkerTimerPort = Readonly<{
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}>;

export type UploadedAudioWorkerOptions = Readonly<{
  providerTimeoutMs?: number;
}>;

export const uploadedAudioWorkerPolicy = Object.freeze({
  idlePollMs: 1_000,
  leaseDurationMs: 120_000,
  providerTimeoutMs: 90_000,
  maximumAttempts: 3,
  retryDelaysMs: Object.freeze([1_000, 5_000]),
  maximumRetryDelayMs: 30_000,
  expiredRecoveryBatchMaximum: 25,
  immediateContinuationMaximum: 10,
});

const defaultTimers: WorkerTimerPort = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) =>
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class UploadedAudioTranscriptionWorker {
  private iteration: Promise<boolean> | null = null;
  private scheduled: unknown | null = null;
  private activeAbort: AbortController | null = null;
  private activeAttemptTimer: unknown | null = null;
  private stopActiveAttempt: (() => void) | null = null;
  private started = false;
  private immediateContinuations = 0;
  private lifecycleGeneration = 0;
  private stopGeneration = 0;

  constructor(
    private readonly repository: TranscriptionJobQueuePort,
    private readonly storage: UploadedAudioStoragePort,
    private readonly provider: AudioTranscriptionProvider,
    private readonly ingestion: TranscriptIngestionService,
    private readonly now: () => number = () => Date.now(),
    private readonly createId: () => string = () => crypto.randomUUID(),
    private readonly timers: WorkerTimerPort = defaultTimers,
    private readonly options: UploadedAudioWorkerOptions = {},
  ) {}

  runOneIteration(): Promise<boolean> {
    return this.runIteration(null);
  }

  private runIteration(generation: number | null): Promise<boolean> {
    if (this.iteration) return this.iteration;
    this.iteration = this.performOneIteration(generation).finally(() => {
      this.iteration = null;
    });
    return this.iteration;
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.lifecycleGeneration += 1;
    this.schedule(0, this.lifecycleGeneration);
  }

  stop() {
    this.started = false;
    this.lifecycleGeneration += 1;
    this.stopGeneration += 1;
    this.immediateContinuations = 0;
    if (this.scheduled !== null) {
      this.timers.clearTimeout(this.scheduled);
      this.scheduled = null;
    }
    this.activeAbort?.abort();
    if (this.activeAttemptTimer !== null) {
      this.timers.clearTimeout(this.activeAttemptTimer);
      this.activeAttemptTimer = null;
    }
    this.stopActiveAttempt?.();
  }

  private schedule(delayMs: number, generation: number) {
    if (
      !this.started ||
      generation !== this.lifecycleGeneration ||
      this.scheduled !== null
    )
      return;
    this.scheduled = this.timers.setTimeout(() => {
      this.scheduled = null;
      if (!this.lifecycleIsCurrent(generation)) return;
      void this.runIteration(generation)
        .then((worked) => {
          if (!this.lifecycleIsCurrent(generation)) return;
          if (
            worked &&
            this.immediateContinuations <
              uploadedAudioWorkerPolicy.immediateContinuationMaximum
          ) {
            this.immediateContinuations += 1;
            this.schedule(0, generation);
          } else {
            this.immediateContinuations = 0;
            this.schedule(uploadedAudioWorkerPolicy.idlePollMs, generation);
          }
        })
        .catch(() => {
          if (!this.lifecycleIsCurrent(generation)) return;
          this.immediateContinuations = 0;
          this.schedule(uploadedAudioWorkerPolicy.idlePollMs, generation);
        });
    }, delayMs);
  }

  private lifecycleIsCurrent(generation: number | null) {
    return (
      generation === null ||
      (this.started && generation === this.lifecycleGeneration)
    );
  }

  private iterationIsCurrent(
    generation: number | null,
    stopGeneration: number,
  ) {
    return (
      stopGeneration === this.stopGeneration &&
      this.lifecycleIsCurrent(generation)
    );
  }

  private async performOneIteration(generation: number | null) {
    const stopGeneration = this.stopGeneration;
    const claimAt = this.now();
    this.repository.recoverExpired({
      now: claimAt,
      limit: uploadedAudioWorkerPolicy.expiredRecoveryBatchMaximum,
    });
    const job = this.repository.claimNext({
      now: claimAt,
      leaseToken: this.createId(),
      leaseDurationMs: uploadedAudioWorkerPolicy.leaseDurationMs,
    });
    if (!job) return false;

    try {
      const bytes = await this.storage.read(job.relativePath);
      if (!this.iterationIsCurrent(generation, stopGeneration)) return true;
      const controller = new AbortController();
      this.activeAbort = controller;
      const providerTimeoutMs =
        this.options.providerTimeoutMs ??
        uploadedAudioWorkerPolicy.providerTimeoutMs;
      let settleAttempt!: (kind: "timeout" | "stopped") => void;
      const attemptEnd = new Promise<
        Readonly<{ kind: "timeout" }> | Readonly<{ kind: "stopped" }>
      >(
        (resolve) => {
          settleAttempt = (kind) => resolve({ kind });
        },
      );
      const timeout = this.timers.setTimeout(() => {
        controller.abort();
        settleAttempt("timeout");
      }, providerTimeoutMs);
      this.activeAttemptTimer = timeout;
      this.stopActiveAttempt = () => settleAttempt("stopped");
      const providerOutcome = Promise.resolve()
        .then(() =>
          this.provider.transcribe({
            assetId: job.assetId,
            speakerRole: job.speakerRole,
            mimeType: job.mimeType,
            bytes,
            signal: controller.signal,
          }),
        )
        .then(
          (chunks) => ({ kind: "success" as const, chunks }),
          (error: unknown) => ({ kind: "failure" as const, error }),
        );
      let providerChunks;
      try {
        const outcome = await Promise.race([providerOutcome, attemptEnd]);
        if (outcome.kind === "stopped") return true;
        if (outcome.kind === "timeout")
          throw new AudioTranscriptionProviderError(
            "UPLOADED_AUDIO_PROVIDER_TIMEOUT",
            true,
            "The transcription provider attempt timed out.",
          );
        if (outcome.kind === "failure") throw outcome.error;
        providerChunks = outcome.chunks;
      } finally {
        this.timers.clearTimeout(timeout);
        if (this.activeAttemptTimer === timeout) this.activeAttemptTimer = null;
        this.stopActiveAttempt = null;
        if (this.activeAbort === controller) this.activeAbort = null;
      }

      if (!this.iterationIsCurrent(generation, stopGeneration)) return true;
      const chunks = providerChunks.map((chunk) =>
        transcriptionChunkSchema.parse(chunk),
      );
      if (!chunks.length || chunks.length > 50)
        throw new AudioTranscriptionProviderError(
          "UPLOADED_AUDIO_PROVIDER_INVALID_CHUNKS",
          false,
          "The transcription provider returned invalid final chunks.",
        );
      this.ingestion.ingestUploadedAudio(job.analysisSessionId, {
        jobId: job.id,
        leaseToken: job.leaseToken,
        assetId: job.assetId,
        actionId: job.actionId,
        providerLabel: this.provider.label,
        speakerRole: job.speakerRole,
        chunks,
        createdAt: this.now(),
      });
    } catch (error) {
      if (!this.iterationIsCurrent(generation, stopGeneration)) return true;
      const failure = this.classifyFailure(error);
      const retryDelay = failure.retryable
        ? uploadedAudioWorkerPolicy.retryDelaysMs[job.attemptCount - 1]
        : undefined;
      const failureAt = this.now();
      this.repository.fail({
        jobId: job.id,
        leaseToken: job.leaseToken,
        now: failureAt,
        safeErrorCode: failure.safeCode,
        retryAt:
          retryDelay !== undefined && job.attemptCount < job.maximumAttempts
            ? failureAt +
              Math.min(
                retryDelay,
                uploadedAudioWorkerPolicy.maximumRetryDelayMs,
              )
            : null,
      });
    }
    return true;
  }

  private classifyFailure(error: unknown) {
    if (error instanceof AudioTranscriptionProviderError)
      return { safeCode: error.safeCode.slice(0, 80), retryable: error.retryable };
    if (error instanceof ZodError)
      return {
        safeCode: "UPLOADED_AUDIO_PROVIDER_INVALID_CHUNKS",
        retryable: false,
      };
    if (error instanceof UploadedAudioError)
      return { safeCode: error.code.slice(0, 80), retryable: false };
    if (error instanceof QuestionIntelligenceError)
      return {
        safeCode: "UPLOADED_AUDIO_COMPLETION_REJECTED",
        retryable: false,
      };
    return {
      safeCode: "UPLOADED_AUDIO_TRANSCRIPTION_FAILED",
      retryable: false,
    };
  }
}
