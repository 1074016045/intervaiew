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

## Later candidates

Accessibility audits, database backup/import, configurable retention, provider observability without content logging, and additional deterministic practice formats.

A later natural-follow-up mode would need a separate product and ethical review. It should remain practice-only, consented, bounded to the stored competency/question context, visibly distinguish generated follow-ups, keep application-owned state and persistence, prohibit scoring/suggested answers, and include deterministic limits and Fake-provider tests before any real-provider rollout. Covert assistance and multi-agent orchestration are not planned.

Any later evidence-retrieval, matching, evaluation, or answer-assistance proposal requires a separate product and ethical review; none is implemented or implied by Question Understanding metadata.
