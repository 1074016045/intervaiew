# Repository agent rules

1. Read `ARCHITECTURE.md`, `PRIVACY.md`, `SECURITY.md`, and `ETHICAL_USE.md` first.
2. Do not bypass the interview state machine or let client components access SQLite.
3. Keep API keys server-only; never log or return secrets, resume/JD, answers, transcripts, prompts, or provider payloads.
4. Do not add scoring, evaluation, suggested answers, multi-agent orchestration, or unauthorized real-interview assistance.
5. Keep `TextModelProvider` and `RealtimeInterviewClient` separate.
6. Use formal migrations and transactional/idempotent multi-row writes.
7. Run relevant tests before claiming completion. Automated tests must not call real providers.
8. Preserve user code, avoid destructive Git commands, and never push or commit unless explicitly requested.
