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
import type { QuestionBoundaryState } from "../application/question-segmentation-service";
import type { UnderstandingSnapshot } from "../application/question-understanding-repository.port";

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
  const [boundaryBusy, setBoundaryBusy] = useState(false);
  const [boundary, setBoundary] = useState<QuestionBoundaryState | null>(null);
  const [understanding, setUnderstanding] = useState<UnderstandingSnapshot | null>(null);
  const [understandingBusyId, setUnderstandingBusyId] = useState<string | null>(null);
  const bufferRef = useRef(new TranscriptBuffer());
  const clientRef = useRef<TranscriptStreamClient | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);
  const boundaryRevisionRef = useRef<number | null>(null);
  const boundaryRequestRef = useRef<AbortController | null>(null);

  const applyBoundary = useCallback((state: QuestionBoundaryState) => {
    boundaryRevisionRef.current = state.candidate?.revision ?? null;
    setBoundary(state);
  }, []);

  const loadBoundary = useCallback(
    async (signal?: AbortSignal) => {
      const response = await fetch(
        `/api/analysis-sessions/${id}/question-boundary`,
        { cache: "no-store", signal },
      );
      const payload = (await response.json()) as QuestionBoundaryState &
        ApiErrorPayload;
      if (!response.ok)
        throw new Error(
          payload.error?.message ??
            "Question boundary state could not be loaded.",
        );
      if (mountedRef.current) applyBoundary(payload);
      return payload;
    },
    [applyBoundary, id],
  );

  const loadUnderstanding = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/analysis-sessions/${id}/question-understanding`, { cache: "no-store", signal });
    const payload = (await response.json()) as UnderstandingSnapshot & ApiErrorPayload;
    if (!response.ok) throw new Error(payload.error?.message ?? "Question understanding could not be loaded.");
    if (mountedRef.current) setUnderstanding(payload);
    return payload;
  }, [id]);

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
    Promise.all([load(controller.signal), loadBoundary(controller.signal), loadUnderstanding(controller.signal)])
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
      boundaryRequestRef.current?.abort();
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      void clientRef.current?.dispose();
      clientRef.current = null;
    };
  }, [load, loadBoundary, loadUnderstanding]);

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
      boundaryRequestRef.current?.abort();
      await loadBoundary();
    },
    [id, loadBoundary],
  );

  const boundaryMutation = useCallback(
    async (path: string, body: Readonly<Record<string, string | number>>) => {
      if (boundaryBusy) return;
      const submittedRevision = boundaryRevisionRef.current;
      const controller = new AbortController();
      boundaryRequestRef.current?.abort();
      boundaryRequestRef.current = controller;
      setBoundaryBusy(true);
      setError("");
      try {
        const response = await fetch(
          `/api/analysis-sessions/${id}/question-boundary/${path}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            cache: "no-store",
            signal: controller.signal,
          },
        );
        const payload = (await response.json()) as QuestionBoundaryState &
          ApiErrorPayload;
        if (!response.ok)
          throw new Error(
            payload.error?.message ?? "The question boundary action failed.",
          );
        if (
          mountedRef.current &&
          (submittedRevision === boundaryRevisionRef.current ||
            path === "merge-previous" ||
            path === "undo")
        )
          applyBoundary(payload);
        await loadUnderstanding();
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError")
          return;
        if (mountedRef.current)
          setError(
            caught instanceof Error
              ? caught.message
              : "The question boundary action failed.",
          );
      } finally {
        if (boundaryRequestRef.current === controller)
          boundaryRequestRef.current = null;
        if (mountedRef.current) setBoundaryBusy(false);
      }
    },
    [applyBoundary, boundaryBusy, id, loadUnderstanding],
  );

  const analyzeUnderstanding = useCallback(async (finalizedQuestionId: string) => {
    if (understandingBusyId) return;
    setUnderstandingBusyId(finalizedQuestionId); setError("");
    try {
      const response = await fetch(`/api/analysis-sessions/${id}/question-understanding/analyze`, {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ finalizedQuestionId, actionId: crypto.randomUUID() }),
      });
      const payload = (await response.json()) as UnderstandingSnapshot & ApiErrorPayload;
      if (!response.ok) throw new Error(payload.error?.message ?? "Question analysis failed.");
      if (mountedRef.current) setUnderstanding(payload);
    } catch (caught) { if (mountedRef.current) setError(caught instanceof Error ? caught.message : "Question analysis failed."); }
    finally { if (mountedRef.current) setUnderstandingBusyId(null); }
  }, [id, understandingBusyId]);

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
  const candidate = boundary?.candidate ?? null;
  const latestDecision = boundary?.latestDecision ?? null;
  const candidateSegments = candidate
    ? detail.segments.filter((segment) =>
        candidate.segmentIds.includes(segment.id),
      )
    : [];
  const boundaryActionsAllowed = ["active", "paused", "completed"].includes(
    detail.session.status,
  );

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

      <section className="card stack" aria-labelledby="question-boundary-title">
        <div>
          <p className="question-number">Final interviewer segments only</p>
          <h2 id="question-boundary-title">Question Boundary</h2>
        </div>
        <dl className="metadata boundary-metadata">
          <div>
            <dt>Candidate revision</dt>
            <dd data-testid="candidate-revision">
              {candidate?.revision ?? "—"}
            </dd>
          </div>
          <div>
            <dt>Pause duration</dt>
            <dd>{candidate ? `${candidate.pauseAfterMs} ms` : "—"}</dd>
          </div>
          <div>
            <dt>Boundary status</dt>
            <dd data-testid="boundary-status">
              {latestDecision?.status ?? "pending"}
            </dd>
          </div>
          <div>
            <dt>Confidence</dt>
            <dd>
              {latestDecision ? latestDecision.confidence.toFixed(2) : "—"}
            </dd>
          </div>
          <div>
            <dt>Decision source</dt>
            <dd>{latestDecision?.decidedBy ?? "—"}</dd>
          </div>
          <div>
            <dt>Reason code</dt>
            <dd>{latestDecision?.reasonCode ?? "—"}</dd>
          </div>
          <div>
            <dt>Semantic used</dt>
            <dd>{latestDecision?.semanticProviderUsed ? "yes" : "no"}</dd>
          </div>
          <div>
            <dt>Semantic calls</dt>
            <dd>{boundary?.semanticProviderCallCount ?? 0}</dd>
          </div>
        </dl>
        <div>
          <h3>Current Question Candidate</h3>
          <p className="lab-transcript" data-testid="question-candidate">
            {candidate?.text ?? "No current interviewer candidate."}
          </p>
        </div>
        <div>
          <h3>Deterministic signals</h3>
          {boundary?.deterministic?.signals.length ? (
            <ul className="signal-list">
              {boundary.deterministic.signals.map((signal) => (
                <li key={`${signal.code}-${signal.kind}`}>
                  <code>{signal.code}</code> · {signal.kind} ·{" "}
                  {signal.confidence.toFixed(2)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No deterministic signals.</p>
          )}
        </div>
        <div>
          <h3>Candidate source segments</h3>
          {candidateSegments.length ? (
            <ol className="segment-timeline compact">
              {candidateSegments.map((segment) => (
                <li key={segment.id}>
                  Sequence {segment.sequence}: {segment.text}
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">No candidate source segments.</p>
          )}
        </div>
        <div className="actions">
          <button
            className="button"
            type="button"
            disabled={!candidate || boundaryBusy || !boundaryActionsAllowed}
            onClick={() =>
              candidate &&
              void boundaryMutation("evaluate", {
                actionId: crypto.randomUUID(),
                candidateRevision: candidate.revision,
              })
            }
          >
            Evaluate Boundary
          </button>
          <button
            className="button secondary"
            type="button"
            disabled={!candidate || boundaryBusy || !boundaryActionsAllowed}
            onClick={() =>
              candidate &&
              void boundaryMutation("force-finalize", {
                actionId: crypto.randomUUID(),
                candidateRevision: candidate.revision,
              })
            }
          >
            Force Finalize
          </button>
        </div>
      </section>

      <section className="card stack">
        <div>
          <p className="question-number">Persisted with source traceability</p>
          <h2>Finalized Questions</h2>
        </div>
        {boundary?.finalizedQuestions.length ? (
          <ol className="segment-timeline">
            {boundary.finalizedQuestions.map((question, index) => (
              <li key={question.id} data-testid="finalized-question">
                <div className="message-head">
                  <strong>
                    Question {index + 1} · revision {question.revision}
                  </strong>
                  <span>{question.undoneAt ? "undone" : "active"}</span>
                </div>
                <p>{question.text}</p>
                <p className="muted">
                  Sequences {question.firstSequence}–{question.lastSequence} ·{" "}
                  {question.sourceSegmentIds.length} source segment(s)
                </p>
                <div className="actions compact-actions">
                  <button
                    className="button secondary"
                    type="button"
                    disabled={
                      boundaryBusy ||
                      Boolean(question.undoneAt) ||
                      index === 0 ||
                      !boundaryActionsAllowed
                    }
                    onClick={() =>
                      void boundaryMutation("merge-previous", {
                        actionId: crypto.randomUUID(),
                        targetQuestionId: question.id,
                      })
                    }
                  >
                    Merge with Previous
                  </button>
                  <button
                    className="button secondary"
                    type="button"
                    disabled={
                      boundaryBusy ||
                      Boolean(question.undoneAt) ||
                      !boundaryActionsAllowed
                    }
                    onClick={() =>
                      void boundaryMutation("undo", {
                        actionId: crypto.randomUUID(),
                        targetQuestionId: question.id,
                      })
                    }
                  >
                    Undo Finalize
                  </button>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">No finalized questions yet.</p>
        )}
      </section>

      <section className="card stack" aria-labelledby="question-understanding-title">
        <div>
          <p className="question-number">Structured metadata only · no answers</p>
          <h2 id="question-understanding-title">Question Understanding</h2>
        </div>
        {understanding?.questions.length ? (
          <ol className="segment-timeline understanding-list">
            {understanding.questions.map(({ question, understanding: result }, index) => (
              <li key={question.id} data-testid="question-understanding">
                <div className="message-head"><strong>Question {index + 1} · source revision {question.revision}</strong><span>{result?.status ?? "not analyzed"}</span></div>
                <p>{question.text}</p>
                {result ? (
                  <div className="stack understanding-result">
                    <dl className="metadata boundary-metadata">
                      <div><dt>Language</dt><dd>{result.language}</dd></div>
                      <div><dt>Family</dt><dd>{result.questionFamily}</dd></div>
                      <div><dt>Answer mode</dt><dd>{result.expectedAnswerMode}</dd></div>
                      <div><dt>Confidence</dt><dd>{result.confidence.toFixed(2)}</dd></div>
                      <div><dt>Decided by</dt><dd>{result.decidedBy}</dd></div>
                      <div><dt>Fake semantic used</dt><dd>{result.semanticProviderUsed ? "yes" : "no"}</dd></div>
                      <div><dt>Understanding revision</dt><dd>{result.understandingRevision}</dd></div>
                      <div><dt>Clarification</dt><dd>{result.requiresClarification ? "required" : "not required"}</dd></div>
                    </dl>
                    <p><strong>Requested dimensions:</strong> {result.requestedDimensions.join(", ") || "none"}</p>
                    <p><strong>Constraints:</strong> {result.explicitConstraints.map((item) => `${item.kind}: ${item.sourceText}`).join("; ") || "none"}</p>
                    <p><strong>Focus terms:</strong> {result.focusTerms.map((item) => item.normalized).join(", ") || "none"}</p>
                    <p><strong>Clarification reasons:</strong> {result.clarificationReasons.join(", ")}</p>
                  </div>
                ) : <p className="muted">No understanding result. Analysis runs only after the explicit action below.</p>}
                <div className="actions compact-actions"><button className="button secondary" type="button" disabled={Boolean(understandingBusyId)} onClick={() => void analyzeUnderstanding(question.id)}>{result ? "Re-analyze" : "Analyze"}</button></div>
              </li>
            ))}
          </ol>
        ) : <p className="muted">Finalize a question before analyzing it.</p>}
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
