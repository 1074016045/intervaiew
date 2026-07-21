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

Report vulnerabilities privately to the repository owner. Do not include real credentials or sensitive candidate documents in a report.
