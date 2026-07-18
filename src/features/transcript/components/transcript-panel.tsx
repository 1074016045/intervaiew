"use client";
import { useEffect, useRef, useState } from "react";
import type { TranscriptView } from "@/features/interviews/domain/interview-view.types";

const labels = {
  interviewer: "Interviewer",
  candidate: "Candidate",
  system: "System",
} as const;
export function TranscriptPanel({ items }: { items: TranscriptView[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  useEffect(() => {
    if (following && ref.current)
      ref.current.scrollTop = ref.current.scrollHeight;
  }, [items, following]);
  function onScroll() {
    const element = ref.current;
    if (element)
      setFollowing(
        element.scrollHeight - element.scrollTop - element.clientHeight < 48,
      );
  }
  function jump() {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
    setFollowing(true);
  }
  return (
    <section className="card">
      <div
        style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
      >
        <h2>Transcript</h2>
        {!following && (
          <button className="button secondary" onClick={jump}>
            Jump to latest
          </button>
        )}
      </div>
      {!items.length ? (
        <p className="muted">The transcript is empty.</p>
      ) : (
        <div className="transcript" ref={ref} onScroll={onScroll}>
          {items.map((item) => (
            <article className={`message ${item.role}`} key={item.id}>
              <div className="message-head">
                <strong>{labels[item.role]}</strong>
                <time dateTime={item.createdAt}>
                  {new Date(item.createdAt).toLocaleTimeString()}
                </time>
              </div>
              <div>{item.text}</div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
