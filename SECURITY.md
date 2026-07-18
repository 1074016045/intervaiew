# Security

- Secrets are parsed only in a `server-only` environment module. `.env.local` and `data/` are ignored by Git; no key uses `NEXT_PUBLIC_*`.
- Provider selection is a server environment decision. Missing or unknown configuration fails clearly; there is no silent fallback.
- Resume and JD are untrusted delimited data. System instructions prohibit document instruction-following, secret/prompt disclosure, and role changes.
- Provider requests have AbortController cancellation, bounded retries/backoff, sanitized error mapping, and no request-body logging.
- Route errors return stable codes/messages without stack, SQL, paths, provider payloads, or user text.
- `reasoning_content` is ignored and never persisted, logged, exported, or shown.
- SQLite enables foreign keys, WAL, and busy timeout. It is a local application boundary, not encrypted storage; protect the host account and filesystem and do not expose the development server to untrusted networks.
- Business state changes go through the domain controller. Multi-row actions are transactional and idempotent.

Report vulnerabilities privately to the repository owner. Do not include real credentials or sensitive candidate documents in a report.
