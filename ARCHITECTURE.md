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

## Why no multi-agent or voice in MVP

Question planning has one bounded generation task; multi-agent orchestration would add failure modes without user value. Voice adds materially different lifecycle, consent, synchronization, and browser-media concerns. The reserved `RealtimeInterviewClient` and `InterviewRecorder` ports deliberately have no adapter or UI.

Phase two keeps text planning separate:

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
