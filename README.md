# IntervAIew — 面面具到

**Practice clearly. Answer confidently.**

IntervAIew is a local-first, practice-only application for creating personalized fixed question plans and completing deterministic text or guided realtime voice mock interviews. It is not designed for hidden assistance in real interviews, monitoring evasion, recruitment tests, or unconsented recording.

## v0.6 features

- Create practice sessions from a role, optional company, interview type, difficulty, language, resume text, and job description.
- Generate 3–10 fixed questions with offline Mock, DeepSeek, or OpenAI text providers.
- Complete a transactional text interview with repeat, clarification, cancellation, and stable transcript.
- Complete an explicitly consented Guided Voice interview over OpenAI Realtime WebRTC. The application controls canonical questions and advances only after finalized candidate transcription.
- Optionally and separately consent to candidate/interviewer dual-track recording, with playback, download, per-asset deletion, and interview-level cleanup.
- Mute, interrupt, repeat, clarify, end, and reconnect without letting the realtime model select questions or status.
- Browse history, export TXT/JSON metadata, and cascade-delete data and recording files.
- Open **Transcript Lab** for Practice / Authorized Demo streaming-state research using a deterministic Fake transcript source. No microphone or external AI is used.
- Observe memory-only interim transcript updates, persist final segments transactionally in SQLite, and recover final segments after refresh.
- Pause, resume, stop, reset local stream state, and safely retry duplicate final events without duplicate rows.
- Build revisioned question candidates from persisted final interviewer segments and detect when a complete question boundary has formed.
- Inspect deterministic signals and hybrid decisions, then manually Force Finalize, Merge with Previous, or Undo Finalize with idempotent actions.
- Explicitly analyze active finalized questions into revision-bound language, family, answer-mode, requested-dimension, constraint, focus-term, clarification, confidence, and provenance metadata.
- Explicitly upload authorized prerecorded audio to an existing Transcript Lab session, declare one whole-file speaker role, and separately request deterministic Fake transcription into finalized Transcript Lab segments.
- Restore uploaded-asset metadata and completed transcript state after refresh, safely retry failed transcription, and delete file bytes/metadata without silently deleting committed transcript segments.
- Create and validate local SQLite backup pairs, perform explicitly confirmed offline restore, and apply an explicit backup-pair retention policy with dry-run as the default.
- Inspect a bounded, read-only local operations snapshot and receive content-free maintenance events on stderr without telemetry, analytics, log shipping, or persistent log files.

This version does **not** include generated follow-ups, free-running interview agents, scoring, coaching, suggested answers, accounts, cloud storage, system-audio/screen capture, phone/SIP, analytics, or multi-agent orchestration.

Transcript Lab includes Question Boundary Detector, Question Understanding v0.3, and asynchronous Uploaded Audio v0.5, but still does **not** include diarization, resume evidence retrieval, candidate-experience matching, scoring, answer generation, real microphone/system/tab capture, or a real uploaded-audio transcription provider.

## Stack

Next.js 16 App Router, React 19, strict TypeScript, Tailwind CSS 4, Zod 4, Drizzle ORM, better-sqlite3, OpenAI Agents SDK Realtime/WebRTC, OpenAI JavaScript SDK, Vitest, Testing Library, Playwright, ESLint, Prettier, and pnpm.

## Run in Mock Mode

Requirements: Node.js 24 LTS and pnpm.

```bash
pnpm install
cp .env.example .env.local
pnpm db:migrate
pnpm dev
```

Keep `AI_PROVIDER=mock`. Mock planning is deterministic, requires no key, and makes no external AI request. Text mode and automated Fake Realtime tests work without `OPENAI_API_KEY`.

For Transcript Lab in local development, explicitly enable its non-production Fake adapter:

