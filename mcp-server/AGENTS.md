# mcp-server/ — @devdigest/mcp-server

Local MCP server exposing DevDigest's review workflow as 5 stdio MCP tools.
Talks to `server/`'s existing Fastify API (`:3001`) over `localhost` HTTP —
the 5 MCP tools **never** import `server/` internals in-process. Repo-wide
rules: [../AGENTS.md](../AGENTS.md). Full design:
[docs/mcp-server-plan.md](../docs/mcp-server-plan.md).

Also ships the `devdigest` CLI (`src/cli/`), a second, deliberately different
entrypoint: `devdigest review --mode working` reviews the local working tree
*before* a PR exists, so it has no DB/API to talk to. It reuses
`reviewer-core`'s `reviewPullRequest` engine **in-process** instead — see
[docs/cli-working-review-plan.md](../docs/cli-working-review-plan.md) and the
Non-default conventions entry below for why this doesn't contradict the
HTTP-only rule above.

## Stack

TypeScript, `@modelcontextprotocol/sdk` (stdio transport only — no HTTP/SSE
transport, no OAuth), `zod`, `openai` (the CLI's OpenRouter call, via
`reviewer-core`). No framework, no DB — the CLI's FS use (secrets file, git
subprocess) is confined to `src/cli/`.

## Commands

`npm install` then `npm run dev` (runs `src/index.ts` under `tsx watch`) ·
`npm run typecheck` · `npm run build` (emits `dist/`, including the bundled
CLI — see below) · `npm test` (vitest, hermetic).

CLI, in dev: `npm run cli -- review --mode working` (runs `src/cli/index.ts`
under `tsx`, which resolves the tsconfig path aliases directly). After
`npm run build`, the built CLI is `node dist/cli/index.js review --mode
working` — this is a **separate build step** from the MCP server's own
`tsc` output: `npm run build:cli` runs `esbuild --bundle --packages=external`
to inline the path-aliased local sources (reviewer-core, shared, the 3 pure
server files) into one file, because plain `node` can't resolve
tsconfig `paths` at runtime the way `tsx`/`tsc --noEmit` can — a bare `tsc`
build of `src/cli/` would type-check clean but throw `ERR_MODULE_NOT_FOUND`
the moment `dist/cli/index.js` actually ran. Real npm dependencies (`openai`
and its own deps) are left external (`--packages=external`) and resolved
normally from `node_modules` at runtime — only the local/aliased sources get
inlined. Confirmed by actually running the built `dist/cli/index.js` via
plain `node` (see docs/cli-working-review-plan.md's Verification).

Manual end-to-end check for the 5 MCP tools (no automated MCP test harness in
this repo): start the real stack (`./scripts/dev.sh` from repo root), then
drive this server via `npx @modelcontextprotocol/inspector node dist/index.js`
(after `npm run build`) or `npx @modelcontextprotocol/inspector tsx src/index.ts`.

## Where things live

- `src/index.ts` — thin entrypoint: builds the container, registers the 5
  tools, connects `StdioServerTransport`
- `src/container.ts` — composition root; the **only** file that constructs
  `new FetchDevDigestApiClient(...)` and hands the `DevDigestApiClient` port
  down to `resolve.ts` and every tool factory
- `src/config.ts` — reads `DEVDIGEST_API_BASE` /
  `DEVDIGEST_MCP_POLL_TIMEOUT_MS` / `DEVDIGEST_MCP_POLL_INTERVAL_MS` from
  `process.env`
- `src/ports.ts` — `DevDigestApiClient` interface, one method per use case
  (mirrors `GitHubClient`/`GitClient`'s method-per-capability shape in
  `server/`, not a generic `get<T>()`)
- `src/http-client.ts` — `FetchDevDigestApiClient implements
  DevDigestApiClient`; the **only** file that calls `fetch` against the
  DevDigest API
- `src/errors.ts` — `DomainError` (protocol-agnostic) + `toToolError()` (MCP
  `{isError, content}` shape), called only inside `tools/*.ts`
- `src/resolve.ts` — `resolveRepo`/`resolvePull`: owner/repo + PR number →
  internal uuid, depends on the `DevDigestApiClient` **port type**, never on
  `http-client.ts` directly
- `src/types.ts` — narrow local response DTOs (see Non-default conventions)
- `src/mappers.ts` — `mapReviewToConciseResult()`, the one shared
  response-shaping helper `run_agent_on_pr` and `get_findings` both use
- `src/tools/*.ts` — one factory per tool (`list-agents.ts`,
  `run-agent-on-pr.ts`, `get-findings.ts`, `get-conventions.ts`,
  `get-blast-radius.ts`), each receiving its `DevDigestApiClient` from
  `container.ts` — never importing `http-client.ts` itself
- `test/` — optional hermetic unit tests, injecting a plain in-memory
  `FakeDevDigestApiClient` (implements `ports.ts`, same pattern as
  `server/src/adapters/mocks.ts`) — no stub HTTP server, no network
- `src/cli/index.ts` — the `devdigest` bin entrypoint: arg parsing (`review
  --mode <working|staged|branch>`, only `working` implemented), dispatch,
  exit code
- `src/cli/modes/working.ts` — orchestrates one `--mode working` run: git
  root → diff + untracked-file disclosure → reviewer → print → exit code
- `src/cli/git.ts` — `findGitRoot`/`getWorkingDiff`/`listUntrackedFiles`,
  each taking an injectable `GitRunner` (real one shells out via
  `execFile('git', ...)`) so tests never touch a real git process
- `src/cli/secrets.ts` — `readSecret()`, a read-only mirror of
  `LocalSecretsProvider.get()` for `OPENROUTER_API_KEY`
- `src/cli/review.ts` — `runWorkingReview()`: the actual reuse point —
  builds `ReviewInput` from the built-in General Reviewer prompt/model and
  calls `reviewPullRequest` (`@devdigest/reviewer-core`); takes an injected
  `LLMProvider` so tests use `MockLLMProvider` instead of a real OpenRouter
  call
- `src/cli/output.ts` — terminal formatting + `exitCodeForFindings()`, which
  reuses `reviewer-core`'s own `gateTriggered()` (the same function
  `toReviewPayload` uses for REQUEST_CHANGES) rather than a second,
  hand-rolled severity check
