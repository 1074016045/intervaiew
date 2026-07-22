"use client";

import type {
  InterviewRecorder,
  RecordedTrack,
} from "../application/interview-recorder.port";
import { selectRecordingMimeType } from "./media-recorder-support";

type TrackState = {
  role: "candidate" | "interviewer";
  recorder: MediaRecorder;
  chunks: Blob[];
  startedAt: number;
  startOffsetMs: number;
  stopped: Promise<void>;
  resolveStopped: () => void;
};

function assertStream(value: unknown): asserts value is MediaStream {
  if (!(value instanceof MediaStream))
    throw new Error("A browser media stream is required.");
}

export class BrowserDualTrackRecorder implements InterviewRecorder {
  private candidateStream: MediaStream | null = null;
  private interviewerStream: MediaStream | null = null;
  private tracks: TrackState[] = [];
  private sessionStartedAt = 0;
  private recording = false;
  private readonly mimeType = selectRecordingMimeType(
    typeof MediaRecorder === "undefined" ? undefined : MediaRecorder,
  );

  async prepare(input: { candidateStream: unknown }) {
    assertStream(input.candidateStream);
    this.candidateStream = input.candidateStream;
  }

  attachInterviewerStream(stream: unknown) {
    assertStream(stream);
    this.interviewerStream = stream;
    if (this.recording && !this.tracks.some((track) => track.role === "interviewer"))
      this.startTrack("interviewer", stream);
  }

  start() {
    if (!this.isSupported() || this.recording || !this.candidateStream) return;
    this.recording = true;
    this.sessionStartedAt = performance.now();
    this.startTrack("candidate", this.candidateStream);
    if (this.interviewerStream)
      this.startTrack("interviewer", this.interviewerStream);
  }

  private startTrack(
    role: "candidate" | "interviewer",
    stream: MediaStream,
  ) {
    const options = this.mimeType ? { mimeType: this.mimeType } : undefined;
    const recorder = new MediaRecorder(stream, options);
    const chunks: Blob[] = [];
    let resolveStopped: () => void = () => {};
    const stopped = new Promise<void>((resolve) => {
      resolveStopped = resolve;
    });
    const startedAt = performance.now();
    const state: TrackState = {
      role,
      recorder,
      chunks,
      startedAt,
      startOffsetMs: Math.max(0, Math.round(startedAt - this.sessionStartedAt)),
      stopped,
      resolveStopped,
    };
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size) chunks.push(event.data);
    });
    recorder.addEventListener("stop", resolveStopped, { once: true });
    recorder.addEventListener("error", resolveStopped, { once: true });
    this.tracks.push(state);
    recorder.start(1000);
  }

  async stop(): Promise<RecordedTrack[]> {
    if (!this.recording) return [];
    this.recording = false;
    const stoppedAt = performance.now();
    for (const track of this.tracks) {
      if (track.recorder.state !== "inactive") track.recorder.stop();
    }
    await Promise.all(this.tracks.map((track) => track.stopped));
    return this.tracks.flatMap((track) => {
      const blob = new Blob(track.chunks, {
        type: track.recorder.mimeType || this.mimeType || "audio/webm",
      });
      if (!blob.size) return [];
      return [
        {
          role: track.role,
          blob,
          mimeType: blob.type,
          durationMs: Math.max(0, Math.round(stoppedAt - track.startedAt)),
          startOffsetMs: track.startOffsetMs,
        },
      ];
    });
  }

  async dispose() {
    await this.stop();
    this.candidateStream = null;
    this.interviewerStream = null;
    this.tracks = [];
  }

  isSupported() {
    return this.mimeType !== null;
  }
}