```env
TRANSCRIPT_LAB_FAKE_ENABLED=true
QUESTION_BOUNDARY_FAKE_SEMANTIC_ENABLED=true
QUESTION_UNDERSTANDING_FAKE_SEMANTIC_ENABLED=true
UPLOADED_AUDIO_ENABLED=true
UPLOADED_AUDIO_TRANSCRIPTION_WORKER_ENABLED=true
UPLOADED_AUDIO_FAKE_TRANSCRIPTION_ENABLED=true
UPLOADED_AUDIO_MAX_BYTES=26214400
UPLOADED_AUDIO_PATH=./data/uploaded-audio
QUESTION_BOUNDARY_SHORT_PAUSE_MS=500
QUESTION_BOUNDARY_MEDIUM_PAUSE_MS=1400
QUESTION_BOUNDARY_LONG_PAUSE_MS=3000
```

Run migrations, start the app, and open `http://localhost:3000/lab/transcript`. Creating a lab session does not start a stream. Page load never starts the Fake or writes transcript data. Interim chunks live only in the current page memory; only final chunks are accepted by the ingestion API and stored in SQLite. Refresh therefore restores final segments and clears interim text.

Transcript Lab makes no OpenAI or DeepSeek request, requires no API key, and produces no AI API charge. Its automated coverage is included in `pnpm test` and `pnpm test:e2e`.

## Uploaded Audio v0.5

Uploaded Audio is limited to practice, authorized demonstrations, and research recordings the user is authorized to process. Select a WAV, MP3, M4A/MP4, OGG, WebM, or FLAC file, declare `interviewer` or `candidate` for the whole file, then choose **Upload audio**. Upload stores the validated bytes and safe metadata but does not transcribe. A separate visible **Transcribe** action is required.

Uploaded Audio, its embedded worker, and its Fake transcription adapter all default to disabled. Authorized non-production development requires all three explicit flags. The multipart endpoint requires a valid `Content-Length` no larger than the file limit plus 64 KiB of multipart overhead and rejects unknown-length/chunked uploads before parsing.

The Transcribe POST atomically creates or reuses a SQLite job and returns immediately. A bounded local Node worker claims one job at a time with a fixed 120-second lease and a 90-second provider-attempt timeout. It retries temporary failures after 1 second and 5 seconds, with three attempts maximum and a 30-second policy cap. Provider/filesystem work stays outside database transactions. Provider invocation is at least once after lease recovery; the guarded completion transaction gives exactly-once committed transcript effect and rejects stale, expired, cancelled, or deleted work.

The bundled provider remains deterministic and network-free. No real provider exists in v0.5. The embedded worker requires a long-lived local Node process and never starts in production; serverless/short-lived deployment needs a future external worker design. Cancellation invalidates the lease and safely discards stale output, although provider code already running in memory may continue until it observes abort or returns.

Deleting an uploaded asset uses a durable staged-delete plan so database and filesystem failures can be retried safely. Successful deletion removes metadata and stored bytes. Final transcript segments already committed remain in the analysis session; their nullable source link is cleared by the database foreign key. Delete the analysis session to remove those transcript segments. Upload, transcription, and deletion use session-scoped action receipts for idempotency.

The first v0.6 increment adds Uploaded Audio accessibility improvements and automated accessibility regression coverage: initial loading is announced, per-asset status changes remain polite, and cancelling/deleting is exposed as an explicit busy state without moving keyboard focus during polling refreshes.

## Question Boundary Detector

Question Boundary Detector decides only whether the persisted, ordered final interviewer transcript has formed a complete question. Candidate and unknown speaker segments are excluded. Interim text can remain visible in the Lab, but never becomes a finalized-question source.

- **Deterministic** detection applies auditable Chinese/English question patterns, connector endings, punctuation, content validity, and pause duration without an AI request.
- **Semantic** detection is a provider-neutral port used only for medium-pause gray zones. The bundled Fake Semantic provider is deterministic, can simulate delay/failure/stale responses in tests, and never accesses the network.
- **Hybrid** detection runs deterministic rules first, skips semantic work for short pauses and high-confidence results, consults semantic only in the gray zone, and force-finalizes valid content after a long pause.

Default pause behavior is: below 500 ms wait; 500–1399 ms deterministic only; 1400–2999 ms use semantic only for gray zones; 3000 ms or longer force-finalize valid content. Empty text, noise, punctuation-only text, and pure connectors are never long-pause questions. Thresholds are positive server-only integers and must satisfy short < medium < long.

