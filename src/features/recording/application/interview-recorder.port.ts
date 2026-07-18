export interface InterviewRecorder {
  prepare(): Promise<void>;
  start(): void;
  stop(): Promise<void>;
  dispose(): Promise<void>;
}
