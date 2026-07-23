import { describe, expect, it } from "vitest";
import type {
  AnalysisRepositoryPort,
  IngestFinalResult,
  IngestUploadedFinalsResult,
  UpdateAnalysisSessionResult,
} from "@/features/question-intelligence/application/analysis-repository.port";
import { TranscriptBuffer } from "@/features/question-intelligence/application/transcript-buffer";
import { TranscriptIngestionService } from "@/features/question-intelligence/application/transcript-ingestion-service";
import type {
  AnalysisSessionDetailView,
  AnalysisSessionView,
} from "@/features/question-intelligence/domain/analysis-session";
import {
  transcriptChunkSchema,
  type TranscriptChunk,
} from "@/features/question-intelligence/domain/transcript";

const baseChunk: TranscriptChunk = {
  providerChunkId: "provider-1",
  sourceSessionId: "session-1",
  sequence: 1,
  speakerRole: "interviewer",
  text: "Final question",
  isFinal: true,
  startMs: 0,
  endMs: 100,
  createdAt: 1_700_000_000_000,
};

class StubAnalysisRepository implements AnalysisRepositoryPort {
  result: IngestFinalResult = {
    kind: "created",
    segment: {
      id: "segment-1",
      analysisSessionId: "session-1",
      providerSegmentId: "provider-1",
      sequence: 1,
      speakerRole: "interviewer",
      text: "Final question",
      startMs: 0,
      endMs: 100,
      createdAt: 1_700_000_000_000,
    },
  };
  ingestCalls = 0;

  createSession(): AnalysisSessionView {
    throw new Error("Not used");
  }
  getSession(): AnalysisSessionDetailView | null {
    return null;
  }
  deleteSession() {
    return false;
  }
  updateSessionStatus(): UpdateAnalysisSessionResult {
    return { kind: "session-not-found" };
  }
  ingestFinalChunk() {
    this.ingestCalls += 1;
    return this.result;
  }
  ingestUploadedFinals(): IngestUploadedFinalsResult {
    return { kind: "asset-not-found" };
  }
}

describe("Transcript Lab chunk validation and ingestion", () => {
  it("rejects interim chunks before repository persistence", () => {
    const repository = new StubAnalysisRepository();
    expect(() =>
      new TranscriptIngestionService(repository).ingest("session-1", {
        ...baseChunk,
        isFinal: false,
      }),
    ).toThrow(/Only finalized/);
    expect(repository.ingestCalls).toBe(0);
  });

  it("persists a valid final chunk", () => {
    const repository = new StubAnalysisRepository();
    expect(
      new TranscriptIngestionService(repository).ingest("session-1", baseChunk),
    ).toMatchObject({ duplicated: false, segment: { id: "segment-1" } });
    expect(repository.ingestCalls).toBe(1);
  });

  it("returns duplicate finals idempotently", () => {
    const repository = new StubAnalysisRepository();
    repository.result = {
      kind: "duplicate",
      segment: {
        id: "existing",
        analysisSessionId: "session-1",
        providerSegmentId: "provider-1",
        sequence: 1,
        speakerRole: "interviewer",
        text: "Final question",
        startMs: 0,
        endMs: 100,
        createdAt: baseChunk.createdAt,
      },
    };
    expect(
      new TranscriptIngestionService(repository).ingest("session-1", baseChunk),
    ).toMatchObject({ duplicated: true, segment: { id: "existing" } });
  });

  it("maps duplicate sequence to a stable conflict", () => {
    const repository = new StubAnalysisRepository();
    repository.result = { kind: "sequence-conflict" };
    expect(() =>
      new TranscriptIngestionService(repository).ingest("session-1", baseChunk),
    ).toThrow(/already assigned/);
  });

  it.each([
    ["empty text", { text: "" }],
    ["whitespace-only text", { text: "   " }],
    ["invalid sequence", { sequence: -1 }],
    ["negative start", { startMs: -1 }],
    ["end before start", { startMs: 20, endMs: 10 }],
  ])("rejects %s", (_, change) => {
    expect(() =>
      new TranscriptIngestionService(new StubAnalysisRepository()).ingest(
        "session-1",
        { ...baseChunk, ...change },
      ),
    ).toThrow(/invalid/i);
  });

  it("rejects unknown fields instead of passing them to persistence", () => {
    expect(() =>
      transcriptChunkSchema.parse({ ...baseChunk, providerPayload: "hidden" }),
    ).toThrow();
  });
});

describe("TranscriptBuffer ordering policy", () => {
  it("sorts out-of-order final chunks deterministically", () => {
    const buffer = new TranscriptBuffer();
    buffer.receive({
      ...baseChunk,
      providerChunkId: "two",
      sequence: 2,
      text: "Two",
    });
    buffer.receive({
      ...baseChunk,
      providerChunkId: "zero",
      sequence: 0,
      text: "Zero",
    });
    expect(buffer.snapshot().finalizedText).toBe("Zero Two");
    expect(
      buffer.snapshot().recentFinalChunks.map((chunk) => chunk.sequence),
    ).toEqual([0, 2]);
  });

  it("does not accept a duplicate final provider id twice", () => {
    const buffer = new TranscriptBuffer();
    expect(buffer.receive(baseChunk).kind).toBe("accepted");
    expect(buffer.receive({ ...baseChunk, text: "Changed" }).kind).toBe(
      "duplicate",
    );
    expect(buffer.snapshot().finalizedText).toBe("Final question");
  });

  it("returns an explicit sequence conflict", () => {
    const buffer = new TranscriptBuffer();
    buffer.receive(baseChunk);
    expect(
      buffer.receive({ ...baseChunk, providerChunkId: "different" }).kind,
    ).toBe("sequence-conflict");
  });

  it("prevents an older interim from replacing a newer interim", () => {
    const buffer = new TranscriptBuffer();
    buffer.receive({
      ...baseChunk,
      providerChunkId: "new",
      sequence: 4,
      text: "New",
      isFinal: false,
    });
    expect(
      buffer.receive({
        ...baseChunk,
        providerChunkId: "old",
        sequence: 3,
        text: "Old",
        isFinal: false,
      }).kind,
    ).toBe("stale-interim");
    expect(buffer.snapshot().interimText).toBe("New");
  });

  it("clears only corresponding or older interim on final", () => {
    const buffer = new TranscriptBuffer();
    buffer.receive({
      ...baseChunk,
      providerChunkId: "interim",
      sequence: 1,
      text: "Interim",
      isFinal: false,
    });
    buffer.receive(baseChunk);
    expect(buffer.snapshot().interimText).toBe("");
    buffer.receive({
      ...baseChunk,
      providerChunkId: "future",
      sequence: 4,
      text: "Future",
      isFinal: false,
    });
    buffer.receive({
      ...baseChunk,
      providerChunkId: "middle",
      sequence: 3,
      text: "Middle",
      isFinal: true,
    });
    expect(buffer.snapshot().interimText).toBe("Future");
  });

  it("returns an immutable snapshot and cloned final chunks", () => {
    const buffer = new TranscriptBuffer();
    buffer.receive(baseChunk);
    const snapshot = buffer.snapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.recentFinalChunks)).toBe(true);
    expect(Object.isFrozen(snapshot.recentFinalChunks[0])).toBe(true);
  });
});