Every semantic request is revision-bound. A new final segment increments the candidate revision, aborts or supersedes stale work, and prevents the old result from being committed. A semantic result is cached for the same candidate revision. Manual Force Finalize, Merge with Previous, and Undo Finalize use required action IDs, transactional writes, source-segment mappings, and idempotent receipts.

Run the public synthetic fixture evaluation with:

```bash
pnpm evaluate:boundary
pnpm evaluate:understanding
```

The boundary evaluator reports fixture count, accuracy, precision, recall, F1, false positives, and false negatives using deterministic rules plus Fake Semantic only. Known limitations: the rule vocabulary is intentionally bounded, speaker roles must already be assigned, pause timing is based on final-segment arrival, semantic normalization does not replace stored transcript text, and the boundary stage itself does not classify, score, retrieve evidence for, or answer a question.

## Question Understanding

Question Understanding consumes only active finalized questions persisted by Question Boundary Detector. It never reads interim transcript, unfinished candidates, candidate/unknown segments, or undone questions. Finalized wording remains immutable. Analysis is explicit—GET and page load do not trigger it—and returns structured metadata rather than an answer.

The closed question-family taxonomy is `behavioral`, `project_experience`, `technical_concept`, `coding`, `quantitative`, `system_design`, `situational`, `motivation`, `role_fit`, `collaboration`, `leadership`, `clarification`, and `other`. Expected answer modes are `narrative`, `explanation`, `design`, `calculation`, `code`, `comparison`, `concise_fact`, and `mixed`. Requested dimensions, constraint kinds, clarification reasons, languages, decision sources, and statuses are also closed Zod enums.

Requested dimensions are limited to `context`, `goal`, `challenge`, `responsibility`, `actions`, `reasoning`, `implementation`, `technical_details`, `assumptions`, `constraints`, `tradeoffs`, `alternatives`, `collaboration`, `leadership`, `conflict`, `failure`, `recovery`, `outcome`, `impact`, `metrics`, `lessons`, `complexity`, `edge_cases`, `testing`, `scalability`, `reliability`, `security`, and `clarification`. Constraint kinds are `time_limit`, `count`, `technology`, `role`, `scope`, `comparison`, `format`, and `other`; every stored constraint/focus item retains an exact bounded source substring and positive sequence.

Auditable Chinese/English deterministic rules run first. High-confidence results bypass semantic work. Ambiguous and multi-question prompts may use the deterministic local Fake Semantic provider only when `NODE_ENV` is not `production` and the server-only flag is explicitly true. Production ignores the flag. Fake failure returns a bounded deterministic hybrid fallback; no raw payload, prompt, reasoning, or arbitrary summary is stored.

Results bind finalized-question ID, finalized revision, and source boundary-decision ID. Same-revision retries use persistence, action IDs are session-idempotent, and commit transactionally re-reads the authoritative finalized question. Merge/revision and undo supersede old results; stale in-flight work cannot become active.

Run `pnpm evaluate:understanding` for the public bilingual regression set. Its metrics measure only the fixed synthetic fixtures and are not evidence of real-world generalization. Known limitations include bounded keyword coverage, dependence on upstream speaker/boundary correctness, shallow focus-term normalization, and no real semantic provider.

## Text planning providers

DeepSeek planning uses its server-only key and the configured chat-completions model:

```env
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=在服务器环境填写
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_TEXT_MODEL=deepseek-v4-flash
DEEPSEEK_THINKING_MODE=disabled
```

OpenAI text planning uses the server-only `OPENAI_API_KEY` and explicitly configured `OPENAI_TEXT_MODEL`. Resume/JD and planning settings are sent only to the selected planning provider. There is no provider fallback.

## Guided Realtime Voice Mode

Configure the server only; never expose any OpenAI key through a `NEXT_PUBLIC_*` variable:

```env
OPENAI_REALTIME_ENABLED=true
OPENAI_API_KEY=在服务器环境填写
OPENAI_REALTIME_MODEL=gpt-realtime-2.1
OPENAI_REALTIME_VOICE=marin
OPENAI_REALTIME_TRANSCRIPTION_MODEL=gpt-4o-transcribe
```

