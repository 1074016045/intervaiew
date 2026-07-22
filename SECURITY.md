# Security

- Secrets are parsed only in a `server-only` environment module. `.env.local` and `data/` are ignored by Git; no key uses `NEXT_PUBLIC_*`.
- Provider selection is a server environment decision. Missing or unknown configuration fails clearly; there is no silent fallback.
- Resume and JD are untrusted delimited data. System instructions prohibit document instruction-following, secret/prompt disclosure, and role changes.
- Provider requests have AbortController cancellation, bounded retries/backoff, sanitized error mapping, and no request-body logging.
- Route errors return stable codes/messages without stack, SQL, paths, provider payloads, or user text.
- `reasoning_content` is ignored and never persisted, logged, exported, or shown.
- SQLite enables foreign keys, WAL, and busy timeout. It is a local application boundary, not encrypted storage; protect the host account and filesystem and do not expose the development server to untrusted networks.
- Business state changes go through the domain controller. Multi-row actions are transactional and idempotent.
- The permanent `OPENAI_API_KEY` remains in the server-only environment parser and token client. Browser code receives only a short-lived `ek_` secret from a same-origin, strict-schema, rate-limited endpoint with `no-store` and `no-cache`.
- Realtime model, voice, transcription model, safety instructions, VAD, and duration are server controlled. Browser requests cannot supply model, voice, base URL, key, or arbitrary instructions. `useInsecureApiKey` is never enabled.
- Agents SDK tracing, tools, handoffs, MCP, and history audio storage are disabled. Candidate speech is untrusted answer data and cannot alter the application state machine or canonical question sequence.
- Recording upload validates ownership, role, MIME, byte limit, and relative paths; it uses random server filenames, atomic writes, restrictive permissions, and a storage-root containment check. Downloads select assets by database ID and use `nosniff`; playback supports validated byte ranges.
- Logs must not contain ephemeral tokens, raw audio, transcripts, SDP, ICE credentials, provider raw events, or absolute recording paths. Authentication and quota failures are not automatically retried.
- Transcript Lab mutation routes require same-origin requests, strict schemas, and `no-store` responses. Unknown chunk fields are rejected. Only final chunks reach the transactional SQLite adapter; provider IDs are idempotent and sequence reuse by a different provider ID is a stable conflict.
- `TRANSCRIPT_LAB_FAKE_ENABLED` defaults off and is honored only outside production. URL parameters cannot enable it. The Fake adapter has no provider key, microphone, media, or external-network capability, and every timer/subscription is disposable.
- Transcript text is untrusted data, never code or instructions. Only server-built candidates can be evaluated; clients cannot submit `shouldFinalize`, confidence, deterministic signals, semantic output, or provider selection.
- Question-boundary mutation bodies are strict and same-origin. Required action IDs have a session-scoped unique receipt, and the repository returns the original result for a same-action retry without duplicating questions or mappings.
- Semantic work is bound to candidate revision. New final segments increment revision; AbortController cancellation and a transactional current-revision check prevent stale results from overwriting current state.
- `QUESTION_BOUNDARY_FAKE_SEMANTIC_ENABLED` defaults off, is ignored in production, has no URL backdoor, requires no API key, and performs no network access. Raw semantic payloads, hidden prompts, reasoning, SQL, stack traces, and transcript content are excluded from logs/errors.

Report vulnerabilities privately to the repository owner. Do not include real credentials or sensitive candidate documents in a report.
