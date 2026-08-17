# DevDigest MCP Server

**Status:** in progress — all 10 work items implemented and the plan's
Verification section's live walkthrough (all 5 tools + 3 negative cases)
passed against the real running stack (`acme/payments-api` #482). One real
bug was found and fixed during that live run — `types.ts`'s `RepoSummary`
was parsing the wrong wire field (`fullName` instead of the API's actual
`full_name`), silently breaking `resolveRepo` and 4 of the 5 tools; the
earlier no-network smoke test couldn't have caught this since it never hit
real `/repos` JSON. See `mcp-server/INSIGHTS.md` for the fix and for an open
question flagged, not yet resolved: the MCP SDK `Client`'s default per-call
timeout is shorter than `run_agent_on_pr`'s own `DEVDIGEST_MCP_POLL_TIMEOUT_MS`
(150s), so a real client without an explicit longer per-call timeout will
hit a raw protocol timeout before this tool's own "still running" fallback
ever fires. Not yet done: this repo's `pr-self-review`/architecture-review
gate before merge, and a commit/PR (nothing has been committed yet).

## Context

DevDigest's server (`server/`, Fastify 5 + Drizzle/Postgres, port 3001) already
exposes REST endpoints for agents, reviews/runs, and conventions. This plan
adds a fifth standalone package, `mcp-server/`, exposing 5 MCP tools over
stdio transport so an MCP client (Claude Desktop/Code) can drive PR review
through DevDigest's existing local API — no new server routes required for
4 of the 5 tools, and the 5th (`get_blast_radius`) ships as a permanent,
always-`isError` stub per explicit product scope.

Two architecture decisions are already locked in by the user and are not
re-litigated here: (1) tool params use GitHub-native `owner/repo` + PR number,
resolved internally to DevDigest's DB uuids; (2) `mcp-server/` is a new
top-level package talking to the existing Fastify API over `localhost` HTTP —
never importing server internals in-process.

## Scope

- In scope: `mcp-server/` package scaffold; owner/repo+PR→internal-id
  resolution; 5 MCP tools (`list_agents`, `run_agent_on_pr`, `get_findings`,
  `get_conventions`, `get_blast_radius` stub); stdio transport only; local
  config via env vars, no new secrets file; manual verification via MCP
  Inspector; package `AGENTS.md`+`CLAUDE.md` symlink+`INSIGHTS.md` stub.
- Out of scope: HTTP/SSE MCP transport, OAuth, any new server route
  (including a real `get_blast_radius` HTTP endpoint — `repo-intel`'s
  `getBlastRadius` stays untouched), multi-tenant auth, automated test
  harness beyond optional hermetic unit tests for pure helpers, CI wiring.

## Modules Touched

- New: `mcp-server/` (root-level, sibling to `server/`, `client/`,
  `reviewer-core/`, `e2e/`).
- Read-only dependency on `server/`'s existing HTTP surface — **no server
  code is edited** by this plan (confirmed every needed capability already
  exists as a route).

## Architectural Constraints

- Root `AGENTS.md:27-30` (secrets convention): "Secrets live in
  `~/.devdigest/secrets.json` (mode 0600), not `.env`, not DB" — the new
  package must not invent a second secrets file.
- Root `AGENTS.md:31-35` (docs convention): every package's `CLAUDE.md` is a
  **symlink** to its own `AGENTS.md`, never a separate file — `mcp-server/`
  must follow this exactly (`ln -s AGENTS.md CLAUDE.md`).
- Root `AGENTS.md` package-independence framing ("4 standalone packages, no
  workspace tool... Cross-package types via tsconfig path aliases, not
  published modules") — `mcp-server/` talks to `server/` over HTTP only; it
  must **not** add a tsconfig path alias into `server/` or `reviewer-core/`
  (unlike `server/tsconfig.json:20-23`, which legitimately aliases
  `@devdigest/reviewer-core` because it's an in-process consumer —
  `mcp-server/` is not).
- `server/src/modules/reviews/routes.ts:32` — `POST /pulls/:id/review` has a
  route-local `{max:10, timeWindow:'1 minute'}` rate limit; `server/src/app.ts:96`
  sets a global `120/min` default. `@fastify/rate-limit`'s default key is the
  request IP, so an MCP-server-triggered run and a browser-triggered run from
  the same host **share one bucket** — `run_agent_on_pr` must surface a 429
  as an actionable domain error, not retry silently.
- `server/src/modules/_shared/context.ts:9-11` — `LocalNoAuthProvider`
  always resolves a default workspace/user; there is no real auth boundary
  today. Per this session's MCP-authorization research (stdio servers should
  read local credentials, not implement OAuth) and per decision 2, the MCP
  server sends **no bearer token** in v1 — an accepted trust boundary, not a
  gap to silently patch.

## Relevant INSIGHTS.md Gotchas

- `server/INSIGHTS.md` (2026-07-27 entry, `server/src/vendor/shared/...` vs
  `client/src/vendor/shared/...`) — `@devdigest/shared` is hand-copied twice
  already and has **already drifted** between those two copies. A third
  hand-copy into `mcp-server/` would add a third drift surface for zero
  benefit (the MCP server only needs a handful of response fields, not the
  full contract). Plan decision: `mcp-server/` defines its **own** minimal,
  narrow response interfaces (just the fields each tool actually reads),
  never imports or copies `@devdigest/shared`.
- `server/INSIGHTS.md` (2026-08-05 entries, `pulls/routes.ts:114-186`) —
  "Run all agents" produces multiple `agent_runs` rows per user action;
  picking "the latest row" naively drops sibling agents' data. Not directly
  hit by this plan (each `run_agent_on_pr` call targets exactly one agent,
  one `runId`), but `get_findings` must key strictly off the caller-supplied
  `run_id`, never "the latest review for this PR," to avoid the same class
  of bug.
- `server/INSIGHTS.md` (2026-08-04 entry, `pnpm-workspace.yaml`'s
  `allowBuilds` gate) — pnpm's build-script approval friction is a real,
  previously-hit annoyance for a small/simple package; informs the npm
  choice below.

## Skills Implementer Will Need

- **zod** (`.claude/skills/zod/SKILL.md`) — the 5 tools' flat-arg input
  schemas and the HTTP client's response parsing should follow
  `schema-use-primitives-correctly`, `schema-use-enums` (e.g. a `status`
  field), `type-use-z-infer`/`type-export-schemas-and-types`,
  `error-custom-messages`, and `parse-never-trust-json` (every `fetch(...).json()`
  from the local API is untrusted input to this process, same as any other
  external JSON). No conflict with the MCP SDK's own validation (see
  Error Handling section below).