Generate a question plan first, then choose **Start Voice Interview**. Connection never starts on page load. The user must consent to microphone transfer; dual-track recording remains off unless the separate optional checkbox is selected.

Voice mode uses OpenAI API billing. A ChatGPT subscription, Codex subscription, and OpenAI API billing are separate. Mock/Text modes do not automatically produce Realtime charges.

The permanent key stays server-only. `POST /api/realtime/client-secret` returns only a short-lived `ek_` secret and safe metadata under `no-store`/`no-cache`. The browser uses WebRTC and server-selected model, voice, transcription, VAD, and safety settings. `server_vad` has `create_response=false`: finalized candidate transcription is stored transactionally, the existing state machine advances, and only then does the application explicitly request speech for the next canonical question.

Resume and JD are not resent to Realtime. DeepSeek never receives voice audio. Do not enable voice for unauthorized real interviews or recording without all legally required consent.

## Data and deletion

The default database is `./data/intervaiew.db`; optional guided-voice recordings are beneath `./data/recordings`, and uploaded practice audio is beneath `./data/uploaded-audio`. In local development these are on the local machine. On remote deployment they are on that server—“local” does not mean the user's device.

Candidate and interviewer audio tracks are stored separately and are never embedded in TXT/JSON export. Delete a recording from Detail, or delete an interview to remove associated files and metadata. Input transcription may not be word-for-word exact and is not used for scoring.

## Database backup, retention, status, and offline restore

Database backups contain the same sensitive local data as the source SQLite database, including resume, job-description, question, answer, and transcript data. Protect, retain, and delete each artifact pair deliberately. Backup encryption, compression, and cloud backup are not implemented. Recordings and Uploaded Audio file bytes are not included; this is a database backup, not a complete application backup.

Create a consistent online SQLite backup in the default `./data/backups` directory:

```bash
pnpm --silent db:backup
```

The command accepts `--database <path>`, `--output-dir <directory>`, and `--name <safe-name>`. Keep `--silent` on administrative invocations so pnpm does not echo absolute path arguments in its script banner. The two-file artifact is `<backup-name>.sqlite` plus `<backup-name>.manifest.json`; keep the pair together. Validate a pair before relying on it or moving it:

```bash
pnpm --silent db:backup:validate -- --manifest ./data/backups/<backup-name>.manifest.json
```

Add `--json` for a bounded machine-readable validation result. Restore is a standalone offline administrative command; there is no browser or web restore UI. A dry run validates without writing and does not require an offline assertion:

```bash
pnpm --silent db:restore -- --manifest ./data/backups/<backup-name>.manifest.json --database ./data/restored.db --dry-run
```

Before a write restore, stop `pnpm dev`, `pnpm start`, and the embedded Uploaded Audio worker. `--confirm-offline` is the operator's assertion that they are stopped; it is not automatic process detection or a process lock. Create a new destination with:

```bash
pnpm --silent db:restore -- --manifest ./data/backups/<backup-name>.manifest.json --database ./data/restored.db --confirm-offline
```

An existing destination is never overwritten unless both `--replace` and `--confirm-offline` are supplied:

```bash
pnpm --silent db:restore -- --manifest ./data/backups/<backup-name>.manifest.json --database ./data/intervaiew.db --replace --confirm-offline --pre-restore-backup-dir ./data/pre-restore-backups
```

Replacement first creates and validates a pre-restore safety backup, which is never deleted automatically. Restore never runs migrations. Run `pnpm db:migrate` separately only after intentionally selecting an application version and deciding to upgrade the restored data. After validating retained backups and confirming they are no longer needed, delete both the `.sqlite` and matching `.manifest.json` files together; also remove any intentionally retained pre-restore pair. Retention and deletion are manual; do not delete only one half and mistake the remainder for a usable backup.

Handled restore failures roll back exact original database and sidecar bytes. The multi-file database/WAL/SHM sequence is not atomic across sudden process termination, host failure, or power loss. An interrupted attempt leaves a fail-closed lock or recovery files for manual inspection; use the retained pre-restore pair for recovery. The command is not crash-proof and is not disaster-recovery certification.

