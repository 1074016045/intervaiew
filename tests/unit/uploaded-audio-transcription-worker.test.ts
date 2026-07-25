import { describe, expect, it, vi } from "vitest";
import type { AudioTranscriptionProvider } from "@/features/uploaded-audio/application/audio-transcription-provider.port";
import type {
  ClaimedTranscriptionJob,
  TranscriptionJobQueuePort,
} from "@/features/uploaded-audio/application/transcription-job-queue.port";
import type { UploadedAudioStoragePort } from "@/features/uploaded-audio/application/uploaded-audio-storage.port";
import {
  UploadedAudioTranscriptionWorker,
  type WorkerTimerPort,
} from "@/features/uploaded-audio/application/uploaded-audio-transcription-worker";
import type { TranscriptIngestionService } from "@/features/question-intelligence/application/transcript-ingestion-service";
import { initializeUploadedAudioWorker } from "@/features/uploaded-audio/infrastructure/uploaded-audio-worker-registration";
import { register } from "@/instrumentation";

const jobId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const assetId = "33333333-3333-4333-8333-333333333333";
const actionId = "44444444-4444-4444-8444-444444444444";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class ManualTimers implements WorkerTimerPort {
  private nextId = 1;
  readonly pending = new Map<number, { callback: () => void; delayMs: number }>();

  setTimeout(callback: () => void, delayMs: number) {
    const id = this.nextId++;
    this.pending.set(id, { callback, delayMs });
    return id;
  }

  clearTimeout(handle: unknown) {
    this.pending.delete(handle as number);
  }

  run(delayMs: number) {
    const entry = [...this.pending.entries()].find(
      ([, timer]) => timer.delayMs === delayMs,
    );
    if (!entry) throw new Error(`No ${delayMs}ms timer was scheduled.`);
    this.pending.delete(entry[0]);
    entry[1].callback();
  }
}

function claimed(attemptCount = 1): ClaimedTranscriptionJob {
  return Object.freeze({
    id: jobId,
    analysisSessionId: sessionId,
    assetId,
    actionId,
    status: "running",
    attemptCount,
    maximumAttempts: 3,
    availableAt: 10_000,
    leaseToken: `lease-${attemptCount}`,
    leaseExpiresAt: 130_000,
    startedAt: 10_000,
    completedAt: null,
    failedAt: null,
    cancelledAt: null,
    safeErrorCode: null,
    createdAt: 9_000,
    updatedAt: 10_000,
    relativePath: `${sessionId}/${assetId}.wav`,
    mimeType: "audio/wav",
    speakerRole: "interviewer",
  });
}

function harness(options?: {
  job?: ClaimedTranscriptionJob | null;
  provider?: AudioTranscriptionProvider;
  storageRead?: () => Promise<Uint8Array>;
  clock?: () => number;
}) {
  const failures: Array<Parameters<TranscriptionJobQueuePort["fail"]>[0]> = [];
  let nextJob: ClaimedTranscriptionJob | null =
    options && "job" in options ? (options.job ?? null) : claimed();
  const repository: TranscriptionJobQueuePort = {
    enqueue: vi.fn(),
    recoverExpired: vi.fn(() => 0),
    claimNext: vi.fn(() => {
      const result = nextJob;
      nextJob = null;
      return result;
    }),
    fail: vi.fn((input) => {
      failures.push(input);
      return { kind: "stale" } as const;
    }),
  };
  const storage: UploadedAudioStoragePort = {
    write: vi.fn(),
    read: vi.fn(options?.storageRead ?? (async () => new Uint8Array([1]))),
    delete: vi.fn(),
    createTombstoneRelativePath: vi.fn(),
    stageDelete: vi.fn(),
    finalizeDelete: vi.fn(),
    rollbackDelete: vi.fn(),
  };
  const provider: AudioTranscriptionProvider =
    options?.provider ??
    ({
      label: "unit-provider",
      transcribe: vi.fn(async () => [
        { text: "final", startMs: 0, endMs: 10 },
      ]),
    } satisfies AudioTranscriptionProvider);
  const ingested: unknown[] = [];
  const ingestion = {
    ingestUploadedAudio: vi.fn((_sessionId: string, input: unknown) => {
      ingested.push(input);
      return { kind: "created", segments: [] };
    }),
  } as unknown as TranscriptIngestionService;
  const timers = new ManualTimers();
  const worker = new UploadedAudioTranscriptionWorker(
    repository,
    storage,
    provider,
    ingestion,
    options?.clock ?? (() => 10_000),
    () => "lease-id",
    timers,
    { providerTimeoutMs: 50 },
  );
  return { failures, ingested, provider, repository, storage, timers, worker };
}

