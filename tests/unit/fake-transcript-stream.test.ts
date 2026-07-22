import { describe, expect, it, vi } from "vitest";
import { FakeTranscriptStreamClient } from "@/features/question-intelligence/infrastructure/fake/fake-transcript-stream-client";
import type { FakeTranscriptScenarioEvent } from "@/features/question-intelligence/infrastructure/fake/fake-transcript-scenarios";
import type {
  TranscriptScheduler,
  TranscriptSchedulerHandle,
} from "@/features/question-intelligence/infrastructure/fake/transcript-scheduler";

class ManualScheduler implements TranscriptScheduler {
  private time = 1_700_000_000_000;
  private nextId = 1;
  private readonly tasks = new Map<
    number,
    { due: number; callback: () => void }
  >();

  now() {
    return this.time;
  }
  schedule(callback: () => void, delayMs: number) {
    const handle = Object.freeze({ id: this.nextId++ });
    this.tasks.set(handle.id, { due: this.time + delayMs, callback });
    return handle;
  }
  cancel(handle: TranscriptSchedulerHandle) {
    this.tasks.delete(handle.id);
  }
  advance(milliseconds: number) {
    const target = this.time + milliseconds;
    while (true) {
      const next = [...this.tasks.entries()]
        .filter(([, task]) => task.due <= target)
        .sort((left, right) => left[1].due - right[1].due)[0];
      if (!next) break;
      this.tasks.delete(next[0]);
      this.time = next[1].due;
      next[1].callback();
    }
    this.time = target;
  }
  pendingCount() {
    return this.tasks.size;
  }
}

function transcript(atMs: number, sequence = 0): FakeTranscriptScenarioEvent {
  return {
    atMs,
    type: "transcript",
    chunk: {
      providerChunkId: `provider-${sequence}`,
      sourceSessionId: "session",
      sequence,
      speakerRole: "interviewer",
      text: `Chunk ${sequence}`,
      isFinal: sequence > 0,
      startMs: 0,
      endMs: 100,
      createdAt: 1_700_000_000_000 + atMs,
    },
  };
}

describe("FakeTranscriptStreamClient", () => {
  it("pauses without advancing and resumes from the remaining delay", async () => {
    const scheduler = new ManualScheduler();
    const client = new FakeTranscriptStreamClient([transcript(10)], scheduler);
    const listener = vi.fn();
    client.subscribe(listener);
    await client.start();
    scheduler.advance(5);
    await client.pause();
    scheduler.advance(100);
    expect(
      listener.mock.calls.flat().some((event) => event.type === "transcript"),
    ).toBe(false);
    await client.resume();
    scheduler.advance(5);
    expect(
      listener.mock.calls.flat().some((event) => event.type === "transcript"),
    ).toBe(true);
  });

  it("makes stop idempotent and prevents later events", async () => {
    const scheduler = new ManualScheduler();
    const client = new FakeTranscriptStreamClient([transcript(10)], scheduler);
    const listener = vi.fn();
    client.subscribe(listener);
    await client.start();
    await client.stop();
    await client.stop();
    scheduler.advance(20);
    expect(client.getState()).toBe("stopped");
    expect(
      listener.mock.calls.flat().some((event) => event.type === "transcript"),
    ).toBe(false);
  });

  it("makes dispose idempotent and clears every timer", async () => {
    const scheduler = new ManualScheduler();
    const client = new FakeTranscriptStreamClient(
      [transcript(10), transcript(20, 1)],
      scheduler,
    );
    await client.start();
    expect(scheduler.pendingCount()).toBe(1);
    await client.dispose();
    await client.dispose();
    expect(scheduler.pendingCount()).toBe(0);
  });

  it("stops delivering events after unsubscribe", async () => {
    const scheduler = new ManualScheduler();
    const client = new FakeTranscriptStreamClient([transcript(10)], scheduler);
    const listener = vi.fn();
    const unsubscribe = client.subscribe(listener);
    await client.start();
    listener.mockClear();
    unsubscribe();
    scheduler.advance(10);
    expect(listener).not.toHaveBeenCalled();
  });

  it("enters failed state and does not continue the scenario", async () => {
    const scheduler = new ManualScheduler();
    const client = new FakeTranscriptStreamClient(
      [
        {
          atMs: 5,
          type: "failure",
          code: "FAKE_FAILURE",
          message: "Safe failure.",
        },
        transcript(10),
      ],
      scheduler,
    );
    const listener = vi.fn();
    client.subscribe(listener);
    await client.start();
    scheduler.advance(20);
    expect(client.getState()).toBe("failed");
    expect(listener).toHaveBeenCalledWith({
      type: "failure",
      code: "FAKE_FAILURE",
      message: "Safe failure.",
    });
    expect(
      listener.mock.calls.flat().some((event) => event.type === "transcript"),
    ).toBe(false);
    expect(scheduler.pendingCount()).toBe(0);
  });

  it("does not create duplicate streams when start is called twice", async () => {
    const scheduler = new ManualScheduler();
    const client = new FakeTranscriptStreamClient([transcript(10)], scheduler);
    const listener = vi.fn();
    client.subscribe(listener);
    await client.start();
    await client.start();
    expect(scheduler.pendingCount()).toBe(1);
    scheduler.advance(10);
    expect(
      listener.mock.calls.flat().filter((event) => event.type === "transcript"),
    ).toHaveLength(1);
  });
});
