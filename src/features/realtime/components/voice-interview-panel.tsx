"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  InterviewDetailView,
  TranscriptView,
} from "@/features/interviews/domain/interview-view.types";
import type { RealtimeInterviewClient } from "../application/realtime-interview-client.port";
import type {
  ClientSecretResponse,
  RealtimeConnectionState,
} from "../domain/realtime.types";
import { OpenAIRealtimeWebRTCClient } from "../infrastructure/openai/openai-realtime-web-rtc-client";
import { FakeRealtimeInterviewClient } from "../infrastructure/fake/fake-realtime-interview-client";
import type { InterviewRecorder } from "@/features/recording/application/interview-recorder.port";
import { BrowserDualTrackRecorder } from "@/features/recording/infrastructure/browser-dual-track-recorder";
import { FakeInterviewRecorder } from "@/features/recording/infrastructure/fake-interview-recorder";
import { TranscriptPanel } from "@/features/transcript/components/transcript-panel";
import { VoiceConsentPanel } from "./voice-consent-panel";
import { VoiceConnectionStatus } from "./voice-connection-status";
import { VoiceLevelIndicator } from "./voice-level-indicator";

type Health = {
  realtimeEnabled: boolean;
  recordingsEnabled: boolean;
  realtimeFakeEnabled: boolean;
};