async function flush() {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

describe("UploadedAudioTranscriptionWorker bounded attempts", () => {
  it("aborts an observing provider and requeues when the bounded timeout fires", async () => {
    let observedSignal: AbortSignal | undefined;
    const provider: AudioTranscriptionProvider = {
      label: "observing-provider",
      transcribe: vi.fn(({ signal }) => {
        observedSignal = signal;
        return new Promise<ReadonlyArray<never>>((_, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        });
      }),
    };
    const test = harness({ provider });
    const iteration = test.worker.runOneIteration();
    await flush();
    expect(observedSignal?.aborted).toBe(false);
    test.timers.run(50);
    await expect(iteration).resolves.toBe(true);
    expect(observedSignal?.aborted).toBe(true);
    expect(test.failures).toEqual([
      expect.objectContaining({
        safeErrorCode: "UPLOADED_AUDIO_PROVIDER_TIMEOUT",
        now: 10_000,
        retryAt: 11_000,
      }),
    ]);
  });

  it("settles when a provider ignores AbortSignal and never resolves", async () => {
    const provider: AudioTranscriptionProvider = {
      label: "non-cooperative-provider",
      transcribe: vi.fn(
        () => new Promise<ReadonlyArray<never>>(() => undefined),
      ),
    };
    const test = harness({ provider });
    const iteration = test.worker.runOneIteration();
    await flush();
    test.timers.run(50);
    await expect(iteration).resolves.toBe(true);
    expect(test.timers.pending.size).toBe(0);
    expect(test.ingested).toHaveLength(0);
  });

  it("never commits provider success that arrives after timeout", async () => {
    const late = deferred<ReadonlyArray<{ text: string; startMs: number; endMs: number }>>();
    const test = harness({
      provider: { label: "late-provider", transcribe: vi.fn(() => late.promise) },
    });
    const iteration = test.worker.runOneIteration();
    await flush();
    test.timers.run(50);
    await iteration;
    late.resolve([{ text: "too late", startMs: 0, endMs: 1 }]);
    await flush();
    expect(test.ingested).toHaveLength(0);
  });

  it("absorbs a provider rejection that arrives after timeout", async () => {
    const late = deferred<ReadonlyArray<{ text: string; startMs: number; endMs: number }>>();
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const test = harness({
        provider: { label: "late-provider", transcribe: vi.fn(() => late.promise) },
      });
      const iteration = test.worker.runOneIteration();
      await flush();
      test.timers.run(50);
      await iteration;
      late.reject(new Error("late rejection"));
      await flush();
      expect(unhandled).not.toHaveBeenCalled();
      expect(test.ingested).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("derives first and second retry timestamps from one clock read", async () => {
    for (const [attemptCount, expectedDelay] of [
      [1, 1_000],
      [2, 5_000],
    ] as const) {
      let clock = 20_000;
      const test = harness({
        job: claimed(attemptCount),
        clock: () => clock++,
        provider: {
          label: "retryable-provider",
          transcribe: vi.fn(async () => {
            const { AudioTranscriptionProviderError } = await import(
              "@/features/uploaded-audio/application/audio-transcription-provider.port"
            );
            throw new AudioTranscriptionProviderError("SAFE_RETRY", true, "retry");
          }),
        },
      });
      await test.worker.runOneIteration();
      const failure = test.failures[0];
      expect(failure).toBeDefined();
      expect(failure!.retryAt! - failure!.now).toBe(expectedDelay);
    }
  });

  it("stops retrying a timeout after the maximum attempt", async () => {
    const test = harness({
      job: claimed(3),
      provider: {
        label: "stuck-provider",
        transcribe: vi.fn(
          () => new Promise<ReadonlyArray<never>>(() => undefined),
        ),
      },
    });
    const iteration = test.worker.runOneIteration();
    await flush();
    test.timers.run(50);
    await iteration;
    expect(test.failures[0]).toMatchObject({
      safeErrorCode: "UPLOADED_AUDIO_PROVIDER_TIMEOUT",
      retryAt: null,
    });
  });
});

describe("UploadedAudioTranscriptionWorker lifecycle", () => {
  it("does not start provider work after stop while storage read is pending", async () => {
    const read = deferred<Uint8Array>();
    const test = harness({ storageRead: () => read.promise });
    test.worker.start();
    test.timers.run(0);
    await flush();
    test.worker.stop();
    read.resolve(new Uint8Array([1]));
    await flush();
    expect(test.provider.transcribe).not.toHaveBeenCalled();
    expect(test.failures).toHaveLength(0);
    expect(test.timers.pending.size).toBe(0);
  });

  it("clears scheduled timers and remains safe across start stop start", async () => {
    const test = harness({ job: null });
    test.worker.start();
    expect(test.timers.pending.size).toBe(1);
    test.worker.stop();
    expect(test.timers.pending.size).toBe(0);
    test.worker.start();
    expect(test.timers.pending.size).toBe(1);
    test.timers.run(0);
    await flush();
    expect(test.repository.claimNext).toHaveBeenCalledTimes(1);
    expect(test.timers.pending.size).toBe(1);
    test.worker.stop();
    expect(test.timers.pending.size).toBe(0);
  });

  it("does not attach overlapping iterations when start is repeated", async () => {
    const read = deferred<Uint8Array>();
    const test = harness({ storageRead: () => read.promise });
    test.worker.start();
    test.worker.start();
    expect(test.timers.pending.size).toBe(1);
    test.timers.run(0);
    await flush();
    test.worker.start();
    expect(test.repository.claimNext).toHaveBeenCalledTimes(1);
    read.resolve(new Uint8Array([1]));
    await flush();
    expect(test.provider.transcribe).toHaveBeenCalledTimes(1);
    test.worker.stop();
  });

  it("clears an active attempt timer and settles non-cooperative work on stop", async () => {
    const test = harness({
      provider: {
        label: "non-cooperative-provider",
        transcribe: vi.fn(
          () => new Promise<ReadonlyArray<never>>(() => undefined),
        ),
      },
    });
    test.worker.start();
    test.timers.run(0);
    await flush();
    expect(test.timers.pending.size).toBe(1);
    test.worker.stop();
    await flush();
    expect(test.timers.pending.size).toBe(0);
    expect(test.failures).toHaveLength(0);
  });
});

describe("uploaded-audio worker registration", () => {
  it("shares one initialization promise across concurrent registration", async () => {
    const loading = deferred<{
      uploadedAudioWorkerIsExplicitlyEnabled(): boolean;
      createUploadedAudioTranscriptionWorker(): { start(): void };
    }>();
    const singleton = {} as typeof globalThis;
    const load = vi.fn(() => loading.promise);
    const start = vi.fn();
    const first = initializeUploadedAudioWorker(load, singleton);
    const second = initializeUploadedAudioWorker(load, singleton);
    loading.resolve({
      uploadedAudioWorkerIsExplicitlyEnabled: () => true,
      createUploadedAudioTranscriptionWorker: () => ({ start }),
    });
    await Promise.all([first, second]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("clears failed initialization so a later registration can succeed", async () => {
    const singleton = {} as typeof globalThis;
    await expect(
      initializeUploadedAudioWorker(
        async () => {
          throw new Error("load failed");
        },
        singleton,
      ),
    ).rejects.toThrow("load failed");
    const start = vi.fn();
    await initializeUploadedAudioWorker(
      async () => ({
        uploadedAudioWorkerIsExplicitlyEnabled: () => true,
        createUploadedAudioTranscriptionWorker: () => ({ start }),
      }),
      singleton,
    );
    expect(start).toHaveBeenCalledOnce();
  });

  it("does not start a timer loop when registration is disabled", async () => {
    const start = vi.fn();
    await initializeUploadedAudioWorker(
      async () => ({
        uploadedAudioWorkerIsExplicitlyEnabled: () => false,
        createUploadedAudioTranscriptionWorker: () => ({ start }),
      }),
      {} as typeof globalThis,
    );
    expect(start).not.toHaveBeenCalled();
  });

  it("is a no-op when process is unavailable or the runtime is unsupported", async () => {
    vi.stubGlobal("process", undefined);
    await expect(register()).resolves.toBeUndefined();
    vi.unstubAllGlobals();
    vi.stubEnv("NEXT_RUNTIME", "edge");
    await expect(register()).resolves.toBeUndefined();
    vi.unstubAllEnvs();
  });
});
