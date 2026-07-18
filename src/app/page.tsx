import Link from "next/link";

export default function Home() {
  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">Practice Mode · Local-first</p>
          <h1>IntervAIew</h1>
          <h2>面面具到</h2>
          <p className="lead">
            Practice clearly. Answer confidently. Build a focused question plan
            from your resume and role, then rehearse a complete text interview
            at your own pace.
          </p>
          <div className="actions">
            <Link className="button" href="/interviews/new">
              Start Practice
            </Link>
            <Link className="button secondary" href="/history">
              View History
            </Link>
          </div>
        </div>
        <aside className="card">
          <h3>Designed for honest preparation</h3>
          <p className="muted">
            IntervAIew is not a hidden real-interview assistant. It does not
            capture system audio, evade screen sharing, or answer recruitment
            tests for you.
          </p>
        </aside>
      </section>
      <section className="grid" aria-label="Product principles">
        <article className="card">
          <h3>Local-first data</h3>
          <p className="muted">
            When run on your computer, sessions, answers, and transcripts stay
            in your local SQLite database.
          </p>
        </article>
        <article className="card">
          <h3>Provider architecture</h3>
          <p className="muted">
            Use offline deterministic Mock mode, or explicitly configure
            DeepSeek or OpenAI for question planning.
          </p>
        </article>
        <article className="card">
          <h3>Clear privacy boundary</h3>
          <p className="muted">
            Only question planning sends resume/JD data to a configured external
            provider. Answers and transcripts are not sent.
          </p>
        </article>
      </section>
    </>
  );
}
