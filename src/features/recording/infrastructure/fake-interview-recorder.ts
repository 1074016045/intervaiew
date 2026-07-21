import type {
  InterviewRecorder,
  RecordedTrack,
} from "../application/interview-recorder.port";

export class FakeInterviewRecorder implements InterviewRecorder {
  private started = false;
  async prepare(input: { candidateStream: unknown }) {
    void input;
  }
  attachInterviewerStream(stream: unknown) {
    void stream;
  }
  start() {
    this.started = true;
  }
  async stop(): Promise<RecordedTrack[]> {
    if (!this.started) return [];
    this.started = false;
    return [
      {
        role: "candidate",
        blob: new Blob(["fake candidate audio"], { type: "audio/webm" }),
        mimeType: "audio/webm",
        durationMs: 1000,
        startOffsetMs: 0,
      },
      {
        role: "interviewer",
        blob: new Blob(["fake interviewer audio"], { type: "audio/webm" }),
        mimeType: "audio/webm",
        durationMs: 1000,
        startOffsetMs: 100,
      },
    ];
  }
  async dispose() {
    this.started = false;
  }
  isSupported() {
    return true;
  }
}
