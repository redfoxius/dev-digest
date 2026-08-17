# mcp-server/ — @devdigest/mcp-server

Local MCP server exposing DevDigest's review workflow as 5 stdio MCP tools.
Talks to `server/`'s existing Fastify API (`:3001`) over `localhost` HTTP —
**never** imports `server/` internals in-process. Repo-wide rules:
[../AGENTS.md](../AGENTS.md). Full design: [docs/mcp-server-plan.md](../docs/mcp-server-plan.md).

## Stack

TypeScript, `@modelcontextprotocol/sdk` (stdio transport only — no HTTP/SSE
transport, no OAuth), `zod`. No framework, no DB, no FS beyond reading
`process.env` — closest in spirit to `reviewer-core/`'s "no framework" stack.

## Commands

`npm install` then `npm run dev` (runs `src/index.ts` under `tsx watch`) ·
`npm run typecheck` · `npm run build` (emits `dist/`) · `npm test` (vitest,
hermetic — optional, see Verification in the plan doc).

Manual end-to-end check (no automated MCP test harness in this repo): start
the real stack (`./scripts/dev.sh` from repo root), then drive this server
via `npx @modelcontextprotocol/inspector node dist/index.js` (after
`npm run build`) or `npx @modelcontextprotocol/inspector tsx src/index.ts`.

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
- No tsconfig `paths` aliases into `server/`/`reviewer-core/` — unlike
  `server/tsconfig.json`, which legitimately aliases `@devdigest/reviewer-core`
  as an in-process consumer. This package is not one; it only talks to
  `server/` over HTTP.
- `get_blast_radius` is a **permanent stub** by explicit product scope — it
  makes zero HTTP calls and always returns `isError:true`. DevDigest's real
  blast-radius engine (`server/src/modules/repo-intel/service.ts`'s
  `getBlastRadius`) has no HTTP route yet; adding one is out of scope here.
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
