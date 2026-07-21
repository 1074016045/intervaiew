import type {
  RealtimeClarificationSpeechInput,
  RealtimeConnectInput,
  RealtimeConnectionState,
  RealtimeEventListener,
  RealtimeQuestionSpeechInput,
} from "../domain/realtime.types";

export interface RealtimeInterviewClient {
  connect(input: RealtimeConnectInput): Promise<void>;
  disconnect(): Promise<void>;
  speakQuestion(input: RealtimeQuestionSpeechInput): Promise<void>;
  speakClarification(input: RealtimeClarificationSpeechInput): Promise<void>;
  speakCompletion(message: string): Promise<void>;
  mute(): void;
  unmute(): void;
  interrupt(): void;
  getState(): RealtimeConnectionState;
  subscribe(listener: RealtimeEventListener): () => void;
}
