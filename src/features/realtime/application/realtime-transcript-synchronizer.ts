import type { RealtimeTranscriptEvent } from "../domain/realtime.types";

export type PersistFinalTranscript = (input: {
  providerItemId: string;
  answer: string;
}) => Promise<void>;

export class RealtimeTranscriptSynchronizer {
  private readonly persisted = new Set<string>();
  private interim = "";

  constructor(private readonly persist: PersistFinalTranscript) {}

  getInterim() {
    return this.interim;
  }

  hasPersisted(providerItemId: string) {
    return this.persisted.has(providerItemId);
  }

  async receive(event: RealtimeTranscriptEvent) {
    if (event.role !== "candidate") return false;
    const text = event.text.trim();
    if (!text) return false;
    if (!event.isFinal) {
      this.interim = text;
      return false;
    }
    if (this.persisted.has(event.providerItemId)) return false;
    await this.persist({ providerItemId: event.providerItemId, answer: text });
    this.persisted.add(event.providerItemId);
    this.interim = "";
    return true;
  }
}
