# Architecture

## Decision summary

IntervAIew is a modular monolith: one deployable Next.js application with explicit Domain, Application, Infrastructure, and UI boundaries. This keeps the local MVP easy to run and transact while preventing provider SDKs, SQLite, or React from leaking across boundaries.

```text
UI / Route Handlers → Application Use Cases → Domain
                              ↓
                    Infrastructure Ports
```

Domain contains provider-neutral interview types, pure transition rules, question-plan types, transcript types, and recognizable errors. Application code coordinates use cases through ports. Infrastructure implements SQLite, provider clients, repositories, safe logging, IDs, and time. UI validates input, renders states, and requests business actions; it never selects providers or accesses keys/database code.

## Text AI

```text
Question Planner
       ↓
TextModelProvider
   ┌───────┼────────┐
 Mock   DeepSeek   OpenAI
```

DeepSeek is the first real text provider, Mock is the default/test provider, and OpenAI is a working switchable adapter. The DeepSeek adapter uses OpenAI-compatible `chat.completions.create`, JSON mode, and the locally typed `thinking: { type: "disabled" }` extension. The extension is a narrow intersection with the SDK request type—no `any`, `@ts-ignore`, or whole-request cast. OpenAI uses the current SDK Responses API. Neither provider falls back to another.

`StructuredQuestionPlanner` owns business input validation, prompt construction, JSON parsing, Zod validation, exact count/sequence/duplicate checks, and one controlled repair attempt. Provider adapters only generate text and normalize metadata/errors.

Resume and JD are untrusted, delimited user-prompt data. System rules explicitly prohibit following document instructions, revealing prompts/configuration, or inventing experience. Request bodies and model reasoning are never logged or persisted.

## SQLite and migrations

The MVP uses `better-sqlite3 12.11.1` with Drizzle because local synchronous transactions are reliable and simple, foreign-key cascade is native, and the current version builds successfully on Apple Silicon with Node 24.18.0. `@libsql/client` was unnecessary. Connections enable foreign keys, WAL, and a 5000 ms busy timeout. All timestamps are epoch milliseconds and map to `Date` in Drizzle.

Drizzle Kit owns versioned SQL in `src/infrastructure/db/migrations`; `pnpm db:migrate` applies it. Integration tests migrate a fresh database in an isolated OS temporary directory.

## State and transactions

Allowed transitions:

```text
draft → planning
planning → ready | draft
ready → planning | active | cancelled
active → ending | cancelled | failed
ending → completed | failed
```

Question regeneration replaces all old questions and session plan metadata in one transaction. Generation failure returns `planning` to `draft` with a safe code. Text actions load the state, invoke the domain controller, append transcript rows, update progress/times, and insert an action receipt in one transaction.

`(session_id, action_id)` is unique. A retried action returns current state without another transcript write or index advance. Transcript sequence is likewise unique per session. The final answer moves through `ending` to `completed`, records one completion message, sets end time/duration, and uses `currentQuestionIndex === questionCount` as the documented completion sentinel.

## Deterministic text interview

Only question-plan generation invokes AI. Start, submit, next-question selection, repeat, clarification, cancellation, and completion use stored questions and deterministic application logic. This makes retries safe, reduces cost, and prevents new model output from changing the interview mid-session.

## Guided Realtime Voice (v0.2)

Voice keeps text planning separate and does not create an autonomous interview agent:

```text
DeepSeek Question Planning
          ↓
OpenAI Realtime Interviewer
          ↓
Transcript Synchronizer
          ↓
Web Audio + MediaRecorder
```

Recording must require explicit consent, keep separate interviewer/candidate tracks where technically available, and reconcile realtime events into the existing stable transcript model.

The stored question plan is canonical. The browser adapter requests out-of-band speech for a stored question, clarification, or closing sentence. `server_vad` uses `create_response=false`, so candidate turn completion never lets the model freely answer or select the next question. Only a finalized input transcription calls the transactional `submit-voice-answer` use case; `InterviewController.submitAnswer()` selects the next stored question or completes the session. Realtime output transcripts are live UI data and never replace canonical questions.

```text
Voice React UI → RealtimeInterviewClient port → OpenAIRealtimeWebRTC adapter
       │                       │
       │                       └→ Fake adapter (tests/explicit non-production config)
       ↓
VoiceInterviewService → InterviewController → SQLite transaction
```

Domain and application code do not import the Agents SDK, WebRTC, MediaStream, MediaRecorder, audio elements, or Node filesystem APIs. The OpenAI adapter imports `RealtimeAgent`, `RealtimeSession`, and `OpenAIRealtimeWebRTC` from `@openai/agents/realtime`; tools, handoffs, MCP, tracing, and history audio storage are disabled.

## Ephemeral connection and attempts

`POST /api/realtime/client-secret` validates same-origin, a strict `{interviewId}` body, question-plan readiness, feature configuration, permanent server key presence, and a bounded mint rate. The server calls the GA `/v1/realtime/client_secrets` endpoint with fixed model, voice, transcription, instructions, and VAD configuration. The browser receives only a short-lived `ek_` value and safe connection metadata under `no-store`/`no-cache` headers. Each successful mint creates a `realtime_attempts` row; disconnect leaves the interview active so a new attempt can resume the same question.

## Recording storage

Recording consent is independent and false by default. The candidate `MediaStream` is shared with WebRTC and a candidate `MediaRecorder`. The OpenAI transport's peer connection supplies a remote interviewer stream to a separate recorder. Supported MIME types are selected at runtime. MediaRecorder failure never disables voice.

## Transcript Lab (v0.3)

Transcript Lab is a separate Practice / Authorized Demo feature for deterministic streaming-state research:

```text
FakeTranscriptStreamClient
        ↓
TranscriptBuffer
        ↓
TranscriptIngestionService
        ↓
Analysis Repository
        ↓
SQLite
```

`TranscriptChunk` and the stream port are provider-neutral. `TranscriptBuffer` is pure in-memory logic: it retains only the newest interim, sorts accepted final chunks by sequence, permanently deduplicates accepted final provider IDs, reports sequence conflicts explicitly, and returns frozen snapshots. A final clears only an interim with the same provider ID or an equal/older sequence.

`FakeTranscriptStreamClient` receives a scheduler port. Pause freezes stream-relative time, resume continues from the remaining delay, and stop/failure/dispose cancel pending work. Its browser scheduler is used only after an explicit Start in non-production when `TRANSCRIPT_LAB_FAKE_ENABLED=true`; unit tests use a manually advanced scheduler.

Only `TranscriptIngestionService` can send final chunks to the provider-neutral analysis repository. The SQLite adapter performs session lookup, state validation, provider-ID idempotency, sequence-conflict detection, insertion, and first-write activation in one transaction. `(analysis_session_id, provider_segment_id)` and `(analysis_session_id, sequence)` are unique. API responses expose safe segment views, never database exceptions or transcript log content.

Transcript Lab does not reuse or rewrite Guided Realtime Voice. It does not use `RealtimeInterviewClient`, OpenAI WebRTC, microphone transfer, MediaRecorder, recording storage, the canonical interview question state machine, or existing interview transcripts. Conversely, v0.2 Voice does not write `analysis_sessions` or `transcript_segments`. Question-boundary detection and answer generation are outside v0.3.

Stopped tracks upload only to the application server. `recording_assets` stores metadata and a relative path; bytes live beneath `RECORDINGS_PATH`, never in SQLite. Upload uses bounded size/MIME validation, random server names, an atomic temporary-file rename, restrictive permissions, and database/file compensation. Playback supports byte ranges. Interview deletion validates and removes recording files before foreign-key cascade removes metadata.
