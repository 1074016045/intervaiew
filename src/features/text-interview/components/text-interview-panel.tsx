"use client";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type {
  InterviewDetailView,
  TranscriptView,
} from "@/features/interviews/domain/interview-view.types";
import { TranscriptPanel } from "@/features/transcript/components/transcript-panel";

export function TextInterviewPanel({ id }: { id: string }) {
  const [item, setItem] = useState<InterviewDetailView | null>(null);
  const [transcript, setTranscript] = useState<TranscriptView[]>([]);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const startId = useRef(crypto.randomUUID());
  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      fetch(`/api/interviews/${id}`),
      fetch(`/api/interviews/${id}/transcript`),
    ]);
    const x = (await a.json()) as {
      interview?: InterviewDetailView;
      error?: { message: string };
    };
    const y = (await b.json()) as { transcript?: TranscriptView[] };
    if (!a.ok || !x.interview)
      throw new Error(x.error?.message ?? "Could not load interview.");
    setItem(x.interview);
    setTranscript(y.transcript ?? []);
    return x.interview;
  }, [id]);
  const act = useCallback(
    async (body: Record<string, string>) => {
      setBusy(true);
      setError("");
      try {
        const response = await fetch(`/api/interviews/${id}/actions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, actionId: crypto.randomUUID() }),
        });
        const payload = (await response.json()) as {
          error?: { message: string };
        };
        if (!response.ok)
          throw new Error(payload.error?.message ?? "The action failed.");
        await load();
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "The action failed.",
        );
      } finally {
        setBusy(false);
      }
    },
    [id, load],
  );
  useEffect(() => {
    const timer = window.setTimeout(() => {
      load()
        .then(async (current) => {
          if (current.status === "ready") {
            setBusy(true);
            const response = await fetch(`/api/interviews/${id}/actions`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "start",
                actionId: startId.current,
              }),
            });
            if (!response.ok) {
              const p = (await response.json()) as {
                error?: { message: string };
              };
              throw new Error(p.error?.message ?? "Could not start.");
            }
            await load();
            setBusy(false);
          }
        })
        .catch((caught) => {
          setError(
            caught instanceof Error
              ? caught.message
              : "Could not load interview.",
          );
          setBusy(false);
        });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [id, load]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = answer.trim();
    if (!value) return;
    await act({ action: "submit-answer", answer: value });
    setAnswer("");
  }
  async function cancel() {
    if (
      window.confirm(
        "End this practice interview early? It will be marked cancelled.",
      )
    )
      await act({ action: "cancel" });
  }
  if (error && !item)
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  if (!item) return <p>Loading interview…</p>;
  const active = item.status === "active";
  const current = active ? item.questions[item.currentQuestionIndex] : null;
  return (
    <div className="stack">
      <div>
        <p className="eyebrow">Practice Mode</p>
        <h1 style={{ fontSize: "2.7rem" }}>{item.title}</h1>
      </div>
      <div className="interview-layout">
        <section className="card stack">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <span className="pill">{item.status}</span>
            <strong>
              {active
                ? `Question ${item.currentQuestionIndex + 1} of ${item.questionCount}`
                : `${item.status}`}
            </strong>
          </div>
          {current ? (
            <>
              <div>
                <p className="question-number">{current.competency}</p>
                <h2>{current.question}</h2>
              </div>
              <form className="stack" onSubmit={submit}>
                <div className="field">
                  <label htmlFor="answer">Your answer</label>
                  <textarea
                    id="answer"
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    minLength={1}
                    maxLength={20000}
                    required
                    disabled={busy}
                  />
                </div>
                <div className="actions">
                  <button className="button" disabled={busy || !answer.trim()}>
                    {busy ? "Saving…" : "Submit Answer"}
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() => act({ action: "repeat-question" })}
                  >
                    Repeat Question
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() => act({ action: "request-clarification" })}
                  >
                    Ask for Clarification
                  </button>
                  <button
                    type="button"
                    className="button danger"
                    disabled={busy}
                    onClick={cancel}
                  >
                    End Interview
                  </button>
                </div>
              </form>
            </>
          ) : (
            <div>
              <h2>
                {item.status === "completed"
                  ? "Practice complete"
                  : item.status === "cancelled"
                    ? "Practice ended"
                    : "Interview unavailable"}
              </h2>
              <p className="muted">Your transcript has been saved locally.</p>
              <div className="actions">
                <a className="button" href={`/interviews/${id}`}>
                  View details
                </a>
                <a className="button secondary" href="/history">
                  View history
                </a>
              </div>
            </div>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </section>
        <TranscriptPanel items={transcript} />
      </div>
    </div>
  );
}
