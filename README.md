# IntervAIew — 面面具到

**Practice clearly. Answer confidently.**

IntervAIew is a local-first, practice-only web application for creating personalized question plans and completing deterministic text mock interviews. It is not designed for hidden assistance in real interviews, monitoring evasion, recruitment tests, or unconsented recording.

## MVP features

- Create practice sessions from a role, optional company, interview type, difficulty, language, resume text, and job description.
- Generate 3–10 questions with offline Mock, DeepSeek, or OpenAI text providers.
- Complete a text interview with saved answers, repeat, clarification, early cancellation, automatic completion, and an immutable transcript.
- Browse history, view details, export safe TXT/JSON, and cascade-delete local data.
- Idempotent action API and explicit domain state machine.

This version does **not** include voice, WebRTC, recording, scoring, coaching, suggested answers, reports, accounts, cloud storage, file parsing, RAG, analytics, or multi-agent orchestration.

## Stack

Next.js 16 App Router, React 19, strict TypeScript, Tailwind CSS 4, Zod 4, Drizzle ORM, better-sqlite3, OpenAI JavaScript SDK, Vitest, Testing Library, Playwright, ESLint, Prettier, and pnpm.

## Run in Mock Mode

Requirements: Node.js 24 LTS and pnpm.

```bash
pnpm install
cp .env.example .env.local
pnpm db:migrate
pnpm dev
```

Keep `AI_PROVIDER=mock`. Open http://localhost:3000. Mock output is deterministic, requires no key, and makes no external AI request.

## DeepSeek Mode

Edit local, uncommitted `.env.local`:

```env
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=在本机填写
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_TEXT_MODEL=deepseek-v4-flash
DEEPSEEK_THINKING_MODE=disabled
```

`deepseek-v4-pro` may be configured explicitly. Question planning sends the resume, JD, and interview settings to DeepSeek. Provider errors do not silently fall back.

## OpenAI Mode

```env
AI_PROVIDER=openai
OPENAI_API_KEY=在本机填写
OPENAI_TEXT_MODEL=用户配置的当前模型
```

No OpenAI model is hard-coded. The server adapter uses the installed SDK's Responses API. Question planning sends the same planning data to OpenAI.

Codex CLI 的套餐用量与 IntervAIew API 调用费用相互独立。

## Data and deletion

The default database is `./data/intervaiew.db`. When the app runs locally, session data is stored in this local SQLite database. Delete an individual session from History or its detail page. To delete every session, stop the app and delete the local database files (`intervaiew.db`, `-wal`, and `-shm`) intentionally.

Answers and transcripts are never sent to an AI provider in this MVP. See [PRIVACY.md](PRIVACY.md).

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

Automated tests and CI set `AI_PROVIDER=mock`; the DeepSeek adapter is exercised against a local fake HTTP server.

## Structure

```text
src/app                 Next.js pages and Node route handlers
src/features/ai         provider-neutral port and adapters
src/features/interviews domain state machine and use cases
src/features/question-planner prompt, validation, and planner
src/features/text-interview deterministic action service and UI
src/features/transcript transcript and export logic
src/infrastructure      SQLite, Drizzle, repositories, env, logging
tests/unit              pure domain/planner/provider tests
tests/integration       isolated SQLite and fake provider tests
tests/e2e               Mock-mode browser flow
```

## Provider architecture

```text
Question Planner
       ↓
TextModelProvider
   ┌───────┼────────┐
 Mock   DeepSeek   OpenAI
```

`TextModelProvider` is separate from the future `RealtimeInterviewClient`. The UI, domain, database, and Planner do not branch on provider-specific behavior.

## Practice-only use

Use IntervAIew only for authorized preparation. Do not use it to deceive an interviewer, evade recruiting rules, capture another application's audio, or automate a live assessment. See [ETHICAL_USE.md](ETHICAL_USE.md).
