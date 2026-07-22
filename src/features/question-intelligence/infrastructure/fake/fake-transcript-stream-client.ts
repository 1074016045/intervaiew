import type {
  TranscriptStreamClient,
  TranscriptStreamEvent,
  TranscriptStreamListener,
} from "../../application/transcript-stream-client.port";
import {
  transcriptChunkSchema,
  type TranscriptStreamState,
} from "../../domain/transcript";
import type { FakeTranscriptScenarioEvent } from "./fake-transcript-scenarios";
import {
  BrowserTranscriptScheduler,
  type TranscriptScheduler,
  type TranscriptSchedulerHandle,
} from "./transcript-scheduler";

export class FakeTranscriptStreamClient implements TranscriptStreamClient {
  private readonly listeners = new Set<TranscriptStreamListener>();
  private readonly scenario: ReadonlyArray<FakeTranscriptScenarioEvent>;
  private state: TranscriptStreamState = "idle";
  private currentIndex = 0;
  private elapsedMs = 0;
  private runningSince = 0;
  private timer: TranscriptSchedulerHandle | null = null;
  private disposed = false;

  constructor(
    scenario: ReadonlyArray<FakeTranscriptScenarioEvent>,
    private readonly scheduler: TranscriptScheduler = new BrowserTranscriptScheduler(),
  ) {
    this.scenario = Object.freeze(
      [...scenario]
        .map((event) => {
          if (!Number.isFinite(event.atMs) || event.atMs < 0)
            throw new Error("Fake scenario time must be non-negative.");
          return event.type === "transcript"
            ? Object.freeze({
                ...event,
                chunk: transcriptChunkSchema.parse(event.chunk),
              })
            : Object.freeze({ ...event });
        })
        .sort((left, right) => left.atMs - right.atMs),
    );
  }

  async start() {
    if (this.disposed) throw new Error("The transcript stream was disposed.");
    if (
      this.state === "starting" ||
      this.state === "streaming" ||
      this.state === "paused"
    )
      return;
    if (this.state !== "idle")
      throw new Error(
        "Reset with a new transcript stream before starting again.",
      );
    this.setState("starting");
    this.runningSince = this.scheduler.now();
    this.setState("streaming");
    this.scheduleNext();
  }

  async pause() {
    if (this.disposed || this.state !== "streaming") return;
    this.elapsedMs += Math.max(0, this.scheduler.now() - this.runningSince);
    this.clearTimer();
    this.setState("paused");
  }

  async resume() {
    if (this.disposed || this.state !== "paused") return;
    this.runningSince = this.scheduler.now();
    this.setState("streaming");
    this.scheduleNext();
  }

  async stop() {
    if (this.disposed || this.state === "stopped") return;
    this.clearTimer();
    if (this.state !== "failed") this.setState("stopped");
  }

  async dispose() {
    if (this.disposed) return;
    this.clearTimer();
    if (this.state !== "failed" && this.state !== "stopped")
      this.setState("stopped");
    this.listeners.clear();
    this.disposed = true;
  }

  getState() {
    return this.state;
  }

  subscribe(listener: TranscriptStreamListener) {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.listeners.delete(listener);
    };
  }

  private scheduleNext() {
    if (this.state !== "streaming" || this.currentIndex >= this.scenario.length)
      return;
    const next = this.scenario[this.currentIndex];
    const delayMs = Math.max(0, next.atMs - this.elapsedMs);
    this.timer = this.scheduler.schedule(() => {
      this.timer = null;
      if (this.state !== "streaming" || this.disposed) return;
      this.elapsedMs = next.atMs;
      this.runningSince = this.scheduler.now();
      this.currentIndex += 1;
      if (next.type === "failure") {
        this.setState("failed");
        this.emit({
          type: "failure",
          code: next.code,
          message: next.message,
        });
        return;
      }
      this.emit({ type: "transcript", chunk: { ...next.chunk } });
      this.scheduleNext();
    }, delayMs);
  }

  private clearTimer() {
    if (!this.timer) return;
    this.scheduler.cancel(this.timer);
    this.timer = null;
  }

  private setState(state: TranscriptStreamState) {
    this.state = state;
    this.emit({ type: "state", state });
  }

  private emit(event: TranscriptStreamEvent) {
    for (const listener of [...this.listeners]) listener(event);
  }
}
