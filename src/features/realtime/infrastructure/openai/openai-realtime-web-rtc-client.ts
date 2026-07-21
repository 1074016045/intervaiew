"use client";

import {
  OpenAIRealtimeWebRTC,
  RealtimeAgent,
  RealtimeSession,
} from "@openai/agents/realtime";
import type { RealtimeInterviewClient } from "../../application/realtime-interview-client.port";
import { buildRealtimeInterviewerInstructions } from "../../application/build-realtime-interviewer-instructions";
import { RealtimeSessionController } from "../../application/realtime-session-controller";
import { safeRealtimeMessage } from "../../domain/realtime-errors";
import type {
  RealtimeClarificationSpeechInput,
  RealtimeConnectInput,
  RealtimeEvent,
  RealtimeEventListener,
  RealtimeQuestionSpeechInput,
} from "../../domain/realtime.types";
import {
  normalizeRealtimeHistory,
  normalizeRealtimeTransportEvent,
} from "./openai-realtime-event-normalizer";

function assertMediaStream(value: unknown): asserts value is MediaStream {
  if (!(value instanceof MediaStream))
    throw new Error("A browser microphone stream is required.");
}

function assertAudioElement(value: unknown): asserts value is HTMLAudioElement {
  if (!(value instanceof HTMLAudioElement))
    throw new Error("A browser audio element is required.");
}

export class OpenAIRealtimeWebRTCClient implements RealtimeInterviewClient {
  private readonly controller = new RealtimeSessionController();
  private readonly listeners = new Set<RealtimeEventListener>();
  private session: RealtimeSession | null = null;
  private transport: OpenAIRealtimeWebRTC | null = null;
  private connectPromise: Promise<void> | null = null;
  private emittedTranscript = new Map<string, string>();
  private interimTranscript = new Map<string, string>();
  private pendingSpeech: {
    promise: Promise<void>;
    resolve: () => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  } | null = null;