- `test/cli/` — hermetic: fake `GitRunner`, temp-dir secrets file,
  `MockLLMProvider` from `server/src/adapters/mocks.ts` (same pattern
  `reviewer-core/test/run.test.ts` already uses) — no real git process, no
  real network

## Non-default conventions

- **No secrets file for this package.** The API base URL isn't sensitive
  and `server/src/modules/_shared/context.ts`'s `LocalNoAuthProvider` means
  no bearer token is required in v1 — an accepted trust boundary (see
  `docs/mcp-server-plan.md`'s Architectural Constraints), not a gap. If the
  server ever adds real bearer-token auth, the token is added as a new key
  to the **existing** `~/.devdigest/secrets.json`
  (`server/src/platform/config.ts`'s `secretsPath`) and read the same way
  `LocalSecretsProvider` does (`server/src/adapters/secrets/local.ts`) —
  never a second secrets file.
- `src/types.ts` defines its **own** narrow interfaces for the handful of
  server response fields each tool reads — it never imports or copies
  `@devdigest/shared`. That vendor copy already exists twice
  (`server/src/vendor/shared`, `client/src/vendor/shared`) and has already
  drifted between those two (`server/INSIGHTS.md`); a third hand-copy here
  would add a third drift surface for a client that only needs a few
  fields.
- **Drift risk, flagged deliberately**: `types.ts`'s `ConventionCategory`/
  `ConventionStatus` are hand-copied from
  `server/src/vendor/shared/contracts/knowledge.ts`, and `FindingSeverity`/
  `FindingCategory` are hand-copied from
  `server/src/vendor/shared/contracts/findings.ts`. If the server ever
  adds/renames a category, status, or severity value, these go stale
  silently — same treatment `server/INSIGHTS.md` gives the two existing
  `@devdigest/shared` copies. Check both files if a `get_conventions` or
  `get_findings` result looks wrong after a `server/` contract change.
- **2026-08-18 — amended, not repealed:** the 5 MCP tools (`src/tools/*.ts`,
  `src/http-client.ts`, etc.) still talk to `server/` HTTP-only and never
  import its internals — that half of the rule stands. `src/cli/` is the one
  deliberate exception: `tsconfig.json`'s `paths` now alias
  `@devdigest/reviewer-core`/`@devdigest/shared` (mirroring
  `server/tsconfig.json`) plus 3 **named, single-file** server paths
  (`@devdigest/server/diff-parser`, `/review-defaults`, `/review-constants`
  — no wildcard into `server/src/*`, so nothing else there is reachable this
  way). All 5 are pure/side-effect-free — no DB, Fastify, Drizzle, Octokit,
  or `dotenv/config` import is reachable through them. Rationale: `--mode
  working` reviews a diff that only exists in the user's local working tree
  (never in `server/clones/` or the DB), so there is no PR/HTTP endpoint to
  call in the first place, and requiring the whole Postgres+API stack up
  just to lint an uncommitted diff before push would defeat the point of
  moving the check earlier. `reviewer-core`'s own tests already cross-import
  `server/src/adapters/mocks.ts` in-process, so a second in-process TS-source
  consumer isn't a new precedent in this repo, just the first time
  `mcp-server/` uses it outside a test. Full reasoning:
  [docs/cli-working-review-plan.md](../docs/cli-working-review-plan.md).
- **2026-08-17 correction:** `get_blast_radius` is no longer a stub — it was
  called "permanent" by explicit product scope, but `GET /pulls/:id/blast`
  shipped (`server/src/modules/blast/`, docs/blast-radius-plan.md) and this
  tool now proxies it via `client.getBlastRadius(pullId)`
  (`tools/get-blast-radius.ts`), same resolve+call shape as every other tool.
- The 10/min rate limit on `POST /pulls/:id/review`
  (`server/src/modules/reviews/routes.ts`) is keyed by IP and shared with
  any browser-triggered run from the same host — `run_agent_on_pr` surfaces
  a 429 as an actionable `DomainError`, never retries silently.

## Session protocol

- Before work: skim [INSIGHTS.md](INSIGHTS.md); name the top relevant
  points.
- After a non-trivial task: run the `engineering-insights` skill.
- Immediately after `gh pr create` / any later push to that PR: run the
  `pr-self-review` skill (root `AGENTS.md`'s session protocol applies here
  like any other package).

## Docs map

- [README.md](README.md) — tool list, config env vars, pointing an MCP
  client at this server
- [INSIGHTS.md](INSIGHTS.md) — dev log: decisions/gotchas found while
  working here
- [../docs/mcp-server-plan.md](../docs/mcp-server-plan.md) — the full
  Development Plan this package was built from (architecture rationale,
  work-item acceptance criteria, verification steps)
- [../docs/cli-working-review-plan.md](../docs/cli-working-review-plan.md) —
  the `devdigest review --mode working` CLI: why it's an in-process
  `reviewer-core` consumer, the exit-code contract, files touched
