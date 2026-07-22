"use client";

export function VoiceConsentPanel({
  audioConsent,
  recordingConsent,
  recordingsEnabled,
  disabled,
  onAudioConsent,
  onRecordingConsent,
}: {
  audioConsent: boolean;
  recordingConsent: boolean;
  recordingsEnabled: boolean;
  disabled: boolean;
  onAudioConsent: (value: boolean) => void;
  onRecordingConsent: (value: boolean) => void;
}) {
  return (
    <section className="card stack" aria-labelledby="voice-consent-title">
      <div>
        <p className="eyebrow">Consent</p>
        <h2 id="voice-consent-title">Before you connect</h2>
      </div>
      <label className="consent-option">
        <input
          type="checkbox"
          checked={audioConsent}
          disabled={disabled}
          onChange={(event) => onAudioConsent(event.target.checked)}
        />
        <span>
          I understand that my microphone audio will be sent to OpenAI Realtime
          to provide the voice interview.
        </span>
      </label>
      <label className="consent-option">
        <input
          type="checkbox"
          checked={recordingConsent}
          disabled={disabled || !recordingsEnabled}
          onChange={(event) => onRecordingConsent(event.target.checked)}
        />
        <span>
          Record my microphone and the AI interviewer as two local audio tracks.
        </span>
      </label>
      <p className="muted">
        Recording is optional and off by default. Voice uses separate OpenAI API
        billing. Transcription may not be word-for-word exact.
      </p>
    </section>
  );
}
