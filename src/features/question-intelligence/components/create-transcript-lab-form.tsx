"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CreateTranscriptLabForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function createSession(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/analysis-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, mode: "transcript_lab" }),
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        session?: { id: string };
        error?: { message: string };
      };
      if (!response.ok || !payload.session)
        throw new Error(
          payload.error?.message ??
            "The Transcript Lab session could not be created.",
        );
      router.push(`/lab/transcript/${payload.session.id}`);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The Transcript Lab session could not be created.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={createSession}>
      <div className="field">
        <label htmlFor="transcript-lab-title">Session title</label>
        <input
          id="transcript-lab-title"
          value={title}
          maxLength={120}
          required
          autoComplete="off"
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Backend interview question study"
        />
        <span className="field-note">
          Created only when you submit this form. The stream remains idle.
        </span>
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="actions">
        <button
          className="button"
          type="submit"
          disabled={busy || !title.trim()}
        >
          {busy ? "Creating…" : "Create Transcript Lab session"}
        </button>
      </div>
    </form>
  );
}
