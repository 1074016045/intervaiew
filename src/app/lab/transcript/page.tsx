import { CreateTranscriptLabForm } from "@/features/question-intelligence/components/create-transcript-lab-form";

export default function TranscriptLabHomePage() {
  return (
    <div className="stack">
      <section>
        <p className="eyebrow">Practice / Authorized Demo</p>
        <h1 className="lab-title">Transcript Lab</h1>
        <p className="lead">
          Study deterministic streaming transcript state without a microphone or
          a real AI connection. Interim text stays in page memory; only final
          segments are stored in SQLite.
        </p>
      </section>
      <section className="authorized-banner">
        <strong>Practice / Authorized Demo only</strong>
        <span>
          This lab does not capture audio, detect questions, retrieve resume
          evidence, generate answers, or assist a real interview.
        </span>
      </section>
      <CreateTranscriptLabForm />
    </div>
  );
}
