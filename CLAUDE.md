# Cai Career Agent — session guide

Autonomous job-search manager for Cai (family use). Specs live in `docs/01–03`.
Approved architecture + cost cap: see `docs/` and the plan in
`~/.claude/plans/plan-a-parallel-model-witty-fern.md`.

## Hard rules

- **Cost cap:** total campaign spend ≤ $35 (design target $20). Never add paid
  infrastructure or move a model call to the API backend without flagging it.
  Brain runs use the `claude-code` runner backend (subscription, $0); the API
  backend exists only for the Vercel coach fallback under $20 prepaid credits.
- **Never fabricate candidate information.** Answer resolution order:
  verified stored answer → candidate facts → authorized derivation → escalate
  (`AnswerResolution` in `@cai/core`). `facts.invent_information` is PROHIBITED.
- **Every job status change** goes through `assertTransition` (`@cai/core`) and
  writes an audit event via `recordAudit`. Direct status writes fail review.
- **audit_events is append-only.** No update/delete code, ever.
- **Never bypass CAPTCHA/MFA/security controls** — create an escalation.
- Persona (Hermes) lives in `docs/SOUL.md`, loaded via `loadSoul()` on every
  coaching call. Persona never controls business logic.

## Architecture

- Production: Vercel Hobby (dashboard PWA, cron Gmail poll, coach endpoint)
  + Neon free Postgres + brain runs on Marcus's Mac via scheduled headless
  Claude Code (launchd, 3–4×/day). Docker Compose is **local dev only**.
- Batch cadence: stages per run = discovery → qualification → preparation/
  submission → inbox → pipeline → briefing (`RunStage` in `@cai/core`).
- Coach: relay-to-Mac first ($0), API fallback ($20 cap), queue-for-next-run
  if credits exhausted.

## Contracts (change via main-branch PR before feature work depends on it)

- `packages/db/src/schema.ts` — all tables/enums (spec §5)
- `packages/core/src/*` — authority model, state machine, run contracts
- `packages/agents/src/tiers.ts` — task→model tier map

## Model tiering (dev AND runtime)

- **haiku**: boilerplate, CRUD, tests, migrations, docs; runtime normalization/
  classification/triage
- **sonnet**: default feature implementation; runtime qualification, materials,
  coaching
- **opus**: architecture, contract changes, cross-track integration review,
  gnarly debugging; runtime weekly strategy analysis only

## Conventions

- pnpm workspaces + Turborepo; TypeScript strict, ESM (`type: module`),
  NodeNext resolution — intra-package imports need `.js` extensions.
- Packages: `@cai/db` (Drizzle schema = source of truth), `@cai/core` (pure
  domain logic), `@cai/agents` (runner + tiers), `@cai/browser`, `@cai/email`.
- Tests: vitest, colocated `*.test.ts`.
- DB: local dev on `postgres://cai:cai_dev@localhost:5433/cai_career`
  (docker compose up); `pnpm db:generate && pnpm db:migrate && pnpm db:seed`.
- Parallel tracks work in git worktrees, one branch per track; only meet at
  the contracts above. Process per track: /spec → review → build → /review →
  /ship.

## Commands

- `pnpm typecheck` / `pnpm test` / `pnpm build` (turbo, all packages)
- `docker compose up -d` — local Postgres (:5433) + Redis (:6380)
