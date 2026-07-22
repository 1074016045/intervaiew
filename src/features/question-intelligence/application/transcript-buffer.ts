import {
  immutableTranscriptChunk,
  transcriptChunkSchema,
  type TranscriptBufferSnapshot,
  type TranscriptChunk,
  type TranscriptStreamState,
} from "../domain/transcript";

export type TranscriptBufferResult =
  | Readonly<{ kind: "accepted"; chunk: Readonly<TranscriptChunk> }>
  | Readonly<{ kind: "duplicate"; chunk: Readonly<TranscriptChunk> }>
  | Readonly<{
      kind: "sequence-conflict";
      chunk: Readonly<TranscriptChunk>;
      existingProviderChunkId: string;
    }>
  | Readonly<{ kind: "stale-interim"; chunk: Readonly<TranscriptChunk> }>;

export class TranscriptBuffer {
  private readonly finalByProviderId = new Map<string, TranscriptChunk>();
  private readonly finalBySequence = new Map<number, TranscriptChunk>();
  private interim: TranscriptChunk | null = null;
  private state: TranscriptStreamState = "idle";
  private lastActivityAt: number | null = null;
  private latestSequence: number | null = null;

  receive(rawChunk: TranscriptChunk): TranscriptBufferResult {
    const chunk = transcriptChunkSchema.parse(rawChunk);
    const immutable = immutableTranscriptChunk(chunk);
    if (chunk.isFinal) return this.receiveFinal(chunk, immutable);
    return this.receiveInterim(chunk, immutable);
  }

  setState(state: TranscriptStreamState, activityAt?: number) {
    this.state = state;
    if (activityAt !== undefined)
      this.lastActivityAt = Math.max(this.lastActivityAt ?? 0, activityAt);
  }

  reset() {
    this.finalByProviderId.clear();
    this.finalBySequence.clear();
    this.interim = null;
    this.state = "idle";
    this.lastActivityAt = null;
    this.latestSequence = null;
  }

  snapshot(): TranscriptBufferSnapshot {
    const finals = [...this.finalBySequence.values()]
      .sort((left, right) => left.sequence - right.sequence)
      .map(immutableTranscriptChunk);
    return Object.freeze({
      finalizedText: finals.map((chunk) => chunk.text).join(" "),
      interimText: this.interim?.text ?? "",
      recentFinalChunks: Object.freeze(finals.slice(-20)),
      lastActivityAt: this.lastActivityAt,
      latestSequence: this.latestSequence,
      state: this.state,
    });
  }

  private receiveFinal(
    chunk: TranscriptChunk,
    immutable: Readonly<TranscriptChunk>,
  ): TranscriptBufferResult {
    const providerDuplicate = this.finalByProviderId.get(chunk.providerChunkId);
    if (providerDuplicate)
      return {
        kind: "duplicate",
        chunk: immutableTranscriptChunk(providerDuplicate),
      };
    const sequenceDuplicate = this.finalBySequence.get(chunk.sequence);
    if (sequenceDuplicate)
      return {
        kind: "sequence-conflict",
        chunk: immutable,
        existingProviderChunkId: sequenceDuplicate.providerChunkId,
      };
    this.finalByProviderId.set(chunk.providerChunkId, chunk);
    this.finalBySequence.set(chunk.sequence, chunk);
    if (
      this.interim &&
      (this.interim.providerChunkId === chunk.providerChunkId ||
        this.interim.sequence <= chunk.sequence)
    )
      this.interim = null;
    this.trackActivity(chunk);
    return { kind: "accepted", chunk: immutable };
  }

  private receiveInterim(
    chunk: TranscriptChunk,
    immutable: Readonly<TranscriptChunk>,
  ): TranscriptBufferResult {
    if (
      this.finalByProviderId.has(chunk.providerChunkId) ||
      this.finalBySequence.has(chunk.sequence)
    )
      return { kind: "stale-interim", chunk: immutable };
    if (this.interim) {
      if (chunk.sequence < this.interim.sequence)
        return { kind: "stale-interim", chunk: immutable };
      if (
        chunk.sequence === this.interim.sequence &&
        chunk.providerChunkId !== this.interim.providerChunkId
      )
        return {
          kind: "sequence-conflict",
          chunk: immutable,
          existingProviderChunkId: this.interim.providerChunkId,
        };
      if (
        chunk.sequence === this.interim.sequence &&
        chunk.createdAt < this.interim.createdAt
      )
        return { kind: "stale-interim", chunk: immutable };
    }
    this.interim = chunk;
    this.trackActivity(chunk);
    return { kind: "accepted", chunk: immutable };
  }

  private trackActivity(chunk: TranscriptChunk) {
    this.lastActivityAt = Math.max(this.lastActivityAt ?? 0, chunk.createdAt);
    this.latestSequence = Math.max(this.latestSequence ?? 0, chunk.sequence);
  }
}
