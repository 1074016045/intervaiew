"use client";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import {
  createInterviewSchema,
  interviewDifficulties,
  interviewLanguages,
  interviewTypes,
} from "../domain/interview.types";

export function InterviewForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resume, setResume] = useState("");
  const [jd, setJd] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const validation = createInterviewSchema.safeParse(data);
    if (!validation.success) {
      setError(
        validation.error.issues[0]?.message ?? "Please check the form fields.",
      );
      setBusy(false);
      return;
    }
    try {
      const response = await fetch("/api/interviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validation.data),
      });
      const payload = (await response.json()) as {
        interview?: { id: string };
        error?: { message: string };
      };
      if (!response.ok || !payload.interview)
        throw new Error(
          payload.error?.message ?? "Could not create the interview.",
        );
      router.push(`/interviews/${payload.interview.id}/prepare`);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not create the interview.",
      );
      setBusy(false);
    }
  }
  return (
    <form className="card form-grid" onSubmit={submit} aria-busy={busy}>
      <div className="field">
        <label htmlFor="title">Title</label>
        <input
          id="title"
          name="title"
          required
          minLength={2}
          maxLength={120}
          placeholder="AI Agent interview practice"
        />
      </div>
      <div className="field">
        <label htmlFor="targetRole">Target role</label>
        <input
          id="targetRole"
          name="targetRole"
          required
          minLength={2}
          maxLength={120}
          placeholder="AI Agent Engineer"
        />
      </div>
      <div className="field">
        <label htmlFor="targetCompany">
          Target company <span className="muted">(optional)</span>
        </label>
        <input id="targetCompany" name="targetCompany" maxLength={120} />
      </div>
      <div className="field">
        <label htmlFor="interviewType">Interview type</label>
        <select
          id="interviewType"
          name="interviewType"
          defaultValue="ai-agent-engineering"
        >
          {interviewTypes.map((value) => (
            <option key={value} value={value}>
              {value.replaceAll("-", " ")}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="difficulty">Difficulty</label>
        <select id="difficulty" name="difficulty" defaultValue="graduate">
          {interviewDifficulties.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="language">Language</label>
        <select id="language" name="language" defaultValue="Chinese">
          {interviewLanguages.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="questionCount">Question count</label>
        <select id="questionCount" name="questionCount" defaultValue="3">
          {Array.from({ length: 8 }, (_, i) => i + 3).map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </div>
      <div className="field full">
        <label htmlFor="resumeText">Resume text</label>
        <textarea
          id="resumeText"
          name="resumeText"
          required
          minLength={40}
          maxLength={20000}
          value={resume}
          onChange={(e) => setResume(e.target.value)}
        />
        <div className="field-note">
          <span>At least 40 characters</span>
          <span>{resume.length} / 20,000</span>
        </div>
      </div>
      <div className="field full">
        <label htmlFor="jobDescription">Job Description</label>
        <textarea
          id="jobDescription"
          name="jobDescription"
          required
          minLength={40}
          maxLength={20000}
          value={jd}
          onChange={(e) => setJd(e.target.value)}
        />
        <div className="field-note">
          <span>At least 40 characters</span>
          <span>{jd.length} / 20,000</span>
        </div>
      </div>
      {error && (
        <p className="error field full" role="alert">
          {error}
        </p>
      )}
      <div className="field full">
        <button className="button" disabled={busy}>
          {busy ? "Creating…" : "Create interview"}
        </button>
      </div>
    </form>
  );
}
