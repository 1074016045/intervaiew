"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { InterviewDetailView } from "../domain/interview-view.types";
import { InterviewSummary } from "./interview-summary";
import { QuestionPlanView } from "@/features/question-planner/components/question-plan-view";

type Health = { provider: "mock" | "deepseek" | "openai"; model: string };
export function PrepareInterview({ id }: { id: string }) {
  const router = useRouter();
  const [item, setItem] = useState<InterviewDetailView | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  useEffect(() => {
    Promise.all([fetch(`/api/interviews/${id}`), fetch("/api/health")])
      .then(async ([a, b]) => {
        const first = (await a.json()) as {
          interview?: InterviewDetailView;
          error?: { message: string };
        };
        const second = (await b.json()) as
          Health | { error?: { message: string } };
        if (!a.ok || !first.interview)
          throw new Error(first.error?.message ?? "Interview not found.");
        setItem(first.interview);
        if (b.ok && "provider" in second) setHealth(second);
      })
      .catch((caught) =>
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not load interview.",
        ),
      );
  }, [id]);
  async function generate() {
    if (busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(`/api/interviews/${id}/questions`, {
        method: "POST",
      });
      const payload = (await response.json()) as {
        interview?: InterviewDetailView;
        error?: { message: string };
      };
      if (!response.ok || !payload.interview)
        throw new Error(
          payload.error?.message ?? "Could not generate questions.",
        );
      setItem(payload.interview);
      setSuccess("Question plan generated successfully.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not generate questions.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function start() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/interviews/${id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          actionId: crypto.randomUUID(),
        }),
      });
      const payload = (await response.json()) as {
        error?: { message: string };
      };
      if (!response.ok)
        throw new Error(payload.error?.message ?? "Could not start.");
      router.push(`/interviews/${id}/text`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start.");
      setBusy(false);
    }
  }
  if (error && !item)
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  if (!item) return <p aria-live="polite">Loading interview…</p>;
  const provider = item.aiProvider ?? health?.provider;
  const model = item.aiModel ?? health?.model;
  return (
    <div className="stack">
      <section className="card">
        <p className="eyebrow">Prepare</p>
        <h1 style={{ fontSize: "3rem" }}>{item.title}</h1>
        <InterviewSummary interview={item} />
        <hr
          style={{
            border: 0,
            borderTop: "1px solid var(--line)",
            margin: "22px 0",
          }}
        />
        <p>
          <strong>AI Provider:</strong> {provider ?? "Loading…"}
          {model && (
            <>
              {" "}
              · <strong>Model:</strong> {model}
            </>
          )}
        </p>
        {provider === "mock" && (
          <p className="success">No external API calls</p>
        )}
        <div className="actions">
          <button
            className="button"
            onClick={generate}
            disabled={
              busy || !(item.status === "draft" || item.status === "ready")
            }
          >
            {busy
              ? "Planning…"
              : item.questions.length
                ? "Regenerate questions"
                : "Generate questions"}
          </button>
          <button
            className="button secondary"
            onClick={start}
            disabled={busy || item.status !== "ready" || !item.questions.length}
          >
            Start Text Interview
          </button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error} {item.failureCode && `(${item.failureCode})`}
          </p>
        )}
        {success && (
          <p className="success" role="status">
            {success}
          </p>
        )}
      </section>
      <QuestionPlanView
        summary={item.questionPlanSummary}
        questions={item.questions}
      />
    </div>
  );
}
