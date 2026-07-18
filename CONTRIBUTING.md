# Contributing

Use Node 24 and pnpm. Read `ARCHITECTURE.md`, `PRIVACY.md`, `SECURITY.md`, and `ETHICAL_USE.md` before changing behavior.

```bash
pnpm install
cp .env.example .env.local
pnpm db:migrate
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

Keep automated tests in Mock mode. Add a formal migration for schema changes. Route all state transitions through the controller, keep provider code behind `TextModelProvider`, validate external input with Zod, and never commit secrets or local databases. Do not add voice, scoring, evaluation, multi-agent, or real-interview assistance inside an unrelated change.
