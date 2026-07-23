# IntervAIew — 面面具到

**Practice clearly. Answer confidently.**

IntervAIew is a local-first, practice-only application for creating personalized fixed question plans and completing deterministic text or guided realtime voice mock interviews. It is not designed for hidden assistance in real interviews, monitoring evasion, recruitment tests, or unconsented recording.

## v0.4 features

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

This version does **not** include generated follow-ups, free-running interview agents, scoring, coaching, suggested answers, accounts, cloud storage, system-audio/screen capture, phone/SIP, analytics, or multi-agent orchestration.

Transcript Lab includes Question Boundary Detector, Question Understanding v0.3, and Uploaded Audio v0.4, but still does **not** include diarization, resume evidence retrieval, candidate-experience matching, scoring, answer generation, real microphone/system/tab capture, or a real OpenAI/DeepSeek streaming connection.

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
UPLOADED_AUDIO_FAKE_TRANSCRIPTION_ENABLED=true
UPLOADED_AUDIO_MAX_BYTES=26214400
UPLOADED_AUDIO_PATH=./data/uploaded-audio
QUESTION_BOUNDARY_SHORT_PAUSE_MS=500
QUESTION_BOUNDARY_MEDIUM_PAUSE_MS=1400
QUESTION_BOUNDARY_LONG_PAUSE_MS=3000
```

Run migrations, start the app, and open `http://localhost:3000/lab/transcript`. Creating a lab session does not start a stream. Page load never starts the Fake or writes transcript data. Interim chunks live only in the current page memory; only final chunks are accepted by the ingestion API and stored in SQLite. Refresh therefore restores final segments and clears interim text.

Transcript Lab makes no OpenAI or DeepSeek request, requires no API key, and produces no AI API charge. Its automated coverage is included in `pnpm test` and `pnpm test:e2e`.

## Uploaded Audio v0.4

Uploaded Audio is limited to practice, authorized demonstrations, and research recordings the user is authorized to process. Select a WAV, MP3, M4A/MP4, OGG, WebM, or FLAC file, declare `interviewer` or `candidate` for the whole file, then choose **Upload audio**. Upload stores the validated bytes and safe metadata but does not transcribe. A separate visible **Transcribe** action is required.

Uploaded Audio and its Fake transcription adapter both default to disabled. Enable them explicitly only for authorized development/test use. The multipart endpoint requires a valid `Content-Length` no larger than the file limit plus 64 KiB of multipart overhead; v0.4 intentionally rejects unknown-length/chunked uploads before parsing to avoid unbounded request buffering.

v0.4 performs no speaker diarization: the declared role applies to every produced segment. Successful transcription produces finalized segments only through the existing Transcript Lab ingestion boundary. Interviewer segments therefore enter the existing Question Boundary and Question Understanding pipeline; candidate segments do not become automatic question candidates. GET/page load never transcribes.

The bundled transcription provider is deterministic, network-free Fake behavior for automated tests and explicitly enabled non-production development. It cannot be enabled in production. No real uploaded-audio provider was added: although the installed OpenAI SDK is typed, production audio/provider policy and retention behavior require a separate rollout rather than an implicit model choice. Production transcription therefore remains disabled in v0.4.

Deleting an uploaded asset uses a durable staged-delete plan so database and filesystem failures can be retried safely. Successful deletion removes metadata and stored bytes. Final transcript segments already committed remain in the analysis session; their nullable source link is cleared by the database foreign key. Delete the analysis session to remove those transcript segments. Upload, transcription, and deletion use session-scoped action receipts for idempotency.

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

See [PRIVACY.md](PRIVACY.md), [SECURITY.md](SECURITY.md), and [ETHICAL_USE.md](ETHICAL_USE.md).

## Commands

```bash
pnpm db:generate
pnpm db:migrate
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
- `POST /api/analysis-sessions/[id]/uploaded-audio/[assetId]/transcribe` requires a strict `{actionId}` body and is the only route that requests transcription.
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
Explicit Transcribe → AudioTranscriptionProvider (non-production Fake) → TranscriptIngestionService
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
