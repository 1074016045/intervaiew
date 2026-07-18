"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { InterviewStatus } from "@/features/interviews/domain/interview.types";
import type { InterviewSummaryView } from "@/features/interviews/domain/interview-view.types";

export function HistoryList() {
  const [items, setItems] = useState<InterviewSummaryView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | InterviewStatus>("all");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/interviews");
      const payload = (await response.json()) as {
        interviews?: InterviewSummaryView[];
        error?: { message: string };
      };
      if (!response.ok)
        throw new Error(payload.error?.message ?? "Could not load history.");
      setItems(payload.interviews ?? []);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not load history.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const visible = useMemo(
    () =>
      items.filter(
        (item) =>
          (status === "all" || item.status === status) &&
          `${item.title} ${item.targetRole} ${item.targetCompany ?? ""}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      ),
    [items, search, status],
  );
  async function remove(item: InterviewSummaryView) {
    if (
      !window.confirm(
        `Delete “${item.title}” and its transcript? This cannot be undone.`,
      )
    )
      return;
    setError("");
    const response = await fetch(`/api/interviews/${item.id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const payload = (await response.json()) as {
        error?: { message: string };
      };
      setError(payload.error?.message ?? "Could not delete interview.");
      return;
    }
    setItems((current) => current.filter((value) => value.id !== item.id));
    setSuccess("Interview deleted.");
  }
  return (
    <div className="stack">
      <section className="card form-grid">
        <div className="field">
          <label htmlFor="history-search">Search</label>
          <input
            id="history-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Title, role, or company"
          />
        </div>
        <div className="field">
          <label htmlFor="history-status">Status</label>
          <select
            id="history-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
          >
            <option value="all">All statuses</option>
            {[
              "draft",
              "planning",
              "ready",
              "active",
              "ending",
              "completed",
              "cancelled",
              "failed",
            ].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </div>
      </section>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="success" role="status">
          {success}
        </p>
      )}
      {loading ? (
        <p>Loading history…</p>
      ) : !visible.length ? (
        <section className="card">
          <h2>No interviews found</h2>
          <p className="muted">
            Create a practice interview or change the filters.
          </p>
          <Link className="button" href="/interviews/new">
            Start Practice
          </Link>
        </section>
      ) : (
        <div className="stack">
          {visible.map((item) => (
            <article className="card history-row" key={item.id}>
              <div>
                <p className="question-number">
                  {item.status} · {item.language}
                </p>
                <h3>{item.title}</h3>
                <p className="muted">
                  {item.targetRole}
                  {item.targetCompany && ` at ${item.targetCompany}`} ·{" "}
                  {item.interviewType}
                </p>
              </div>
              <div>
                <strong>
                  {Math.min(
                    item.currentQuestionIndex +
                      (item.status === "active" ? 1 : 0),
                    item.questionCount,
                  )}{" "}
                  / {item.questionCount}
                </strong>
                <p className="muted">
                  {new Date(item.createdAt).toLocaleDateString()} ·{" "}
                  {item.aiProvider ?? "not planned"}
                  {item.durationSeconds != null &&
                    ` · ${item.durationSeconds}s`}
                </p>
              </div>
              <div className="actions">
                <Link
                  className="button secondary"
                  href={`/interviews/${item.id}`}
                >
                  Open
                </Link>
                <button className="button danger" onClick={() => remove(item)}>
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
