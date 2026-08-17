# DevDigest

Local-first AI PR review. Course starter — 5 standalone packages, no workspace
tool (no pnpm workspaces/turborepo). Cross-package types via tsconfig path
aliases, not published modules.

## Stack

Node ≥22 · pnpm ≥10 (server/client) · npm (reviewer-core/e2e/mcp-server — see
their own AGENTS.md) · Docker (Postgres+pgvector only; API/web run on host).

## Where things live

- `server/`        Fastify 5 + Drizzle/Postgres API — see [server/AGENTS.md](server/AGENTS.md)
- `client/`         Next.js 15 studio (App Router) — see [client/AGENTS.md](client/AGENTS.md)
- `reviewer-core/`  Pure review engine (diff→LLM→findings), no DB/FS — see [reviewer-core/AGENTS.md](reviewer-core/AGENTS.md)
- `e2e/`            Deterministic browser e2e — see [e2e/AGENTS.md](e2e/AGENTS.md)
- `mcp-server/`     Local stdio MCP server exposing PR review as 5 tools, talks to `server/` over HTTP — see [mcp-server/AGENTS.md](mcp-server/AGENTS.md)
- `docs/`           Cross-cutting reference docs (agent prompts, model choice)

## Commands

`./scripts/dev.sh` boots Postgres+API+web from zero — `mcp-server/` is not
part of it (it's a stdio process an MCP client launches on demand, not a
long-running service). Per-package `pnpm|npm dev|test|typecheck` — see that
package's own AGENTS.md for which.

## Non-default conventions

- `@devdigest/shared` is NOT a package — hand-copied into
  `server/src/vendor/shared` AND `client/src/vendor/shared`. Edit BOTH when a
  shared contract changes — they already drift when you don't (see
  `server/INSIGHTS.md`).
- Migrations do NOT run on boot — `pnpm db:migrate` is manual.
- Secrets live in `~/.devdigest/secrets.json` (mode 0600), not `.env`, not DB.
- Agent instructions live in `AGENTS.md` (repo root and each package). Every
  `CLAUDE.md` next to one is a symlink to that package's `AGENTS.md`, kept
  only so Claude Code's auto-discovery still finds it — edit `AGENTS.md`,
  never the symlink, and don't add a `CLAUDE.md` for a package that doesn't
  already have one without also making it a symlink.

## Do-not-touch

- `server/clones/` — git-ignored working checkouts of indexed repos.
- DB schema already ships every future-lesson table, empty — later lessons fill them.
- Never `docker compose down -v` to "reset" — deletes the `devdigest_pgdata`
  volume and every imported repo/review with it (see `e2e/AGENTS.md`).

## Session protocol

- Before touching a package, skim **that package's own** `INSIGHTS.md` (not the whole repo's).
- After a non-trivial task, run the `engineering-insights` skill to update the
  touched package(s)' `INSIGHTS.md`.
- Immediately after `gh pr create` succeeds, and again after any `git push`
  to a branch with an open PR, invoke the `pr-self-review` skill against
  that PR — not optional, and its posted GitHub review + `blocked-critical`
  label are the actual merge gate, not chat text. Treat a resulting
  "Changes requested" state (including an incomplete-review one) as a hard
  stop on `gh pr merge` unless the user explicitly overrides in the same
  session. This re-check is a session convention, not a real git hook — a
  push made outside a Claude Code session won't re-trigger it.

## Feature planning

- Any plan for a new feature (a plan-mode session) gets saved to
  `docs/<feature-slug>-plan.md` — never left only in the ephemeral
  plan-mode file, whether implementation follows immediately or is
  deferred. Include a `**Status:**` line (not started / in progress /
  done) so it's scannable without opening the diff.
- Cross-reference both ways: if the plan was also rendered as an Artifact,
  link it from the doc's bottom; once implemented, the shipping PR
  description links back to the doc path. Precedent:
  `docs/review-cost-plan.md` (written as step 0, before any code change),
  `docs/findings-by-severity-plan.md` (deferred, links out to its Artifact).

## Docs map

- [README.md](README.md) — quick start, architecture diagram
- [TESTING.md](TESTING.md) — cross-package test strategy
- [docs/](docs/) — cross-cutting reference docs
