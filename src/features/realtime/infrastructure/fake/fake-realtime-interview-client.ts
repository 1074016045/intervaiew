import type { RealtimeInterviewClient } from "../../application/realtime-interview-client.port";
import { RealtimeSessionController } from "../../application/realtime-session-controller";
import type {
  RealtimeClarificationSpeechInput,
  RealtimeConnectInput,
  RealtimeEvent,
  RealtimeEventListener,
  RealtimeQuestionSpeechInput,
} from "../../domain/realtime.types";

export class FakeRealtimeInterviewClient implements RealtimeInterviewClient {
  private readonly controller = new RealtimeSessionController();
  private readonly listeners = new Set<RealtimeEventListener>();
  private muted = false;
  private failureCode: string | null = null;
  readonly spoken: Array<{
    kind: "question" | "clarification" | "completion";
    text: string;
    questionSequence?: number;
  }> = [];

  failNextConnect(code = "REALTIME_PROVIDER_UNAVAILABLE") {
    this.failureCode = code;
  }

  async connect(input: RealtimeConnectInput) {
    void input;
    const state = this.controller.getState();
    if (state === "connecting" || state === "connected")
      throw new Error("Realtime client is already connected or connecting.");
    this.setState(state === "disconnected" ? "reconnecting" : "connecting");
    if (this.failureCode) {
      const code = this.failureCode;
      this.failureCode = null;
      this.setState("failed");
      this.emit({ type: "error", code, message: "Fake connection failure." });
      throw new Error(code);
    }
    this.setState("connected");
  }

  async disconnect() {
    const state = this.controller.getState();
    if (state === "idle" || state === "disconnected") return;
    if (state !== "disconnecting") this.setState("disconnecting");
    this.setState("disconnected");
  }

  async speakQuestion(input: RealtimeQuestionSpeechInput) {
    this.assertConnected();
    this.spoken.push({
      kind: "question",
      text: input.question,
      questionSequence: input.questionSequence,
    });
    this.emitInterviewerTranscript(
      `fake-question-${input.questionSequence}`,
      input.question,
      true,
    );
  }

  async speakClarification(input: RealtimeClarificationSpeechInput) {
    this.assertConnected();
    this.spoken.push({
      kind: "clarification",
      text: input.clarification,
      questionSequence: input.questionSequence,
    });
    this.emitInterviewerTranscript(
      `fake-clarification-${input.questionSequence}`,
      input.clarification,
      true,
    );
  }

  async speakCompletion(message: string) {
    this.assertConnected();
    this.spoken.push({ kind: "completion", text: message });
    this.emitInterviewerTranscript("fake-completion", message, true);
  }

  mute() {
    this.muted = true;
  }

  unmute() {
    this.muted = false;
  }

  isMuted() {
    return this.muted;
  }

  interrupt() {
    this.emit({ type: "interrupted" });
    this.emit({ type: "interviewer-speaking", speaking: false });
  }

  getState() {
    return this.controller.getState();
  }

  subscribe(listener: RealtimeEventListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emitCandidateInterim(providerItemId: string, text: string) {
    this.emitTranscript(providerItemId, "candidate", text, false);
  }

  emitCandidateFinal(providerItemId: string, text: string) {
    this.emitTranscript(providerItemId, "candidate", text, true);
  }

  emitInterviewerTranscript(
    providerItemId: string,
    text: string,
    isFinal: boolean,
  ) {
    this.emitTranscript(providerItemId, "interviewer", text, isFinal);
  }

  simulateDisconnect() {
    if (this.controller.getState() === "connected")
      this.setState("disconnected");
  }

  private emitTranscript(
    providerItemId: string,
    role: "candidate" | "interviewer",
    text: string,
    isFinal: boolean,
  ) {
    this.emit({
      type: "transcript",
      transcript: { providerItemId, role, text, isFinal, createdAt: Date.now() },
    });
  }

  private assertConnected() {
    if (this.getState() !== "connected")
      throw new Error("Realtime client is not connected.");
  }

  private setState(
    state: Parameters<RealtimeSessionController["transition"]>[0],
  ) {
    this.controller.transition(state);
    this.emit({ type: "state", state });
  }

  private emit(event: RealtimeEvent) {
    for (const listener of this.listeners) listener(event);
  }
}
