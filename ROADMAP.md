# Roadmap

## v0.1 (complete)

Deterministic Mock and real text-provider adapters; personalized question plans; transactional text interview; transcript, history, export, and deletion.

## v0.2 (complete): Guided Realtime Voice Practice

```text
DeepSeek Question Planning
          ↓
OpenAI Realtime Interviewer
          ↓
Transcript Synchronizer
          ↓
Web Audio + MediaRecorder
```

Implemented: separate OpenAI WebRTC and Fake Realtime adapters, server-issued ephemeral client secrets, explicit media-transfer consent, optional/default-off dual-track recording, stable finalized transcript synchronization, deterministic canonical questions, reconnect attempts, and local playback/download/deletion controls. Text and realtime providers remain independent.

Manual validation remains necessary for real OpenAI credentials, macOS Chrome/Safari microphone permission, remote track timing, audio-device changes, and provider/account-specific behavior.

## v0.3 (complete): Transcript Lab, Question Boundary, and Question Understanding

Implemented: a provider-neutral transcript chunk model, immutable interim/final buffer, scheduler-driven Fake Transcript Stream, pause/resume/stop/failure cleanup, transactional and idempotent SQLite final-segment ingestion, refresh recovery, strict same-origin APIs, and Practice / Authorized Demo UI and tests.

Question Boundary Detector is also complete: revisioned interviewer-only candidates, Chinese/English deterministic signals, medium-pause Fake Semantic gray-zone decisions, hybrid fallback/long-pause rules, stale-response protection, same-revision semantic caching, decision audit, source-traceable finalized questions, and idempotent Force Finalize/Merge/Undo.

Question Understanding is complete as an isolated metadata stage over active finalized questions: strict closed taxonomies, auditable bilingual deterministic rules, optional non-production local Fake Semantic gray-zone handling, structured constraint/focus traceability, revision-bound provenance, idempotent explicit analysis, transactional stale-result protection, persistence, APIs, UI, synthetic evaluation, and tests.

Interim chunks remain memory-only. Final chunks persist with provider-ID and sequence uniqueness. Both Fake Semantic implementations are deterministic and network-free. This phase does not implement real audio capture, resume evidence retrieval, experience matching, scoring, suggested answers, or answer generation.

## v0.4 (complete): Uploaded Audio

Implemented: explicit practice/authorized-demo upload to an existing Transcript Lab session; one required whole-file `interviewer` or `candidate` role; strict pre-parse request-length plus MIME, extension, signature, empty/size, filename, path, and ownership validation; random server storage names; atomic restrictive filesystem writes outside SQLite; bounded metadata and content hashes; upload/transcribe/delete action receipts; durable retryable staged deletion; and explicit transcription with one atomic finalized-segment/asset-completion transaction through the existing ingestion pipeline.

The deterministic Fake transcription provider is network-free, testable for interviewer/candidate success and controlled failure, and impossible to enable in production. Page load and GET never transcribe. Deleting an asset removes bytes and metadata but retains committed transcript segments, as disclosed in the UI and privacy documentation.

v0.4 does not implement live microphone capture, system/tab audio interception, covert capture, speaker diarization, real production transcription, scoring, resume evidence retrieval, suggested/generated answers, automatic speaking, or hidden real-time assistance.

## v0.5 (complete): SQLite transcription jobs

Implemented: asynchronous enqueue/reuse responses, persistent five-state jobs, composite action/session/asset binding, one-active-job protection, guarded claims with fixed leases, bounded expired recovery and retries, deterministic local worker lifecycle, atomic job/asset/transcript completion, transactional cancellation during durable deletion planning, public polling summaries, refresh-safe UI polling, and new-action retry after terminal failure.

The worker is an explicitly enabled non-production embedded Node loop using only the deterministic Fake provider. It provides at-least-once provider invocation and exactly-once committed transcript effect. A real provider, production/background deployment, external queue, Redis, object storage, auth, diarization, capture, answers, and scoring remain future/out of scope.

## Later candidates

Accessibility audits, database backup/import, configurable retention, provider observability without content logging, and additional deterministic practice formats.

A later natural-follow-up mode would need a separate product and ethical review. It should remain practice-only, consented, bounded to the stored competency/question context, visibly distinguish generated follow-ups, keep application-owned state and persistence, prohibit scoring/suggested answers, and include deterministic limits and Fake-provider tests before any real-provider rollout. Covert assistance and multi-agent orchestration are not planned.

Any later evidence-retrieval, matching, evaluation, or answer-assistance proposal requires a separate product and ethical review; none is implemented or implied by Question Understanding metadata.
