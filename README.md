# IntervAIew — 面面具到

**Practice clearly. Answer confidently.**

IntervAIew is a local-first, practice-only application for creating personalized fixed question plans and completing deterministic text or guided realtime voice mock interviews. It is not designed for hidden assistance in real interviews, monitoring evasion, recruitment tests, or unconsented recording.

## v0.3 features

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

This version does **not** include generated follow-ups, free-running interview agents, scoring, coaching, suggested answers, accounts, cloud storage, system-audio/screen capture, phone/SIP, analytics, or multi-agent orchestration.

Transcript Lab also does **not** include question-boundary detection, question classification, resume evidence retrieval, answer generation, real microphone/system/tab capture, or a real OpenAI/DeepSeek streaming connection.

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
```

Run migrations, start the app, and open `http://localhost:3000/lab/transcript`. Creating a lab session does not start a stream. Page load never starts the Fake or writes transcript data. Interim chunks live only in the current page memory; only final chunks are accepted by the ingestion API and stored in SQLite. Refresh therefore restores final segments and clears interim text.

Transcript Lab makes no OpenAI or DeepSeek request, requires no API key, and produces no AI API charge. Its automated coverage is included in `pnpm test` and `pnpm test:e2e`.

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

The default database is `./data/intervaiew.db`; optional audio files are beneath `./data/recordings`. In local development these are on the local machine. On remote deployment they are on that server—“local” does not mean the user's device.

Candidate and interviewer audio tracks are stored separately and are never embedded in TXT/JSON export. Delete a recording from Detail, or delete an interview to remove associated files and metadata. Input transcription may not be word-for-word exact and is not used for scoring.

See [PRIVACY.md](PRIVACY.md), [SECURITY.md](SECURITY.md), and [ETHICAL_USE.md](ETHICAL_USE.md).

## Commands

```bash
pnpm db:generate
pnpm db:migrate
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

Automated tests use Mock planning, Fake Realtime, Fake Recorder, isolated OS temporary storage, and fake HTTP responses. They never call a real AI provider or request a microphone.

The Transcript Lab API uses these routes:

- `POST /api/analysis-sessions` creates an explicit `transcript_lab` session.
- `GET`, `PATCH`, and `DELETE /api/analysis-sessions/[id]` read, transition, or idempotently delete it.
- `POST /api/analysis-sessions/[id]/transcript-segments` accepts final chunks only. A repeated provider segment ID returns the existing row with `duplicated=true`; a different provider ID reusing a sequence returns `TRANSCRIPT_SEGMENT_SEQUENCE_CONFLICT`.

Mutation routes require a verified same origin, use strict request schemas, and return `no-store` responses.

## Architecture

```text
Question Planner → TextModelProvider → Mock | DeepSeek | OpenAI
Stored canonical questions → VoiceInterviewService → InterviewController
Browser UI → RealtimeInterviewClient → OpenAI WebRTC | explicit non-production Fake
Browser media → separate candidate/interviewer recorders → safe local storage API
FakeTranscriptStreamClient → TranscriptBuffer → TranscriptIngestionService → Analysis Repository → SQLite
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
