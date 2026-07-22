import type {
  TranscriptChunk,
  TranscriptStreamState,
} from "../domain/transcript";

export type TranscriptStreamEvent =
  | Readonly<{ type: "transcript"; chunk: TranscriptChunk }>
  | Readonly<{ type: "state"; state: TranscriptStreamState }>
  | Readonly<{ type: "failure"; code: string; message: string }>;

export type TranscriptStreamListener = (event: TranscriptStreamEvent) => void;

export interface TranscriptStreamClient {
  start(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  dispose(): Promise<void> | void;
  getState(): TranscriptStreamState;
  subscribe(listener: TranscriptStreamListener): () => void;
}
