import type { RealtimeConnectionState } from "../domain/realtime.types";

export function VoiceConnectionStatus({
  state,
  muted,
  interviewerSpeaking,
  candidateSpeaking,
}: {
  state: RealtimeConnectionState;
  muted: boolean;
  interviewerSpeaking: boolean;
  candidateSpeaking: boolean;
}) {
  return (
    <dl className="metadata" aria-live="polite">
      <div>
        <dt>Connection</dt>
        <dd><span className="pill">{state}</span></dd>
      </div>
      <div>
        <dt>Microphone</dt>
        <dd>{muted ? "Muted" : state === "connected" ? "On" : "Off"}</dd>
      </div>
      <div>
        <dt>Interviewer</dt>
        <dd>{interviewerSpeaking ? "Speaking" : "Quiet"}</dd>
      </div>
      <div>
        <dt>Candidate</dt>
        <dd>{candidateSpeaking ? "Speaking" : "Waiting"}</dd>
      </div>
    </dl>
  );
}