- **engineering-insights** and **pr-self-review** — root `AGENTS.md:44-63`
  session protocol applies to this package like any other: run
  `engineering-insights` at the end of implementation (writes into a new
  `mcp-server/INSIGHTS.md`), and `pr-self-review` immediately after
  `gh pr create`/each push.
- **security** — no dedicated work item, but flag for the implementer: this
  package's only "input" is MCP tool args (from a trusted local client) and
  its only outbound calls are to a fixed `localhost` base URL — no
  user-supplied URLs, no file uploads, no new secret material. `pr-self-review`'s
  light-mode `security` pass may still run since the file set could
  superficially match; it should find nothing new to fix given this shape.
- **Not applicable, don't force them**: `fastify-best-practices`,
  `onion-architecture`, `drizzle-orm-patterns`, `postgresql-table-design`,
  `golang-architecture` (no Fastify routes, no Drizzle/Postgres code, no Go
  in this package), `next-best-practices`/`react-best-practices`/
  `frontend-ui-architecture`/`react-testing-library` (no frontend code).
  `typescript-expert` is optional/general-quality only, not load-bearing.
  A plain, framework-free TypeScript approach (mirroring `reviewer-core/`'s
  "no framework" stack) is the right shape here.

## Package Layout (`mcp-server/`)

