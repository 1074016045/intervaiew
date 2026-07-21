"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type {
  InterviewDetailView,
  TranscriptView,
} from "../domain/interview-view.types";
import { InterviewSummary } from "./interview-summary";
import { QuestionPlanView } from "@/features/question-planner/components/question-plan-view";
import { TranscriptPanel } from "@/features/transcript/components/transcript-panel";
import { RecordingAssets } from "@/features/recording/components/recording-assets";

export function InterviewDetail({ id }: { id: string }) {
  const router = useRouter();
  const [item, setItem] = useState<InterviewDetailView | null>(null);
  const [transcript, setTranscript] = useState<TranscriptView[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    Promise.all([
      fetch(`/api/interviews/${id}`),
      fetch(`/api/interviews/${id}/transcript`),
    ])
      .then(async ([a, b]) => {
        const x = (await a.json()) as {
          interview?: InterviewDetailView;
          error?: { message: string };
        };
        const y = (await b.json()) as { transcript?: TranscriptView[] };
        if (!a.ok || !x.interview)
          throw new Error(x.error?.message ?? "Interview not found.");
        setItem(x.interview);
        setTranscript(y.transcript ?? []);
      })
      .catch((caught) =>
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not load interview.",
        ),
      );
  }, [id]);
  async function remove() {
    if (
      !item ||
      !window.confirm(`Delete “${item.title}” and all associated data?`)
    )
      return;
    setBusy(true);
    const response = await fetch(`/api/interviews/${id}`, { method: "DELETE" });
    if (response.ok) router.push("/history");
    else {
      const payload = (await response.json()) as {
        error?: { message: string };
      };
      setError(payload.error?.message ?? "Could not delete interview.");
      setBusy(false);
    }
  }
  if (error && !item)
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  if (!item) return <p>Loading interview details…</p>;
  return (
    <div className="stack">
      <section className="card">
        <p className="eyebrow">Interview details</p>
        <h1 style={{ fontSize: "3rem" }}>{item.title}</h1>
        <InterviewSummary interview={item} />
        <p>
          <strong>Provider:</strong> {item.aiProvider ?? "—"} ·{" "}
          <strong>Model:</strong> {item.aiModel ?? "—"}
        </p>
        <div className="actions">
          {(item.status === "draft" || item.status === "ready") && (
            <Link className="button" href={`/interviews/${id}/prepare`}>
              Back to Prepare
            </Link>
          )}
          {item.status === "active" && (
            <>
              <Link className="button" href={`/interviews/${id}/text`}>
                Continue Text Interview
              </Link>
              <Link className="button secondary" href={`/interviews/${id}/voice`}>
                Resume Voice Interview
              </Link>
            </>
          )}
          <a
            className="button secondary"
            href={`/api/interviews/${id}/export?format=txt`}
          >
            Export TXT
          </a>
          <a
            className="button secondary"
            href={`/api/interviews/${id}/export?format=json`}
          >
            Export JSON
          </a>
          <button className="button danger" disabled={busy} onClick={remove}>
            {busy ? "Deleting…" : "Delete Interview"}
          </button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
      <QuestionPlanView
        summary={item.questionPlanSummary}
        questions={item.questions}
      />
      <TranscriptPanel items={transcript} />
      <RecordingAssets interviewId={id} />
    </div>
  );
}