Backup retention applies only to strict direct-child `<safe-name>.sqlite` and `<safe-name>.manifest.json` database-backup pairs. It never deletes interview or analysis sessions, transcripts, questions, recording files, Uploaded Audio bytes or jobs, application content, unknown files, temporary files, locks, WAL/SHM files, or recovery residue. It never runs automatically: there is no scheduler, startup deletion, web request, API, or browser retention UI.

Configuration defaults are `BACKUP_RETENTION_DIRECTORY=./data/backups`, `BACKUP_RETENTION_MAX_AGE_DAYS=30`, and `BACKUP_RETENTION_KEEP_LATEST=3`. Maximum age is a strict integer from 1 through 36500; keep-latest is a strict integer from 1 through 10000. CLI values override environment values. Merely configuring them performs no action. Dry-run is the default:

```bash
pnpm --silent db:backup:retention -- --dry-run

pnpm --silent db:backup:retention -- \
  --directory ./data/backups \
  --max-age-days 30 \
  --keep-latest 3 \
  --dry-run

pnpm --silent db:backup:retention -- \
  --max-age-days 30 \
  --keep-latest 3 \
  --dry-run \
  --json
```

Apply requires both explicit flags and never prompts or infers consent from a terminal:

```bash
pnpm --silent db:backup:retention -- \
  --directory ./data/backups \
  --max-age-days 30 \
  --keep-latest 3 \
  --apply \
  --confirm-delete
```

Manifest `createdAt`, not filesystem mtime, is authoritative. A valid pair is eligible only when it is strictly older than the configured age and outside the newest `keepLatest` valid pairs; at least that many valid pairs always remain. Invalid, incomplete, unsupported, unsafe, unknown, or nested artifacts are counted but never deleted. The default directory does not include replacement restore's default `pre-restore-backups` safety directory. Point retention at another directory only through an explicit invocation after reviewing its contents.

Apply holds one exclusive directory operation lock, pins both selected artifacts with non-following handles, rechecks path identity before each mutation, and stages same-directory recovery links before removing normal names. A handled mid-pair failure restores the original pair when safe. If safe rollback or cleanup cannot finish, clearly non-normal recovery residue remains and later runs refuse automatic continuation. Sudden process termination, host failure, or power loss is not crash-atomic and can require manual inspection.

Read local operational status without migrations, writes, cleanup retries, work enqueueing, or network access:

```bash
pnpm --silent ops:status
pnpm --silent ops:status -- --json
pnpm --silent ops:status -- \
  --database ./data/intervaiew.db \
  --backup-directory ./data/backups \
  --json
```

Status reports only database reachability/integrity and migration facts, backup counts, transcription-job state counts, pending deletion-batch counts, and the configured retention policy. To avoid creating or changing SQLite sidecars, status inspects a pinned in-memory byte snapshot and degrades if WAL/SHM sidecars are present; run it against a quiescent/checkpointed database for a healthy result. Healthy status exits 0; degraded or unavailable required resources exit nonzero, while JSON mode still writes exactly one bounded JSON value to stdout.

Retention command results, operations-status results, and closed-schema newline-delimited maintenance events on stderr contain only bounded operational fields. Those three surfaces exclude paths, filenames, backup names, hashes, credentials, IDs, SQL, timestamps from individual backups, user content, provider payloads, causes, and stacks. Existing backup, validation, and restore human stdout intentionally retains its operator-facing contract: safe artifact basenames plus byte counts and SHA-256 values where applicable. Maintenance events never repeat that artifact metadata. Events stay local and ephemeral: there is no telemetry, analytics, metrics export, persistent log file, log shipping, cloud request, or other external request.

See [PRIVACY.md](PRIVACY.md), [SECURITY.md](SECURITY.md), and [ETHICAL_USE.md](ETHICAL_USE.md).

## Commands

```bash
pnpm db:generate
pnpm db:migrate
pnpm --silent db:backup
pnpm --silent db:backup:validate -- --manifest <path>
pnpm --silent db:backup:retention -- --dry-run
pnpm --silent db:restore -- --manifest <path> --dry-run
pnpm --silent ops:status -- --json
pnpm lint
pnpm typecheck
pnpm test
pnpm evaluate:boundary
pnpm evaluate:understanding
pnpm test:e2e
pnpm build
```