```
mcp-server/
  package.json
  tsconfig.json
  AGENTS.md            # new package's own instructions (Stack/Commands/
                        # Where things live/Non-default conventions/
                        # Session protocol/Docs map, mirroring the other 4)
  CLAUDE.md -> AGENTS.md   # symlink, per root AGENTS.md:31-35
  README.md            # tool list, config, how to point an MCP client at it
  INSIGHTS.md          # empty scaffold with the standard header (see
                        # server/INSIGHTS.md:1-12 for the exact boilerplate)
  src/
    index.ts           # thin entrypoint: build McpServer, call
                        # createContainer(), register 5 tools via
                        # tools/index.ts, connect(new StdioServerTransport())
    container.ts         # COMPOSITION ROOT — the only file that writes
                        # `new FetchDevDigestApiClient(...)`; wires config.ts
                        # into the concrete adapter and hands the
                        # DevDigestApiClient port to resolve.ts + each tool
                        # factory. Nothing else constructs it.
    config.ts           # DEVDIGEST_API_BASE / poll timeout+interval env vars
    ports.ts              # `DevDigestApiClient` interface — one method per
                        # use case (getAgents, getRepos, getRepoPulls,
                        # getRepoConventions, triggerReview, getRuns,
                        # getReviews), not a generic get<T>()/post<T>()
                        # passthrough — mirrors GitHubClient/GitClient's
                        # method-per-capability shape
    http-client.ts       # `FetchDevDigestApiClient implements
                        # DevDigestApiClient` — the ONLY file that imports
                        # `fetch` against the DevDigest API; maps non-2xx →
                        # DomainError with actionable text
    errors.ts            # DomainError (protocol-agnostic, thrown by
                        # resolve.ts/adapter) + toToolError() → MCP's
                        # {isError:true, content} shape, called only at the
                        # tools/*.ts boundary — already correctly layered,
                        # keep this split as-is
    resolve.ts            # resolveRepo(owner,name)->repoId,
                        # resolvePull(repoId,prNumber)->pullId — depends on
                        # the DevDigestApiClient PORT TYPE (ports.ts), never
                        # on http-client.ts's concrete class directly
    types.ts              # narrow local interfaces for the handful of
                        # server response fields actually used (NOT a
                        # @devdigest/shared copy — see Architectural
                        # Constraints)
    mappers.ts             # mapReviewToConciseResult() — the ONE shared
                        # response-shaping helper for the output shape
                        # `run_agent_on_pr` and `get_findings` both return,
                        # so the two don't independently drift (mirrors
                        # reviews/helpers.ts's reviewToDto)
    tools/
      list-agents.ts      # each exports a factory, e.g.
      run-agent-on-pr.ts  # createRunAgentOnPrTool(client: DevDigestApiClient,
      get-findings.ts     # config): ToolHandler — receives its port
      get-conventions.ts  # dependency from container.ts, never imports
      get-blast-radius.ts # http-client.ts itself
      index.ts           # registers all 5 with annotations
  test/                  # hermetic unit tests for resolve.ts / tool
                        # handlers inject a FakeDevDigestApiClient (plain
                        # in-memory object implementing ports.ts, same
                        # pattern as server/src/adapters/mocks.ts) — no
                        # stub HTTP server, no network, see Verification
