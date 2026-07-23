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

Transcript Lab does not reuse or rewrite Guided Realtime Voice. It does not use `RealtimeInterviewClient`, OpenAI WebRTC, microphone transfer, MediaRecorder, recording storage, the canonical interview question state machine, or existing interview transcripts. Conversely, v0.2 Voice does not write `analysis_sessions` or `transcript_segments`. Question-boundary detection extends the Lab without changing this ingestion path. Answer generation remains outside v0.3.

## Question Boundary Detector v0.3

```text
Final Transcript Segments
        ↓
QuestionCandidateBuilder
        ↓
Deterministic Boundary Detector
        ↓
Hybrid Boundary Detector
        ↓
Semantic Provider Port (Fake in automated/non-production research)
        ↓
QuestionSegmentationService
        ↓
SQLite
```

The candidate builder reads persisted final segments in sequence order, selects only interviewer segments not assigned to an active finalized question, retains source IDs, and increments the stable active candidate revision when another segment arrives. Candidate/unknown roles do not enter automatic question candidates. Undo releases a question's segments; merge replaces the previous question's mapping with the ordered, deduplicated union.

The deterministic detector is pure and provider-neutral. The hybrid detector partitions short, deterministic-only, medium gray-zone, and long-pause behavior. Semantic inputs contain only candidate text, language hint, deterministic signals, pause, and revision. Outputs pass strict Zod validation and exclude reasoning/raw payloads. An AbortController plus revision check supersedes stale responses, while same-revision semantic decisions are cached.

`QuestionSegmentationService` coordinates evaluation and manual actions through a repository port. SQLite refreshes the candidate from transcript/finalized-question facts before committing a decision, then writes decision, finalized question, source mappings, and action receipt transactionally. `(analysis_session_id, action_id)` makes retries idempotent. Client routes can request an action but cannot submit `shouldFinalize`, confidence, or a provider decision.

Stopped tracks upload only to the application server. `recording_assets` stores metadata and a relative path; bytes live beneath `RECORDINGS_PATH`, never in SQLite. Upload uses bounded size/MIME validation, random server names, an atomic temporary-file rename, restrictive permissions, and database/file compensation. Playback supports byte ranges. Interview deletion validates and removes recording files before foreign-key cascade removes metadata.

## Question Understanding v0.3

```text
Active Finalized Question + Revision + Boundary Decision
                         ↓
        DeterministicQuestionUnderstander (pure rules)
                         ↓
          HybridQuestionUnderstander (gray zones only)
                         ↓
   FakeQuestionUnderstandingProvider (explicit non-production only)
                         ↓
        QuestionUnderstandingService → repository port → SQLite
```

Domain schemas own the closed language, family, answer-mode, dimension, constraint, clarification, decision-source, and status taxonomies. Domain/application code imports no Next.js, SQLite, provider SDK, fetch, browser, filesystem, or environment module. Infrastructure owns Fake configuration and SQLite conversion. The UI and routes call the application service and never submit question wording or trusted classifications.

Only active `finalized_questions` are inputs. The service performs semantic work outside the transaction, then the repository transaction re-reads question ownership, `undone_at`, revision, and boundary-decision provenance before committing. `(finalized_question_id, finalized_question_revision)` is unique. Same-revision analyses use the stored result; action receipts make retries idempotent. Merge and undo supersede affected results, while active GET excludes undone questions.

The deterministic analyzer uses small named English/Chinese family, dimension, constraint, focus, and clarification rules. The hybrid layer bypasses semantic work for high-confidence results. Its only implementation is a deterministic network-free Fake that is impossible to enable in production; failure returns validated bounded deterministic metadata. No provider payload, prompt, hidden reasoning, summary, answer, resume evidence, or candidate evaluation is persisted.

## Uploaded Audio v0.4

```text
Explicit multipart upload → UploadedAudioService → UploadedAudioStoragePort → filesystem
                                      │
                                      └→ UploadedAudioRepositoryPort → SQLite metadata/action receipt

Explicit Transcribe → AudioTranscriptionProvider → TranscriptIngestionService → SQLite final segments
```

Uploaded audio belongs to an existing `analysis_sessions` row. Routes translate HTTP/File inputs into bounded application commands; the application service owns upload/transcribe/delete orchestration; the filesystem, SQLite, environment, and Fake adapter remain infrastructure. Domain/application code imports no Next.js, SQLite, filesystem, browser, provider SDK, or environment module.

`uploaded_audio_assets` stores one declared whole-file speaker role, bounded display filename, safe MIME type, size, SHA-256, server relative path, status, provider-neutral label, safe error code, segment count, and timestamps. Bytes are never stored in SQLite. `uploaded_audio_actions` makes upload/transcribe/delete retries session-idempotent. `transcript_segments.source_uploaded_audio_asset_id` traces committed output while present and uses `ON DELETE SET NULL`, so asset deletion never cascades transcript deletion.

Filesystem names use server UUIDs rather than display names. A temporary `0600` file is synced and atomically renamed beneath a `0700` root/session directory. Lexical containment, UUID path grammar, `lstat`, `realpath`, and symlink checks reject traversal/escape. Upload compensates file creation if metadata persistence fails. Before Next.js buffers multipart data, the collection route requires a finite positive decimal `Content-Length` no larger than the configured file limit plus an explicit 64 KiB multipart allowance. Unknown-length/chunked uploads are intentionally rejected in v0.4; the post-parse file-size check remains authoritative for the selected file.

Transcription is separate from upload and GET. The application reads stored bytes and invokes the provider outside SQLite work. After provider work, `TranscriptIngestionService.ingestUploadedAudio` enters one authoritative SQLite transaction that revalidates session/asset/action ownership and state, recognizes already-linked segments idempotently, assigns server sequences/provider IDs, inserts only finalized source-linked segments, activates a draft session, and marks the asset completed with its provider label, segment count, timestamps, and cleared failure fields. A rollback covers all these writes. Failure handling validates the action and never overwrites a completed or deleting asset. The declared role is applied to every chunk; v0.4 does not diarize. The only adapter is deterministic non-production Fake. No real provider or model is selected in v0.4.

Filesystem and SQLite deletion are explicitly compensating rather than presented as one atomic resource transaction. `uploaded_audio_deletion_batches` and `uploaded_audio_deletion_files` durably record server-derived original/tombstone paths and progress through `planned → metadata_deleted → completed`. Deletion first marks assets `deleting`, then idempotently renames files to same-directory UUID tombstones. If authoritative asset/session deletion fails, every staged rename is rolled back; failed rollback remains addressable through the durable plan. After authoritative database deletion, unlink and completion marking are retryable, including when the analysis-session row is already gone. Individual completion nulls transcript source links through `ON DELETE SET NULL`; transcript rows remain. Active transcription blocks deletion, and an incomplete asset deletion blocks whole-session deletion until its own plan is resumed.

Deletion batches intentionally have no foreign key to analysis sessions or assets, and `uploaded_audio_actions.asset_id` intentionally has no asset foreign key. Those durable receipts/plans must survive authoritative metadata deletion long enough to complete or retry filesystem cleanup. The deletion-file rows cascade only with their durable batch. Client paths are never accepted.