export function VoiceInterviewPanel({ id }: { id: string }) {
  const [item, setItem] = useState<InterviewDetailView | null>(null);
  const [transcript, setTranscript] = useState<TranscriptView[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [audioConsent, setAudioConsent] = useState(false);
  const [recordingConsent, setRecordingConsent] = useState(false);
  const [connection, setConnection] =
    useState<RealtimeConnectionState>("idle");
  const [muted, setMuted] = useState(false);
  const [interviewerSpeaking, setInterviewerSpeaking] = useState(false);
  const [candidateSpeaking, setCandidateSpeaking] = useState(false);
  const [interim, setInterim] = useState("");
  const [liveInterviewer, setLiveInterviewer] = useState("");
  const [recordingStatus, setRecordingStatus] = useState("Off");
  const [warning, setWarning] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const clientRef = useRef<RealtimeInterviewClient | null>(null);
  const fakeRef = useRef<FakeRealtimeInterviewClient | null>(null);
  const recorderRef = useRef<InterviewRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const attemptIdRef = useRef<string | null>(null);
  const connectingRef = useRef(false);
  const processedRef = useRef(new Set<string>());
  const startedAtRef = useRef(0);
  const timersRef = useRef<number[]>([]);

  const load = useCallback(async () => {
    const [detailResponse, transcriptResponse] = await Promise.all([
      fetch(`/api/interviews/${id}`, { cache: "no-store" }),
      fetch(`/api/interviews/${id}/transcript`, { cache: "no-store" }),
    ]);
    const detailPayload = (await detailResponse.json()) as {
      interview?: InterviewDetailView;
      error?: { message: string };
    };
    const transcriptPayload = (await transcriptResponse.json()) as {
      transcript?: TranscriptView[];
    };
    if (!detailResponse.ok || !detailPayload.interview)
      throw new Error(detailPayload.error?.message ?? "Could not load interview.");
    setItem(detailPayload.interview);
    setTranscript(transcriptPayload.transcript ?? []);
    return detailPayload.interview;
  }, [id]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      Promise.all([load(), fetch("/api/health").then((response) => response.json())])
        .then(([, value]) => setHealth(value as Health))
        .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load voice mode."));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const clearTimers = useCallback(() => {
    for (const timer of timersRef.current) window.clearTimeout(timer);
    timersRef.current = [];
  }, []);

  const uploadTracks = useCallback(async () => {
    const recorder = recorderRef.current;
    const attemptId = attemptIdRef.current;
    recorderRef.current = null;
    if (!recorder || !attemptId) return;
    const tracks = await recorder.stop();
    await recorder.dispose();
    for (const track of tracks) {
      const form = new FormData();
      form.set("file", track.blob, `${track.role}.audio`);
      form.set("attemptId", attemptId);
      form.set("trackRole", track.role);
      form.set("durationMs", String(track.durationMs));
      form.set("startOffsetMs", String(track.startOffsetMs));
      const response = await fetch(`/api/interviews/${id}/recordings`, {
        method: "POST",
        body: form,
      });
      if (!response.ok) throw new Error("A local recording track could not be saved.");
    }
    if (tracks.length) setRecordingStatus("Saved locally");
  }, [id]);

  const releaseMedia = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    if (audioRef.current) audioRef.current.srcObject = null;
  }, []);

  const cleanup = useCallback(async () => {
    clearTimers();
    clientRef.current?.interrupt();
    await clientRef.current?.disconnect().catch(() => undefined);
    clientRef.current = null;
    fakeRef.current = null;
    await uploadTracks().catch(() => setRecordingStatus("Recording save failed"));
    releaseMedia();
    connectingRef.current = false;
  }, [clearTimers, releaseMedia, uploadTracks]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (startedAtRef.current)
        setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 1000);
    const unload = () => {
      clientRef.current?.interrupt();
      void clientRef.current?.disconnect();
      void recorderRef.current?.stop();
      for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("beforeunload", unload);
      void cleanup();
    };
  }, [cleanup]);

  const postAction = useCallback(async (body: Record<string, string | boolean>) => {
    const response = await fetch(`/api/interviews/${id}/voice-actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, actionId: crypto.randomUUID() }),
    });
    const payload = (await response.json()) as { error?: { message: string } };
    if (!response.ok) throw new Error(payload.error?.message ?? "The voice action failed.");
  }, [id]);

  const handleFinalAnswer = useCallback(async (providerItemId: string, answer: string) => {
    if (processedRef.current.has(providerItemId) || !answer.trim()) return;
    processedRef.current.add(providerItemId);
    setBusy(true);
    try {
      await postAction({ action: "submit-voice-answer", providerItemId, answer: answer.trim() });
      const current = await load();
      setInterim("");
      if (current.status === "completed") {
        await clientRef.current?.speakCompletion("Thank you. This practice interview is complete.");
        await cleanup();
      } else {
        const next = current.questions[current.currentQuestionIndex];
        await clientRef.current?.speakQuestion({
          question: next.question,
          questionSequence: next.sequence,
        });
      }
    } catch (caught) {
      processedRef.current.delete(providerItemId);
      setError(caught instanceof Error ? caught.message : "Could not save the transcript.");
    } finally {
      setBusy(false);
      setCandidateSpeaking(false);
    }
  }, [cleanup, load, postAction]);

  async function startSession() {
    if (!item || !health || !audioConsent || connectingRef.current) return;
    if (!health.realtimeEnabled && !health.realtimeFakeEnabled) return;
    connectingRef.current = true;
    setBusy(true);
    setError("");
    setWarning("");
    setConnection("requesting-permission");
    try {
      const fake = health.realtimeFakeEnabled;
      const stream = fake
        ? null
        : await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
          });
      streamRef.current = stream;
      const tokenResponse = await fetch("/api/realtime/client-secret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interviewId: id }),
        cache: "no-store",
      });
      const payload = (await tokenResponse.json()) as ClientSecretResponse & {
        error?: { message: string };
      };
      if (!tokenResponse.ok)
        throw new Error(payload.error?.message ?? "Could not prepare the voice connection.");
      attemptIdRef.current = payload.attemptId;
      const client = fake
        ? new FakeRealtimeInterviewClient()
        : new OpenAIRealtimeWebRTCClient();
      if (client instanceof FakeRealtimeInterviewClient) fakeRef.current = client;
      clientRef.current = client;
      client.subscribe((event) => {
        if (event.type === "state") {
          setConnection(event.state);
          if (event.state === "disconnected" && attemptIdRef.current)
            void postAction({
              action: "disconnect-voice",
              attemptId: attemptIdRef.current,
            }).catch(() => undefined);
        }
        else if (event.type === "interviewer-speaking")
          setInterviewerSpeaking(event.speaking);
        else if (event.type === "candidate-speaking")
          setCandidateSpeaking(event.speaking);
        else if (event.type === "error") setError(event.message);
        else if (event.type === "transcript") {
          if (event.transcript.role === "interviewer")
            setLiveInterviewer(event.transcript.text);
          else if (event.transcript.isFinal)
            void handleFinalAnswer(event.transcript.providerItemId, event.transcript.text);
          else {
            setInterim(event.transcript.text);
            setCandidateSpeaking(true);
          }
        }
      });
      if (recordingConsent) {
        const recorder: InterviewRecorder = fake
          ? new FakeInterviewRecorder()
          : new BrowserDualTrackRecorder();
        if (!recorder.isSupported()) setRecordingStatus("Recording unsupported");
        else {
          await recorder.prepare({ candidateStream: stream ?? {} });
          recorderRef.current = recorder;
          setRecordingStatus("Ready");
        }
      }
      const audioElement = audioRef.current;
      if (!audioElement) throw new Error("Audio output is unavailable.");
      await client.connect({
        ...payload,
        mediaStream: stream ?? {},
        audioElement,
        interviewTitle: item.title,
        language: item.language,
        onInterviewerStream: (remote) => recorderRef.current?.attachInterviewerStream(remote),
      });
      const resume = item.status === "active";
      await postAction({
        action: resume ? "resume-voice" : "start-voice",
        attemptId: payload.attemptId,
        recordingConsent,
      });
      recorderRef.current?.start();
      if (recorderRef.current) setRecordingStatus("Recording two tracks");
      startedAtRef.current ||= Date.now();
      const current = (await load()).questions[item.currentQuestionIndex];
      await client.speakQuestion({ question: current.question, questionSequence: current.sequence });
      const warningDelay = Math.max(0, (payload.maxSessionSeconds - 60) * 1000);
      timersRef.current.push(window.setTimeout(() => setWarning("This voice session will end in one minute."), warningDelay));
      timersRef.current.push(window.setTimeout(() => {
        void postAction({ action: "cancel-voice" })
          .then(load)
          .then(() => setWarning("The maximum voice session duration was reached."))
          .finally(() => void cleanup());
      }, payload.maxSessionSeconds * 1000));
    } catch (caught) {
      const name = caught instanceof DOMException ? caught.name : "";
      setError(
        name === "NotAllowedError"
          ? "Microphone permission was denied."
          : name === "NotFoundError"
            ? "No microphone was found."
            : caught instanceof Error
              ? caught.message
              : "Could not start voice mode.",
      );
      await cleanup();
      setConnection("failed");
    } finally {
      connectingRef.current = false;
      setBusy(false);
    }
  }

  async function repeat() {
    if (!item || busy) return;
    setBusy(true);
    try {
      await postAction({ action: "repeat-voice-question" });
      await load();
      const question = item.questions[item.currentQuestionIndex];
      await clientRef.current?.speakQuestion({ question: question.question, questionSequence: question.sequence });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not repeat the question.");
    } finally { setBusy(false); }
  }

  async function clarify() {
    if (!item || busy) return;
    setBusy(true);
    try {
      await postAction({ action: "clarify-voice-question" });
      const current = await load();
      const clarification = [...(await fetch(`/api/interviews/${id}/transcript`).then((r) => r.json()) as { transcript: TranscriptView[] }).transcript]
        .reverse().find((entry) => entry.eventType === "clarification_response")?.text;
      const question = current.questions[current.currentQuestionIndex];
      await clientRef.current?.speakClarification({
        clarification: clarification ?? question.clarification ?? "Please explain the question in neutral terms.",
        questionSequence: question.sequence,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not clarify the question.");
    } finally { setBusy(false); }
  }

  async function endInterview(fromLimit = false) {
    if (!item || item.status !== "active") return;
    setBusy(true);
    try {
      await postAction({ action: "cancel-voice" });
      await load();
      if (fromLimit) setWarning("The maximum voice session duration was reached.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not end the interview.");
    } finally {
      await cleanup();
      setBusy(false);
    }
  }

  function simulateAnswer() {
    fakeRef.current?.emitCandidateInterim(`fake-${crypto.randomUUID()}`, "Interim fake answer");
    const id = `fake-${crypto.randomUUID()}`;
    fakeRef.current?.emitCandidateFinal(id, `Saved fake answer ${item?.currentQuestionIndex ?? 0 + 1}`);
  }

  if (!item || !health) return <p aria-live="polite">Loading voice interview…</p>;
  const configured = health.realtimeEnabled || health.realtimeFakeEnabled;
  const active = item.status === "active";
  const current = active || item.status === "ready"
    ? item.questions[Math.min(item.currentQuestionIndex, item.questions.length - 1)]
    : null;
  return (
    <div className="stack">
      <div>
        <p className="eyebrow">Guided Realtime Voice Practice</p>
        <h1 style={{ fontSize: "2.7rem" }}>{item.title}</h1>
        <p className="muted">Voice uses OpenAI API billing. The application—not the model—controls the fixed question sequence.</p>
      </div>
      {!configured && <p className="error" role="alert">Voice mode is not configured on this server.</p>}
      {(connection === "idle" || connection === "failed" || connection === "disconnected") && item.status !== "completed" && item.status !== "cancelled" && (
        <VoiceConsentPanel
          audioConsent={audioConsent}
          recordingConsent={recordingConsent}
          recordingsEnabled={health.recordingsEnabled}
          disabled={busy}
          onAudioConsent={setAudioConsent}
          onRecordingConsent={setRecordingConsent}
        />
      )}
      <div className="interview-layout">
        <section className="card stack">
          <VoiceConnectionStatus state={connection} muted={muted} interviewerSpeaking={interviewerSpeaking} candidateSpeaking={candidateSpeaking} />
          <div className="voice-timer">{String(Math.floor(elapsed / 60)).padStart(2, "0")}:{String(elapsed % 60).padStart(2, "0")}</div>
          {current ? (
            <>
              <div>
                <p className="question-number">Question {item.currentQuestionIndex + 1} of {item.questionCount} · {current.competency}</p>
                <h2>{current.question}</h2>
              </div>
              <div className="live-transcript">
                <p><strong>Live candidate transcript</strong> <VoiceLevelIndicator active={candidateSpeaking} /></p>
                <p>{interim || "Waiting for finalized speech…"}</p>
                {liveInterviewer && <p className="muted">Interviewer output: {liveInterviewer}</p>}
              </div>
              <div className="actions">
                {(connection === "idle" || connection === "failed" || connection === "disconnected") && (
                  <button className="button" disabled={!configured || !audioConsent || busy} onClick={() => void startSession()}>
                    {active ? "Resume Voice Interview" : "Start voice session"}
                  </button>
                )}
                {connection === "connected" && (
                  <>
                    <button className="button secondary" onClick={() => { if (muted) clientRef.current?.unmute(); else clientRef.current?.mute(); setMuted(!muted); }}>{muted ? "Unmute" : "Mute"}</button>
                    <button className="button secondary" onClick={() => clientRef.current?.interrupt()}>Interrupt interviewer</button>
                    <button className="button secondary" disabled={busy} onClick={() => void repeat()}>Repeat question</button>
                    <button className="button secondary" disabled={busy} onClick={() => void clarify()}>Ask for clarification</button>
                    {health.realtimeFakeEnabled && <button className="button secondary" disabled={busy} onClick={simulateAnswer}>Simulate final answer</button>}
                    <button className="button danger" disabled={busy} onClick={() => void endInterview()}>End interview</button>
                  </>
                )}
              </div>
            </>
          ) : (
            <div>
              <h2>{item.status === "completed" ? "Practice complete" : "Practice ended"}</h2>
              <p>Your stable transcript has been saved.</p>
              <a className="button" href={`/interviews/${id}`}>View details</a>
            </div>
          )}
          <p><strong>Recording:</strong> {recordingStatus}</p>
          <audio ref={audioRef} autoPlay playsInline />
          {warning && <p className="warning" role="status">{warning}</p>}
          {error && <p className="error" role="alert">{error}</p>}
        </section>
        <TranscriptPanel items={transcript} />
      </div>
    </div>
  );
}
