export type TranscriptSchedulerHandle = Readonly<{ id: number }>;

export interface TranscriptScheduler {
  now(): number;
  schedule(callback: () => void, delayMs: number): TranscriptSchedulerHandle;
  cancel(handle: TranscriptSchedulerHandle): void;
}

export class BrowserTranscriptScheduler implements TranscriptScheduler {
  private nextId = 1;
  private readonly handles = new Map<
    number,
    ReturnType<typeof globalThis.setTimeout>
  >();

  now() {
    return Date.now();
  }

  schedule(callback: () => void, delayMs: number) {
    const id = this.nextId++;
    const timeout = globalThis.setTimeout(() => {
      this.handles.delete(id);
      callback();
    }, delayMs);
    this.handles.set(id, timeout);
    return Object.freeze({ id });
  }

  cancel(handle: TranscriptSchedulerHandle) {
    const timeout = this.handles.get(handle.id);
    if (timeout === undefined) return;
    globalThis.clearTimeout(timeout);
    this.handles.delete(handle.id);
  }
}
