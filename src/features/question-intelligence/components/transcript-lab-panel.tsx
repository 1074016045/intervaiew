"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TranscriptBuffer } from "../application/transcript-buffer";
import type {
  TranscriptStreamClient,
  TranscriptStreamEvent,
} from "../application/transcript-stream-client.port";
import type {
  AnalysisSessionDetailView,
  AnalysisSessionStatus,
  TranscriptSegmentView,
} from "../domain/analysis-session";
import type {
  TranscriptBufferSnapshot,
  TranscriptChunk,
} from "../domain/transcript";
import { FakeTranscriptStreamClient } from "../infrastructure/fake/fake-transcript-stream-client";
import { createTranscriptLabScenario } from "../infrastructure/fake/fake-transcript-scenarios";

const emptySnapshot: TranscriptBufferSnapshot = Object.freeze({
  finalizedText: "",
  interimText: "",
  recentFinalChunks: Object.freeze([]),
  lastActivityAt: null,
  latestSequence: null,
  state: "idle",
});

type ApiErrorPayload = { error?: { message: string } };

export function TranscriptLabPanel({
  id,
  fakeEnabled,
}: {
  id: string;
  fakeEnabled: boolean;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<AnalysisSessionDetailView | null>(null);
  const [snapshot, setSnapshot] =
    useState<TranscriptBufferSnapshot>(emptySnapshot);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const bufferRef = useRef(new TranscriptBuffer());
  const clientRef = useRef<TranscriptStreamClient | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const response = await fetch(`/api/analysis-sessions/${id}`, {
        cache: "no-store",
        signal,
      });
      const payload = (await response.json()) as AnalysisSessionDetailView &
        ApiErrorPayload;
      if (!response.ok || !payload.session)
        throw new Error(
          payload.error?.message ?? "The session could not be loaded.",
        );
      if (mountedRef.current) setDetail(payload);
      return payload;
    },
    [id],
  );

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();
    load(controller.signal)
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === "AbortError")
          return;
        if (mountedRef.current)
          setError(
            caught instanceof Error
              ? caught.message
              : "The session could not be loaded.",
          );
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
    return () => {
      mountedRef.current = false;
      controller.abort();
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      void clientRef.current?.dispose();
      clientRef.current = null;
    };
  }, [load]);

  const disposeLocalClient = useCallback(async () => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    const client = clientRef.current;
    clientRef.current = null;
    await client?.dispose();
  }, []);

  const updateSessionStatus = useCallback(
    async (status: AnalysisSessionStatus) => {
      const response = await fetch(`/api/analysis-sessions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        session?: AnalysisSessionDetailView["session"];
        error?: { message: string };
      };
      if (!response.ok || !payload.session)
        throw new Error(
          payload.error?.message ?? "The session status could not be updated.",
        );
      if (mountedRef.current)
        setDetail((current) =>
          current ? { ...current, session: payload.session! } : current,
        );
    },
    [id],
  );

  const persistFinal = useCallback(
    async (chunk: TranscriptChunk) => {
      const response = await fetch(
        `/api/analysis-sessions/${id}/transcript-segments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(chunk),
          cache: "no-store",
        },
      );
      const payload = (await response.json()) as {
        segment?: TranscriptSegmentView;
        duplicated?: boolean;
        error?: { message: string };
      };
      if (!response.ok || !payload.segment)
        throw new Error(
          payload.error?.message ?? "A final segment could not be saved.",
        );
      if (!mountedRef.current) return;
      setDetail((current) => {
        if (!current) return current;
        const byId = new Map(
          current.segments.map((segment) => [segment.id, segment] as const),
        );
        byId.set(payload.segment!.id, payload.segment!);
        return {
          session: {
            ...current.session,
            status:
              current.session.status === "draft"
                ? "active"
                : current.session.status,
          },
          segments: [...byId.values()].sort(
            (left, right) => left.sequence - right.sequence,
          ),
        };
      });
    },
    [id],
  );

  const handleStreamEvent = useCallback(
    (event: TranscriptStreamEvent) => {
      const buffer = bufferRef.current;
      if (event.type === "state") {
        buffer.setState(event.state, Date.now());
        setSnapshot(buffer.snapshot());
        return;
      }
      if (event.type === "failure") {
        setError(event.message);
        void updateSessionStatus("failed").catch((caught) =>
          setError(
            caught instanceof Error ? caught.message : "The stream failed.",
          ),
        );
        return;
      }
      const result = buffer.receive(event.chunk);
      setSnapshot(buffer.snapshot());
      if (result.kind === "sequence-conflict") {
        setError("The stream emitted a conflicting transcript sequence.");
        return;
      }
      if (result.kind === "accepted" && event.chunk.isFinal)
        void persistFinal(event.chunk).catch((caught) =>
          setError(
            caught instanceof Error
              ? caught.message
              : "A final segment could not be saved.",
          ),
        );
    },
    [persistFinal, updateSessionStatus],
  );

  async function start() {
    if (
      busy ||
      snapshot.state === "starting" ||
      snapshot.state === "streaming" ||
      snapshot.state === "paused"
    )
      return;
    setBusy(true);
    setError("");
    try {
      if (!fakeEnabled)
        throw new Error(
          "Fake Transcript Stream is disabled in this environment.",
        );
      await disposeLocalClient();
      if (snapshot.state === "stopped" || snapshot.state === "failed") {
        bufferRef.current = new TranscriptBuffer();
        setSnapshot(bufferRef.current.snapshot());
      }
      await updateSessionStatus("active");
      const sequenceOffset =
        (detail?.segments.reduce(
          (maximum, segment) => Math.max(maximum, segment.sequence),
          -1,
        ) ?? -1) + 1;
      const scenario = createTranscriptLabScenario({
        sessionId: id,
        runId: crypto.randomUUID(),
        sequenceOffset,
        createdAt: Date.now(),
      });
      const client = new FakeTranscriptStreamClient(scenario);
      clientRef.current = client;
      unsubscribeRef.current = client.subscribe(handleStreamEvent);
      await client.start();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The stream could not start.",
      );
      bufferRef.current.setState("failed", Date.now());
      setSnapshot(bufferRef.current.snapshot());
      await disposeLocalClient();
    } finally {
      setBusy(false);
    }
  }

  async function pause() {
    if (busy || snapshot.state !== "streaming") return;
    setBusy(true);
    setError("");
    try {
      await clientRef.current?.pause();
      await updateSessionStatus("paused");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The stream could not pause.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function resume() {
    if (busy || snapshot.state !== "paused") return;
    setBusy(true);
    setError("");
    try {
      await updateSessionStatus("active");
      await clientRef.current?.resume();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The stream could not resume.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (busy || (snapshot.state !== "streaming" && snapshot.state !== "paused"))
      return;
    setBusy(true);
    setError("");
    try {
      await clientRef.current?.stop();
      await updateSessionStatus("completed");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "The stream could not stop.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function resetLocal() {
    if (busy) return;
    setBusy(true);
    try {
      await disposeLocalClient();
      bufferRef.current = new TranscriptBuffer();
      setSnapshot(bufferRef.current.snapshot());
      setError("");
    } finally {
      setBusy(false);
    }
  }

  async function deleteSession() {
    if (
      busy ||
      !window.confirm(
        "Delete this Transcript Lab session and its final segments?",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await disposeLocalClient();
      const response = await fetch(`/api/analysis-sessions/${id}`, {
        method: "DELETE",
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        deleted?: boolean;
        error?: { message: string };
      };
      if (!response.ok)
        throw new Error(
          payload.error?.message ?? "The session could not be deleted.",
        );
      router.push("/lab/transcript");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The session could not be deleted.",
      );
      setBusy(false);
    }
  }

  if (loading) return <p className="muted">Loading Transcript Lab…</p>;
  if (!detail)
    return (
      <p className="error" role="alert">
        {error || "The session could not be loaded."}
      </p>
    );

  const finalText = detail.segments.map((segment) => segment.text).join(" ");
  const canStart = snapshot.state === "idle" || snapshot.state === "stopped";

  return (
    <div className="stack">
      <section className="authorized-banner" aria-label="Authorized use notice">
        <strong>Practice / Authorized Demo</strong>
        <span>
          No microphone, system audio, AI provider, or answer generation.
        </span>
      </section>
      <section className="card stack">
        <div>
          <p className="eyebrow">Transcript Lab</p>
          <h1 className="lab-title">{detail.session.title}</h1>
        </div>
        <dl className="metadata">
          <div>
            <dt>Session status</dt>
            <dd>{detail.session.status}</dd>
          </div>
          <div>
            <dt>Stream status</dt>
            <dd data-testid="stream-status">{snapshot.state}</dd>
          </div>
          <div>
            <dt>Final segments</dt>
            <dd>{detail.segments.length}</dd>
          </div>
        </dl>
        {!fakeEnabled ? (
          <p className="muted">
            Fake Transcript Stream is disabled. Enable it explicitly in a
            non-production environment.
          </p>
        ) : null}
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="actions">
          <button
            className="button"
            type="button"
            onClick={() => void start()}
            disabled={busy || !canStart || !fakeEnabled}
          >
            Start Fake Stream
          </button>
          <button
            className="button secondary"
            type="button"
            onClick={() => void pause()}
            disabled={busy || snapshot.state !== "streaming"}
          >
            Pause
          </button>
          <button
            className="button secondary"
            type="button"
            onClick={() => void resume()}
            disabled={busy || snapshot.state !== "paused"}
          >
            Resume
          </button>
          <button
            className="button secondary"
            type="button"
            onClick={() => void stop()}
            disabled={
              busy ||
              (snapshot.state !== "streaming" && snapshot.state !== "paused")
            }
          >
            Stop
          </button>
          <button
            className="button secondary"
            type="button"
            onClick={() => void resetLocal()}
            disabled={
              busy ||
              snapshot.state === "starting" ||
              snapshot.state === "streaming" ||
              snapshot.state === "paused"
            }
          >
            Reset local stream state
          </button>
          <button
            className="button danger"
            type="button"
            onClick={() => void deleteSession()}
            disabled={busy}
          >
            Delete Session
          </button>
        </div>
      </section>

      <div className="two-col">
        <section className="card stack">
          <div>
            <p className="question-number">Memory only</p>
            <h2>Interim transcript</h2>
          </div>
          <p className="lab-transcript" data-testid="interim-transcript">
            {snapshot.interimText || "No interim transcript."}
          </p>
        </section>
        <section className="card stack">
          <div>
            <p className="question-number">Persisted in SQLite</p>
            <h2>Final transcript</h2>
          </div>
          <p className="lab-transcript" data-testid="final-transcript">
            {finalText || "No final transcript yet."}
          </p>
        </section>
      </div>

      <section className="card stack">
        <div>
          <p className="question-number">Ordered by sequence</p>
          <h2>Final segment timeline</h2>
        </div>
        {detail.segments.length ? (
          <ol className="segment-timeline">
            {detail.segments.map((segment) => (
              <li key={segment.id} data-testid="final-segment">
                <div className="message-head">
                  <strong>Sequence {segment.sequence}</strong>
                  <span>
                    {segment.speakerRole} · {segment.startMs}–{segment.endMs} ms
                  </span>
                </div>
                <p>{segment.text}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">
            Final segments appear only after a successful database write.
          </p>
        )}
      </section>
    </div>
  );
}
