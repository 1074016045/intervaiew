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

## v0.3 (current): Transcript Lab

Implemented: a provider-neutral transcript chunk model, immutable interim/final buffer, scheduler-driven Fake Transcript Stream, pause/resume/stop/failure cleanup, transactional and idempotent SQLite final-segment ingestion, refresh recovery, strict same-origin APIs, and Practice / Authorized Demo UI and tests.

Interim chunks remain memory-only. Final chunks persist with provider-ID and sequence uniqueness. This phase does not call an AI provider and does not implement real audio capture, question boundaries, classification, retrieval, scoring, suggested answers, or answer generation.

## Later candidates

Accessibility audits, database backup/import, configurable retention, provider observability without content logging, and additional deterministic practice formats.

A later natural-follow-up mode would need a separate product and ethical review. It should remain practice-only, consented, bounded to the stored competency/question context, visibly distinguish generated follow-ups, keep application-owned state and persistence, prohibit scoring/suggested answers, and include deterministic limits and Fake-provider tests before any real-provider rollout. Covert assistance and multi-agent orchestration are not planned.

The next research candidate is a Question Boundary Detector behind a provider-neutral port. It may consume finalized, ordered Transcript Lab segments, but it is not implemented or claimed complete in v0.3.