Automated tests use Mock planning, Fake Realtime, Fake Recorder, isolated OS temporary storage, and fake HTTP responses. They never call a real AI provider or request a microphone.

The Transcript Lab API uses these routes:

- `POST /api/analysis-sessions` creates an explicit `transcript_lab` session.
- `GET`, `PATCH`, and `DELETE /api/analysis-sessions/[id]` read, transition, or idempotently delete it.
- `POST /api/analysis-sessions/[id]/transcript-segments` accepts final chunks only. A repeated provider segment ID returns the existing row with `duplicated=true`; a different provider ID reusing a sequence returns `TRANSCRIPT_SEGMENT_SEQUENCE_CONFLICT`.
- `GET` and multipart `POST /api/analysis-sessions/[id]/uploaded-audio` list or explicitly upload an asset. Upload requires an action ID, one declared role, and one validated file.
- `POST /api/analysis-sessions/[id]/uploaded-audio/[assetId]/transcribe` requires a strict `{actionId}` body, atomically enqueues/reuses a job, and returns `202` without waiting for provider work (`200` only when the same action's job is already terminal).
- `DELETE /api/analysis-sessions/[id]/uploaded-audio/[assetId]` requires a strict `{actionId}` body and removes bytes/metadata while preserving committed transcript segments.
- `GET /api/analysis-sessions/[id]/question-boundary` returns the current candidate, deterministic signals, decision audit, and finalized questions.
- `POST` routes below `question-boundary/evaluate`, `force-finalize`, `merge-previous`, and `undo` require strict bodies and an `actionId`.
- `GET /api/analysis-sessions/[id]/question-understanding` returns active finalized questions with their current result, if any.
- `POST /api/analysis-sessions/[id]/question-understanding/analyze` accepts only `finalizedQuestionId` and `actionId`; the server derives all source and classification data.

Mutation routes require a verified same origin, use strict request schemas, and return `no-store` responses.

## Architecture

```text
Question Planner → TextModelProvider → Mock | DeepSeek | OpenAI
Stored canonical questions → VoiceInterviewService → InterviewController
Browser UI → RealtimeInterviewClient → OpenAI WebRTC | explicit non-production Fake
Browser media → separate candidate/interviewer recorders → safe local storage API
FakeTranscriptStreamClient → TranscriptBuffer → TranscriptIngestionService → Analysis Repository → SQLite
Explicit audio upload → UploadedAudioService → safe filesystem + SQLite metadata
POST /transcribe → enqueue SQLite transcription job → return 202 → local worker claims job → storage read → Fake provider → lease-guarded atomic transcript completion
Final Transcript Segments → QuestionCandidateBuilder → Deterministic/Hybrid Detector → QuestionSegmentationService → SQLite
Active Finalized Questions → Deterministic/Hybrid Understander → QuestionUnderstandingService → SQLite
```

`TextModelProvider` remains separate from `RealtimeInterviewClient`. Domain/application code does not import the Agents SDK, WebRTC, MediaRecorder, or filesystem APIs. See [ARCHITECTURE.md](ARCHITECTURE.md).

## Manual macOS verification

Real OpenAI/WebRTC/microphone behavior is intentionally a manual test:

1. Use a dedicated API project with a spending limit; configure the server variables above.
2. Run migrations and `pnpm dev`, create a three-question Mock-planned interview, then open Voice.
3. Confirm no permission prompt or token mint occurs before **Start voice session**.
4. Accept microphone transfer; leave recording off and complete one run.
5. Repeat with recording consent on. Verify separate playback, download, per-track delete, and interview delete.
6. Verify mute/unmute, interruption, repeat, clarification, denied permission, network disconnect/resume, the one-minute expiry warning, and ordered end.
7. Test macOS Chrome first; test Safari graceful degradation and its supported MediaRecorder MIME.
8. Confirm logs exclude permanent/ephemeral keys, SDP, ICE credentials, provider events, audio/transcript content, and absolute paths.

## Practice-only use

Use IntervAIew only for authorized preparation. Do not use it to deceive an interviewer, evade recruiting rules, capture another application's audio, or automate a live assessment.