```

## Port & Composition Root (onion-architecture skill review)

This session ran the repo's `onion-architecture` skill against this package's
design (pre-code, plan-only — the skill's own scope statement targets
`server/` and `reviewer-core/`, but its CRITICAL-tier dependency rule
generalizes to any package with an external I/O dependency). Findings:

- **CRITICAL, fixed in this plan**: `http-client.ts` was previously a
  concrete module imported directly by `resolve.ts` and every `tools/*.ts`
  handler — the same shape as constructing a concrete adapter outside
  `platform/container.ts`. Fix: `ports.ts` declares the
  `DevDigestApiClient` interface (method-per-use-case, not a generic
  `get<T>()/post<T>()`), `http-client.ts` holds the one concrete
  `FetchDevDigestApiClient` implementing it, and `container.ts` is the sole
  place that constructs it and hands it down. `resolve.ts` and every tool
  factory depend on the port type, never on `http-client.ts` directly.
- **CRITICAL, fixed in this plan**: no single composition root previously
  existed distinct from `index.ts`. Fix: `container.ts` (item 10) now owns
  that role, mirroring `platform/container.ts`.
- **Payoff**: this is also what lets unit tests use an in-memory
  `FakeDevDigestApiClient` (same pattern as `server/src/adapters/mocks.ts`)
  instead of a stub HTTP server — see Verification.
- **HIGH → deliberately not applied**: the full `routes.ts`/`service.ts`/
  `repository.ts` per-module anatomy `server/`'s domains use is sized for
  that package's domain count, not 5 tools in one thin client package.
  Applying it here would be ceremony without payoff — the one CRITICAL
  concern (dependency direction) is satisfied by the port/adapter split
  above without it.
- **MEDIUM, fixed in this plan**: `run_agent_on_pr` and `get_findings`
  return an identical output shape — `mappers.ts`'s
  `mapReviewToConciseResult()` (item 6/7) is now the one shared place that
  shapes it, instead of each handler trimming fields inline independently.
- **Already correct, no change**: `errors.ts`'s split between
  protocol-agnostic `DomainError` (thrown by `resolve.ts`/the adapter) and
  `toToolError()` (MCP-shape mapping, called only inside `tools/*.ts`) —
  domain errors don't know about MCP, only the outermost layer does.

## Work Items (dependency order)

1. **Confirm & implement owner/repo+PR→internal-id resolution** —
   `mcp-server/src/resolve.ts`. Already-existing endpoints suffice, no new
   server route needed: `GET /repos` (`server/src/modules/repos/routes.ts:36-39`,
   returns `{id, owner, name, fullName, ...}[]`, `fullName` = `"owner/name"`
   per `server/src/db/schema/repos.ts:12-14`) to resolve `repoId`, then
   `GET /repos/:id/pulls` (`server/src/modules/pulls/routes.ts:27-30`,
   returns rows with `number` + `id`) to resolve `pullId` by matching
   `number`. Files: `src/resolve.ts` (depends on the `DevDigestApiClient`
   port type from `src/ports.ts`, never on `http-client.ts`'s concrete
   class), `src/http-client.ts`, `src/errors.ts`. Depends on: nothing.
   Acceptance: `resolveRepo('acme','payments-api')` and
   `resolvePull(repoId, 482)` (the seeded demo repo/PR, `e2e/AGENTS.md:15-16`)
   return real uuids against a running local stack; a repo not yet imported
   into DevDigest produces a `DomainError` reading "Repo 'x/y' is not
   imported into DevDigest yet. Add it first via POST /repos (or the
   studio's 'Add Repo' flow), then retry." (error-leads-forward); an
   unknown PR number produces the equivalent PR-specific message.

2. **Scaffold the package** — `package.json` (name `@devdigest/mcp-server`,
   `"type":"module"`, npm as package manager — see Package Manager
   Decision below), `tsconfig.json` (mirror `server/tsconfig.json:1-19`'s
   compiler options minus the `paths` block — no cross-package aliases, see
   Architectural Constraints), `AGENTS.md`+`CLAUDE.md` symlink+`INSIGHTS.md`
   stub (mirror `server/AGENTS.md`'s section structure). Depends on:
   nothing (can run in parallel with item 1). Acceptance: `npm install`
   succeeds; `npm run typecheck` passes on an empty `src/index.ts`.

3. **`config.ts`** — reads `DEVDIGEST_API_BASE` (default
   `http://localhost:3001`, matching `server/src/platform/config.ts:29`'s
   `API_PORT` default 3001), `DEVDIGEST_MCP_POLL_TIMEOUT_MS` (default
   `45000` = 45s, **revised down from an original 150s** after live E2E
   verification confirmed the MCP SDK `Client`'s own default per-call
   request timeout is 60s (`DEFAULT_REQUEST_TIMEOUT_MSEC`,
   `node_modules/@modelcontextprotocol/sdk/dist/esm/shared/protocol.js:8`)
   — see item 6's justification), `DEVDIGEST_MCP_POLL_INTERVAL_MS` (default
   `2000`). No secrets-file read
   in v1: nothing this package needs today is a secret (base URL isn't
   sensitive; `LocalNoAuthProvider` means no token is required — see
   Architectural Constraints). Document explicitly in `AGENTS.md`: **if** the
   server ever adds real bearer-token auth, the token is added as a new key
   to the *existing* `~/.devdigest/secrets.json`
   (`server/src/platform/config.ts:87`) and read the same way
   `LocalSecretsProvider` does (`server/src/adapters/secrets/local.ts`) —
   never a second secrets file. Depends on: item 2.

4. **`ports.ts` + `http-client.ts` + `errors.ts`** (onion-architecture
   port/adapter split — see Port & Composition Root section below for the
   rationale). `ports.ts` declares `interface DevDigestApiClient` with one
   method per use case: `getAgents()`, `getRepos()`, `getRepoPulls(repoId)`,
   `getRepoConventions(repoId, filters)`, `triggerReview(pullId, agentId)`,
   `getRuns(pullId)`, `getReviews(pullId)` — each returns a `types.ts` DTO,
   not a raw `fetch` `Response`. `http-client.ts` implements
   `FetchDevDigestApiClient implements DevDigestApiClient`, internally using
   `fetch` against the base URL from `config.ts`; it is the **only** file
   in the package that imports `fetch` for the DevDigest API. On non-2xx:
   attempt to parse the body as `{error:{code,message}}` (matches
   `ApiErrorBody`, `server/src/vendor/shared/contracts/platform.ts:296-301`,
   confirmed shape without importing the vendor file — see Architectural
   Constraints), else fall back to `${status} ${statusText}`; throw
   `DomainError` carrying an actionable message (429 → rate-limit message
   quoting the 10/min route limit; 404 → generic "not found, verify the
   repo/PR/run id"; network failure / ECONNREFUSED → "DevDigest API
   unreachable at `<base>` — is `pnpm dev` running in server/?"). Depends
   on: item 2.

5. **`tools/list-agents.ts`** — no input (declared schema:
   `{type:'object', additionalProperties:false}`, per MCP's own zero-arg
   convention). Calls `GET /agents`
   (`server/src/modules/agents/routes.ts` + `AgentsService.list()`,
   `server/src/modules/agents/service.ts:51-55`). Output: `{agents:
   [{id, name, enabled, provider, model}]}` (drops `description`,
   `output_schema`, `strategy`, `ci_fail_on`, `repo_intel`, `skills_count`,
   `version` — not needed to pick a valid `agent` for `run_agent_on_pr`).
   Annotations: `readOnlyHint:true, idempotentHint:true, openWorldHint:false`
   (previously missing from this work item — every other tool has its
   annotations spelled out, this one must too). Depends on: item 4.
   Acceptance: matches `GET /agents` 1:1 on `id`/`name` against a running
   local stack.

6. **`tools/run-agent-on-pr.ts`** — the synchronous, single-entry-point
   tool. Flow: `resolve.ts` → `{repoId, pullId}`; resolve `agent` (id or
   case-insensitive name) against a fresh `GET /agents` call — id match
   first, else exact case-insensitive name match; if 0 matches → "agent
   '<x>' not found — call list_agents to see valid ids"; if ≥2 name matches
   (no uniqueness constraint on `agents.name`,
   `server/src/db/schema/agents.ts:13`) → "ambiguous agent name '<x>'
   matches N agents — call run_agent_on_pr again with one of these ids:
   [...]". `POST /pulls/:id/review {agentId}` (`server/src/modules/reviews/routes.ts:30-46`,
   body via `RunRequest`, `server/src/vendor/shared/contracts/platform.ts:289-292`)
   → `{runs:[{run_id,...}]}`. Poll `GET /pulls/:id/runs`
   (`server/src/modules/reviews/routes.ts:106-109`, backed by
   `listRunsForPull`, `server/src/modules/reviews/repository/run.repo.ts:40-61`,
   each row has an explicit `status: 'running'|'done'|'failed'|'cancelled'`)
   every `pollIntervalMs`, filtering to the target `run_id`, **not**
   `/pulls/:id/runs/active` — that endpoint only lists in-flight runs, so
   completion is inferred by absence (weaker signal) versus `/runs`'s
   explicit terminal `status` per row. On `'done'`: `GET /pulls/:id/reviews`
   (`reviewsForPull`, `server/src/modules/reviews/service.ts:182-195`),
   filter to the matching `run_id`, map to the concise output below. On
   `'failed'`/`'cancelled'`: `isError:true` with the row's `error` text plus
   the `run_id` (so the caller can still inspect it later). On timeout (no
   terminal status within `timeoutMs`): `isError:false`, `{status:'running',
   run_id, message:"Review still in progress after <N>s — call get_findings(repo, pr, run_id) once it completes"}`.
   429 from the `POST` → the rate-limit `DomainError` from item 4.
   Input schema (flat): `{repo: z.string(), pr: z.number().int().positive(),
   agent: z.string()}`. Output (success): `{status:'done', run_id, verdict,
   summary, score, findings: [{file, start_line, end_line, severity,
   category, title, rationale, suggestion}]}` — drops `confidence`, `kind`,
   `trifecta_components`, `evidence`, `in_scope`, `accepted_at`,
   `dismissed_at`, `review_id`, `id` from `ReviewDtoFinding`
   (`server/src/modules/reviews/helpers.ts:13-17,36-56`) to stay concise.
   Annotations: `readOnlyHint:false, idempotentHint:false, openWorldHint:true`.
   **Timeout justification**: 45s default (revised down from an original
   150s pick — see item 3) is bounded by the MCP SDK `Client`'s own 60s
   default per-call request timeout, confirmed live during this package's
   E2E verification: a real client without an explicit longer per-call
   timeout always hits the SDK's own protocol-level timeout before this
   tool's "still running" fallback can fire, since the SDK's timeout wins
   that race regardless of what `DEVDIGEST_MCP_POLL_TIMEOUT_MS` says. 45s
   leaves ~15s margin under 60s for the resolve/trigger/poll HTTP
   round-trips; configurable via `DEVDIGEST_MCP_POLL_TIMEOUT_MS` for slower
   models/larger diffs, but raising it past ~55s only makes sense paired
   with a matching client-side per-call timeout override. Depends on:
   items 1, 4, 5.

7. **`tools/get-findings.ts`** — input (flat): `{repo: z.string(), pr:
   z.number().int().positive(), run_id: z.string().uuid()}` (`run_id`
   required — "concise verdict for an **already-completed** run" per spec,
   matching what `run_agent_on_pr`'s timeout path hands back). Resolve
   `pullId`; `GET /pulls/:id/reviews`, find the review with matching
   `run_id`. If none found: cross-check `GET /pulls/:id/runs` for that
   `run_id` — status `'running'` → `isError:false {status:'running',
   message:"still running, poll again"}`; status `'failed'`/`'cancelled'`
   → `isError:true` with the error; not found in either → `isError:true`
   "no run found with id=<x> for this PR — check the id or call
   run_agent_on_pr again." Output shape identical to
   `run_agent_on_pr`'s success case. Annotations:
   `readOnlyHint:true, idempotentHint:true, openWorldHint:false`. Depends
   on: items 1, 4.

8. **`tools/get-conventions.ts`** — input (flat): `{repo: z.string(),
   status: z.enum(['pending','accepted','rejected']).optional(), category:
   z.enum(['naming','error-handling','api-shape','imports','testing',
   'security','formatting','architecture','type-safety']).optional(),
   language: z.string().optional()}` — these literal values are a **local
   mirror**, hand-copied from `server/src/vendor/shared/contracts/knowledge.ts:215-228`
   (`ConventionCategory`/`ConventionStatus`), not an import — importing
   `@devdigest/shared` is forbidden by this plan's Architectural Constraints
   (it's already a two-way drift risk between `server/` and `client/`; a
   third copy adds a third drift surface). If the server ever adds/renames a
   category or status value, this list goes stale silently — flag this as
   a known drift risk in `mcp-server/AGENTS.md`, same treatment `server/INSIGHTS.md`
   already gives the existing two copies. Mirrors
   `GET /repos/:id/conventions`'s query params
   (`server/src/modules/conventions/routes.ts:24-38`). Repo-only resolution
   (reuse `resolveRepo` from item 1, no PR needed). Output: `{conventions:
   [{rule, category, status, confidence, evidence_path}]}` — drops
   `evidence_snippet`/`evidence_line_start`/`evidence_line_end`/`origin`/`id`
   for conciseness (per `ConventionCandidate`,
   `server/src/vendor/shared/contracts/knowledge.ts:239-253`). No
   pagination: extraction runs over "≤15 files" per the route's own comment
   (`server/src/modules/conventions/routes.ts:17`), so result sets are
   inherently small — confirmed, not assumed. Annotations:
   `readOnlyHint:true, idempotentHint:true, openWorldHint:false`. Depends
   on: items 1, 4.

9. **`tools/get-blast-radius.ts`** — the stub. Input (flat, for API
   symmetry only, unused internally): `{repo: z.string(), pr:
   z.number().int().positive()}`. The tool's **declared description itself**
   (not just its runtime error) must open with "NOT YET IMPLEMENTED" so a
   calling model doesn't burn a turn expecting real data — see draft text
   in Tool Descriptions below. Makes **zero** HTTP calls — always
   returns `isError:true` with content text: "get_blast_radius is not yet
   implemented — DevDigest's blast-radius engine exists internally
   (`server/src/modules/repo-intel/service.ts` `getBlastRadius`,
   `:252-345`) but has no HTTP route yet (`server/src/modules/repo-intel/routes.ts`
   only exposes `/index-state` and `/resync`) and this MCP tool doesn't call
   it — deferred to a later lesson/homework. Next step: use get_findings for
   review results or get_conventions for repo conventions instead." Stays
   registered/listed per product spec, never hidden. Annotations:
   `readOnlyHint:true, idempotentHint:true, openWorldHint:false`. Depends
   on: item 2 only (no resolution, no HTTP client needed).

10. **`src/container.ts`** (composition root) **+ `src/index.ts` +
    `tools/index.ts`**. `container.ts` is the single place that writes
    `new FetchDevDigestApiClient(config)` and exposes it as the
    `DevDigestApiClient` the rest of the package consumes — no other file
    constructs it. `index.ts` stays thin: call `createContainer()`,
    instantiate `McpServer` (from `@modelcontextprotocol/sdk`), pass the
    container's client into `tools/index.ts`'s registration function,
    register all 5 tools with names prefixed `devdigest_`
    (`devdigest_list_agents`, `devdigest_run_agent_on_pr`,
    `devdigest_get_findings`, `devdigest_get_conventions`,
    `devdigest_get_blast_radius` — short namespace prefix per this
    session's own naming guidance) and descriptions written "as if
    explaining to a new hire" (≤~100 tokens each), attach the annotations
    from items 5-9, connect a `StdioServerTransport`. **Note for
    implementer**: verify the exact `registerTool`/`tool` method signature
    against the installed `@modelcontextprotocol/sdk` version — this API
    has shifted across SDK releases; don't assume a specific signature from
    memory. Depends on: items 5-9.

## Tool Descriptions (draft, use verbatim unless the implementer finds a
better phrasing during item 10 — each explains *when* to call it, not just
what it does, per this session's own naming-guidance research)

- **`devdigest_list_agents`**: "List the reviewer agents configured in this
  DevDigest workspace. Call this first to get a valid `agent` id or name
  before calling `run_agent_on_pr`."
- **`devdigest_run_agent_on_pr`**: "Run a specific reviewer agent on a pull
  request and return its findings. Creates a new review run, waits for it
  to finish (up to ~45 seconds), and returns the verdict and findings in
  one call — no need to poll separately. Requires a valid `agent` id/name
  from `list_agents`."
- **`devdigest_get_findings`**: "Fetch the findings and verdict of an
  already-completed review run by its `run_id`. Use this to check results
  without re-running the agent — e.g. after `run_agent_on_pr` reports the
  run is still in progress."
- **`devdigest_get_conventions`**: "List the coding conventions DevDigest
  has extracted for a repository. Returns an empty list if convention
  extraction hasn't been run for this repo yet — that's not an error."
- **`devdigest_get_blast_radius`**: "NOT YET IMPLEMENTED — this tool always
  returns an error. It will eventually return the set of files/callers
  impacted by a pull request's changes. For now, use `get_findings` for
  review results or `get_conventions` for repo conventions instead."

Each is well under the ~100-token budget from this session's token-efficiency
research — 5 tools this size stay in the "standard eager `tools/list`
loading is fine" bucket, no deferred-loading complexity needed.

## Doc Updates Outside `mcp-server/`

No application code outside `mcp-server/` needs to change — every capability
the 5 tools need already exists as a `server/` REST route, and the
`get_blast_radius` stub deliberately makes zero HTTP calls (see Scope's
"Out of scope" bullet). Two docs, however, are repo-convention gaps this
plan must close once `mcp-server/` exists:

- Root `AGENTS.md`, "Where things live" section — add a `mcp-server/` line
  matching the existing `server/`/`client/`/`reviewer-core/`/`e2e/` entries
  (one-line description + link to `mcp-server/AGENTS.md`), so the package
  list stays accurate.
- Root `README.md`'s architecture diagram / quick start — add a short
  mention of the local MCP server as an optional client-side integration
  (how to point Claude Desktop/Code at it), per `CLAUDE.md`'s Docs map
  convention that `README.md` owns the architecture overview.

Not required now, flagged for later if it becomes a real friction point:
the existing 10/min rate limit on `POST /pulls/:id/review`
(`server/src/modules/reviews/routes.ts:32`) is keyed by IP and shared
between MCP-triggered and browser-triggered runs — if that proves too tight
in practice, giving MCP traffic its own rate-limit bucket/key would be a
`server/` change, out of scope for this plan's v1.

## Package Manager Decision

**npm**, not pnpm. Root `AGENTS.md:9` splits the existing 4 packages
pnpm (`server`/`client`) vs npm (`reviewer-core`/`e2e`) with no stated
universal rule for new packages — a judgment call, not a contradicted
convention. Reasoning: `mcp-server/` is a small, standalone, dependency-light
utility package (closer in spirit to `reviewer-core`/`e2e` than to the two
"main app" packages), it never needs pnpm-workspace-specific linking (no
`workspace:` deps — decision 2 forbids in-process imports of server code
entirely), and it avoids `server/pnpm-workspace.yaml`'s `allowBuilds`
interactive-approval friction already documented as a real annoyance
(`server/INSIGHTS.md`, 2026-08-04 entry, `server/pnpm-workspace.yaml:2`).

## Error Handling (two-tier, per this session's own MCP research)

- **Protocol-level**: malformed tool input (wrong type, missing required
  field) is caught by the MCP SDK itself against each tool's declared zod
  input shape, before the handler runs — a JSON-RPC-level error, not
  something the handler code produces.
- **Domain-level**: everything else (repo/PR/run/agent not found, rate
  limited, API unreachable, run failed, blast-radius stub) is caught inside
  each handler and returned as `{isError: true, content: [{type:'text',
  text: <actionable message>}]}` — every message names a concrete next step
  (call `list_agents`, retry with a specific id, wait N seconds, start the
  server), never a bare status code.

## Verification

- `npm run typecheck` in `mcp-server/` (tsc, no build/dist step required for
  this check).
- **End-to-end, since no MCP test harness exists in this repo**: start the
  real stack (`./scripts/dev.sh` from repo root), then run the MCP server
  under `npx @modelcontextprotocol/inspector node mcp-server/dist/index.js`
  (after `npm run build`) or via `tsx src/index.ts` directly, and manually
  drive all 5 tools against the seeded demo repo/PR
  (`acme/payments-api` #482, `e2e/AGENTS.md:15-16`):
  1. `devdigest_list_agents` — returned ids/names match `curl
     localhost:3001/agents` directly.
  2. `devdigest_run_agent_on_pr('acme/payments-api', 482, <an id or name
     from step 1>)` — completes with real findings, or (if it legitimately
     runs long) returns the `status:'running'` fallback with a `run_id`.
  3. `devdigest_get_findings('acme/payments-api', 482, <run_id from step
     2>)` — returns the same concise findings.
  4. `devdigest_get_conventions('acme/payments-api')` — returns `[]` (empty,
     not an error) if extraction was never run, or real rows after running
     `POST /repos/:id/conventions/extract` once directly.
  5. `devdigest_get_blast_radius('acme/payments-api', 482)` — always
     `isError:true` with the stub message, tool still appears in the
     client's tool list.
  6. Negative cases: an unimported repo, a nonexistent PR number, and an
     unknown agent id/name each produce the specific actionable error text
     from their respective work item.
- Optional (nice-to-have, not blocking): hermetic unit tests for
  `resolve.ts`'s not-found messages, injecting a plain in-memory
  `FakeDevDigestApiClient` (implements `ports.ts`'s `DevDigestApiClient`,
  same pattern as `server/src/adapters/mocks.ts`) instead of a stub HTTP
  server — this is the direct payoff of the port/adapter split in
  "Port & Composition Root" above: no network, no port-binding flakiness.
  `http-client.ts`'s own status-code→`DomainError` mapping (the one place
  that *does* touch `fetch`) can still use a minimal stub HTTP server if the
  implementer wants that one narrow slice covered, but nothing else needs
  it.

## Key File Citations Verified This Session

- `server/src/modules/repos/routes.ts:36-39` — `GET /repos`.
- `server/src/db/schema/repos.ts:12-14` — `owner`/`name`/`fullName`.
- `server/src/modules/pulls/routes.ts:27-30` — `GET /repos/:id/pulls`.
- `server/src/modules/reviews/routes.ts:30-46` — `POST /pulls/:id/review`,
  10/min rate limit at `:32`.
- `server/src/modules/reviews/routes.ts:106-109` — `GET /pulls/:id/runs`.
- `server/src/modules/reviews/repository/run.repo.ts:40-61` —
  `listRunsForPull`, explicit `status` field.
- `server/src/modules/reviews/service.ts:182-195` — `reviewsForPull`.
- `server/src/modules/reviews/helpers.ts:13-17,19-34,36-56` —
  `ReviewDtoFinding`/`ReviewDto`/`findingRowToDto`/`reviewToDto`.
- `server/src/modules/agents/service.ts:51-55` — `AgentsService.list()`.
- `server/src/db/schema/agents.ts:13` — no unique constraint on `name`.
- `server/src/modules/conventions/routes.ts:17,24-38,47-63` — conventions
  endpoints + ≤15-file extraction comment.
- `server/src/vendor/shared/contracts/knowledge.ts:239-253` —
  `ConventionCandidate` shape.
- `server/src/modules/repo-intel/routes.ts` (whole file) — confirms no
  blast-radius HTTP route exists.
- `server/src/modules/repo-intel/service.ts:252-345` — `getBlastRadius`.
- `server/src/platform/config.ts:29,87` — `API_PORT` default 3001,
  `secretsPath`.
- `server/src/adapters/secrets/local.ts` — `LocalSecretsProvider` shape.
- `server/src/modules/_shared/context.ts:9-11` — `LocalNoAuthProvider`.
- `server/src/app.ts:96` — global 120/min rate limit.
- `e2e/AGENTS.md:15-16` — seeded demo repo/PR `acme/payments-api` #482.

## Next Steps

Save this plan to `docs/mcp-server-plan.md` (orchestrating session's job per
root `AGENTS.md`'s Feature-planning convention), then hand off to the
`implementer` agent starting at Work Item 1.
