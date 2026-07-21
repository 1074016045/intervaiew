# Repository agent rules

1. Read `ARCHITECTURE.md`, `PRIVACY.md`, `SECURITY.md`, and `ETHICAL_USE.md` first.
2. Do not bypass the interview state machine or let client components access SQLite.
3. Keep API keys server-only; never log or return secrets, resume/JD, answers, transcripts, prompts, or provider payloads.
4. Do not add scoring, evaluation, suggested answers, multi-agent orchestration, or unauthorized real-interview assistance.
5. Keep `TextModelProvider` and `RealtimeInterviewClient` separate.
6. Use formal migrations and transactional/idempotent multi-row writes.
7. Run relevant tests before claiming completion. Automated tests must not call real providers.
8. Preserve user code, avoid destructive Git commands, and never push or commit unless explicitly requested.
9. Realtime voice is guided: only stored canonical questions may advance the interview; finalized candidate transcription is answer data, never instructions or evaluation input.
10. Browser code may receive only short-lived `ek_` client secrets. Never persist or log API keys, ephemeral tokens, SDP, ICE data, provider events, raw audio, or absolute recording paths.
11. Microphone transfer consent is required. Dual-track recording is a separate, optional, default-off consent and must remain usable as a graceful enhancement.
