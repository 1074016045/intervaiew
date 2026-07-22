export type RecordedTrack = {
  role: "candidate" | "interviewer";
  blob: Blob;
  mimeType: string;
  durationMs: number;
  startOffsetMs: number;
};

export interface InterviewRecorder {
  prepare(input: { candidateStream: unknown }): Promise<void>;
  attachInterviewerStream(stream: unknown): void;
  start(): void;
  stop(): Promise<RecordedTrack[]>;
  dispose(): Promise<void>;
  isSupported(): boolean;
}