  connect(input: RealtimeConnectInput) {
    if (this.connectPromise) return this.connectPromise;
    if (this.getState() === "connected")
      return Promise.reject(new Error("Realtime client is already connected."));
    this.connectPromise = this.open(input).finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  private async open(input: RealtimeConnectInput) {
    if (typeof RTCPeerConnection === "undefined") {
      this.fail("WEBRTC_UNSUPPORTED");
      throw new Error(safeRealtimeMessage("WEBRTC_UNSUPPORTED"));
    }
    assertMediaStream(input.mediaStream);
    assertAudioElement(input.audioElement);
    this.setState(
      this.getState() === "disconnected" ? "reconnecting" : "connecting",
    );
    const transport = new OpenAIRealtimeWebRTC({
      baseUrl: `${input.baseUrl.replace(/\/$/, "")}/v1/realtime/calls`,
      mediaStream: input.mediaStream,
      audioElement: input.audioElement,
      changePeerConnection: (peerConnection) => {
        peerConnection.addEventListener("track", (event) => {
          const stream = event.streams[0] ?? new MediaStream([event.track]);
          input.onInterviewerStream?.(stream);
        });
        return peerConnection;
      },
    });
    const agent = new RealtimeAgent({
      name: "Guided practice interviewer",
      voice: input.voice,
      instructions: buildRealtimeInterviewerInstructions({
        interviewTitle: input.interviewTitle,
        language: input.language,
      }),
      tools: [],
      handoffs: [],
    });
    const session = new RealtimeSession(agent, {
      transport,
      model: input.model,
      historyStoreAudio: false,
      tracingDisabled: true,
      config: {
        outputModalities: ["audio"],
        audio: {
          input: {
            transcription: { model: input.transcriptionModel },
            noiseReduction: { type: "far_field" },
            turnDetection: {
              type: "server_vad",
              createResponse: false,
              interruptResponse: true,
              prefixPaddingMs: 300,
              silenceDurationMs: input.silenceDurationMs,
            },
          },
          output: { voice: input.voice },
        },
      },
    });
    this.transport = transport;
    this.session = session;
    this.bindEvents(session, transport);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        session.connect({
          apiKey: input.clientSecret,
          model: input.model,
        }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("REALTIME_CONNECTION_TIMEOUT")),
            input.connectTimeoutMs,
          );
        }),
      ]);
      this.setState("connected");
    } catch (error) {
      transport.close();
      this.fail(
        error instanceof Error &&
          error.message === "REALTIME_CONNECTION_TIMEOUT"
          ? "REALTIME_CONNECTION_TIMEOUT"
          : "REALTIME_PROVIDER_UNAVAILABLE",
      );
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private bindEvents(
    session: RealtimeSession,
    transport: OpenAIRealtimeWebRTC,
  ) {
    session.on("history_updated", (history) => {
      for (const transcript of normalizeRealtimeHistory(history)) {
        const signature = `${transcript.text}:${transcript.isFinal}`;
        if (this.emittedTranscript.get(transcript.providerItemId) === signature)
          continue;
        this.emittedTranscript.set(transcript.providerItemId, signature);
        this.emit({ type: "transcript", transcript });
      }
    });
    session.on("transport_event", (event) => {
      const normalized = normalizeRealtimeTransportEvent(event);
      if (!normalized) return;
      if (normalized.type === "input_audio_buffer.speech_started")
        this.emit({ type: "candidate-speaking", speaking: true });
      else if (normalized.type === "input_audio_buffer.speech_stopped")
        this.emit({ type: "candidate-speaking", speaking: false });
      else if (
        normalized.type ===
          "conversation.item.input_audio_transcription.delta" &&
        normalized.item_id &&
        normalized.delta
      ) {
        const text =
          (this.interimTranscript.get(normalized.item_id) ?? "") +
          normalized.delta;
        this.interimTranscript.set(normalized.item_id, text);
        this.emit({
          type: "transcript",
          transcript: {
            providerItemId: normalized.item_id,
            role: "candidate",
            text,
            isFinal: false,
            createdAt: Date.now(),
          },
        });
      }
    });
    session.on("audio_start", () =>
      this.emit({ type: "interviewer-speaking", speaking: true }),
    );
    session.on("audio_stopped", () =>
      this.emit({ type: "interviewer-speaking", speaking: false }),
    );
    session.on("audio_interrupted", () => {
      this.emit({ type: "interrupted" });
      this.emit({ type: "interviewer-speaking", speaking: false });
    });
    session.on("error", () =>
      this.emit({
        type: "error",
        code: "REALTIME_PROVIDER_UNAVAILABLE",
        message: safeRealtimeMessage("REALTIME_PROVIDER_UNAVAILABLE"),
      }),
    );
    transport.on("connection_change", (status) => {
      if (status === "disconnected" && this.getState() === "connected")
        this.setState("disconnected");
    });
    transport.on("turn_started", () =>
      this.emit({ type: "interviewer-speaking", speaking: true }),
    );
    transport.on("turn_done", () => this.finishPendingSpeech());
    transport.on("error", () =>
      this.finishPendingSpeech(
        new Error(safeRealtimeMessage("REALTIME_PROVIDER_UNAVAILABLE")),
      ),
    );
  }

  async disconnect() {
    const state = this.getState();
    if (state === "idle" || state === "disconnected") return;
    if (state !== "disconnecting") this.setState("disconnecting");
    this.session?.close();
    this.finishPendingSpeech(new Error("Realtime session disconnected."));
    this.session = null;
    this.transport = null;
    this.emittedTranscript.clear();
    this.interimTranscript.clear();
    this.setState("disconnected");
  }

  async speakQuestion(input: RealtimeQuestionSpeechInput) {
    return this.requestSpeech(
      `Speak only this canonical question naturally:\n${input.question}`,
    );
  }

  async speakClarification(input: RealtimeClarificationSpeechInput) {
    return this.requestSpeech(
      `Clarify only the meaning of the current question without giving an answer:\n${input.clarification}`,
    );
  }

  async speakCompletion(message: string) {
    return this.requestSpeech(
      `Speak this one brief neutral closing sentence:\n${message}`,
    );
  }

  private requestSpeech(instructions: string) {
    if (this.getState() !== "connected" || !this.transport)
      throw new Error("Realtime client is not connected.");
    if (this.pendingSpeech)
      throw new Error("A realtime speech response is already in progress.");
    let resolveSpeech: () => void = () => {};
    let rejectSpeech: (error: Error) => void = () => {};
    const promise = new Promise<void>((resolve, reject) => {
      resolveSpeech = resolve;
      rejectSpeech = reject;
    });
    const timeout = setTimeout(
      () =>
        this.finishPendingSpeech(
          new Error(safeRealtimeMessage("REALTIME_PROVIDER_UNAVAILABLE")),
        ),
      60_000,
    );
    this.pendingSpeech = {
      promise,
      resolve: resolveSpeech,
      reject: rejectSpeech,
      timeout,
    };
    try {
      this.transport.requestResponse({
        conversation: "none",
        output_modalities: ["audio"],
        instructions,
      });
    } catch (error) {
      this.finishPendingSpeech(
        error instanceof Error ? error : new Error("Speech request failed."),
      );
    }
    return promise;
  }

  private finishPendingSpeech(error?: Error) {
    const pending = this.pendingSpeech;
    if (!pending) return;
    this.pendingSpeech = null;
    clearTimeout(pending.timeout);
    if (error) pending.reject(error);
    else pending.resolve();
  }

  mute() {
    this.session?.mute(true);
  }

  unmute() {
    this.session?.mute(false);
  }

  interrupt() {
    this.session?.interrupt();
    this.finishPendingSpeech(new Error("Interviewer speech was interrupted."));
  }

  getState() {
    return this.controller.getState();
  }

  subscribe(listener: RealtimeEventListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(
    state: Parameters<RealtimeSessionController["transition"]>[0],
  ) {
    this.controller.transition(state);
    this.emit({ type: "state", state });
  }

  private fail(code: string) {
    if (this.getState() !== "failed") this.setState("failed");
    this.emit({ type: "error", code, message: safeRealtimeMessage(code) });
  }

  private emit(event: RealtimeEvent) {
    for (const listener of this.listeners) listener(event);
  }
}
