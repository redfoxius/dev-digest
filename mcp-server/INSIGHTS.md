# INSIGHTS — mcp-server

Practical findings hit while working in this module. Append-only: correct a
stale entry with a new dated line, never edit or delete history silently.

Before writing here, check [AGENTS.md](AGENTS.md) — a finding that should
*always* apply belongs there as a standing rule; this file is for things too
specific, too contextual, or too unproven for that yet.

**Anti-vague test:** if someone who just read the code wouldn't be surprised,
don't write it. See the repo's `engineering-insights` skill for the full
workflow and quality bar.

## What Works

- 2026-08-17: To smoke-test a stdio MCP server without a real MCP client,
  don't pipe a closed stdin (e.g. `echo '' | tsx src/index.ts` or
  `< /dev/null`) — `StdioServerTransport` treats stdin EOF as a close signal,
  so the process exits cleanly (code 0) almost immediately, which looks like
  success but doesn't actually prove the server stays connected. Instead
  run under a kept-open stdin (`tail -f /dev/null | tsx src/index.ts`) in
  the background, confirm the process is still alive + stdout/stderr empty
  after a few seconds, then kill it — that's the real "registered tools,
  connected transport, waiting for input" signal. See
  `mcp-server/src/index.ts`.

## What Doesn't Work

- 2026-08-17: Building a zod response schema from a DB/TS field-name citation
  (e.g. `server/src/db/schema/repos.ts:14`'s `fullName`) instead of an
  observed live response is not safe — the wire JSON key can differ from the
  internal field name. `GET /repos` actually serializes `full_name`
  (snake_case), per the DTO mapper at `server/src/modules/repos/helpers.ts:50`,
  not `fullName`. The original `RepoSummarySchema` (`fullName: z.string()`)
  silently failed `.safeParse()` against every real `/repos` response
  (`invalid_type` on `fullName`), which broke `resolveRepo` — and therefore
  `run_agent_on_pr`/`get_findings`/`get_conventions`, every tool that
  resolves a repo — for every real call, while `npm run typecheck` and the
  earlier no-network stdio smoke test both stayed green. Only a real HTTP
  round-trip caught it. Fixed: `RepoSummarySchema` now parses wire key
  `full_name` and `.transform()`s it to `fullName` so the rest of the
  package keeps its camelCase convention (`mcp-server/src/types.ts`). Other
  `*Schema`s in `types.ts` written the same way
  (`AgentSummarySchema`/`ConventionSummarySchema`/`ReviewRecordSchema`/
  `RunRowSchema`) were not exhaustively re-verified field-by-field against
  live JSON this session — only `PullSummarySchema` was spot-checked (via
  `curl localhost:3001/repos/:id/pulls`) and confirmed fine.

## Codebase Patterns

- 2026-08-18: `reviewer-core`'s own test suite already cross-imports
  `server/src/adapters/mocks.ts` in-process via a plain relative path
  (`reviewer-core/test/run.test.ts`) — no tsconfig alias needed for that,
  since it's a relative import, not a bare specifier. `mcp-server/test/cli/
  review.test.ts` reuses the same `MockLLMProvider` the same way. Vitest does
  **not** read `tsconfig.json`'s `paths` on its own, though — the bare
  specifiers (`@devdigest/reviewer-core`, `@devdigest/shared`,
  `@devdigest/server/*`) needed a hand-written `vitest.config.ts` with
  `resolve.alias` mirroring `tsconfig.json`'s paths exactly (same pattern
  `reviewer-core/vitest.config.ts` already uses for `@devdigest/shared`).
  Forgetting to update one when the other changes silently breaks tests with
  "Cannot find module", not a type error. See `mcp-server/vitest.config.ts`,
  `mcp-server/tsconfig.json`.

- 2026-08-17: `tools/index.ts`'s `getAllToolDefinitions()` must cast each
  factory's return value with `as ToolDefinition` (widening from
  `ToolDefinition<SpecificInput>` to the default `ToolDefinition<unknown>`)
  — TS rejects the implicit widening because `ToolDefinition.handler` is an
  interface *property* of function type, so it's checked contravariantly
  under `strictFunctionTypes`: a `handler: (input: {repo:string}, ...) => ...`
  isn't assignable to `handler: (input: unknown, ...) => ...`. Safe here
  because `index.ts` only ever calls `def.handler(input, deps)` with `input`
  already validated by the MCP SDK against `def.inputSchema` before the
  handler runs. See `mcp-server/src/tools/index.ts:9-21`,
  `mcp-server/src/tool-contract.ts:42-54`.

## Tool & Library Notes

- 2026-08-18: `tsx`, `tsc --noEmit`, and Vitest all resolve `tsconfig.json`'s
  `paths` fine, but a plain `node dist/cli/index.js` run of the actual `bin`
  entrypoint does NOT — Node has no idea what `@devdigest/reviewer-core`
  means. A bare `tsc -p tsconfig.json` build of an aliased entrypoint
  type-checks clean and even emits files, then throws
  `ERR_MODULE_NOT_FOUND` the instant the compiled output actually runs.
  Caught only by actually running the built binary, not by typecheck alone.
  Fixed with a second build step, `esbuild --bundle` on the CLI entry only
  (`mcp-server/package.json`'s `build:cli`), which inlines the resolved
  path-aliased sources into one file. `reviewer-core/README.md` already
  documents this exact split for its OTHER TS-source consumer (server
  consumes it via tsx-in-dev / vitest-in-tests / `@vercel/ncc` bundle for
  the CI runner) — this is the same shape, just `esbuild` instead of `ncc`.
- 2026-08-18: `esbuild --bundle` with no `--packages=external` pulled `openai`
  (a real npm dependency, needed because `reviewer-core`'s `OpenRouterProvider`
  imports it) into the same bundle as the path-aliased local sources. `openai`
  transitively pulls in `node-fetch@2`, a CJS package that does
  `require('stream')` at module-load time — esbuild's ESM output wraps that
  as a runtime `Dynamic require of "stream" is not supported` throw the
  moment the bundle's entrypoint executes (not a build-time error). Fixed by
  adding `--packages=external`: everything reachable from `node_modules`
  (the real npm deps) is left external and resolved normally by Node at
  runtime; only the tsconfig-path-aliased sources (which live OUTSIDE
  `node_modules`) still get inlined. Bundle size dropped 1.1MB → 71.9KB, and
  `node dist/cli/index.js review --mode working` then actually ran (real
  OpenRouter call, real structured output, real grounding). See
  `mcp-server/package.json`'s `build:cli`.

- 2026-08-17: `@modelcontextprotocol/sdk@1.30.0`'s
  `McpServer.registerTool(name, config, cb)` accepts a full zod schema
  (`ZodTypeAny`/`ZodObject`, not just a raw `{field: z.string()}` shape)
  directly as `config.inputSchema` — its `InputArgs` generic is
  `undefined | ZodRawShapeCompat | AnySchema` where
  `AnySchema = z3.ZodTypeAny | z4.$ZodType`. No raw-shape conversion needed
  when every `tools/*.ts` factory already builds a full `z.object({...})`.
  Confirmed by reading (not assuming)
  `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts:150-157`
  and `.../server/zod-compat.d.ts:1-5`.
- 2026-08-17: This SDK version has no root-level re-export of `McpServer`/
  `StdioServerTransport`/`CallToolResult` — they're pulled in via subpath
  imports (`@modelcontextprotocol/sdk/server/mcp.js`,
  `/server/stdio.js`, `/types.js`) through the package's `"./*"` wildcard
  entry in `package.json`'s `exports` map, not the `"."` root export. See
  `mcp-server/src/index.ts:2-4`,
  `node_modules/@modelcontextprotocol/sdk/package.json`'s `exports`.

## Recurring Errors & Fixes

- 2026-08-17: TS2339 `Property 'structuredContent' does not exist on type
  'ToolCallResult'` when building the SDK adapter in `index.ts` —
  `ToolCallResult` is a union (`ToolSuccessResult | ToolErrorResult`) and only
  the success arm has `structuredContent`. Fix: narrow with
  `if (result.isError) { ... }` before reading `structuredContent`, rather
  than accessing it unconditionally. See `mcp-server/src/index.ts:38-48`,
  `mcp-server/src/tool-contract.ts:16-24`.

## Open Questions

- 2026-08-17: `run_agent_on_pr`'s own poll timeout
  (`DEVDIGEST_MCP_POLL_TIMEOUT_MS`, default 150000ms) is longer than the
  `@modelcontextprotocol/sdk` MCP `Client`'s default per-call request
  timeout (`DEFAULT_REQUEST_TIMEOUT_MSEC`, `node_modules/@modelcontextprotocol/sdk/dist/esm/shared/protocol.d.ts:55`).
  A real E2E run against `acme/payments-api` #482 took ~101s (real LLM
  latency) and threw `MCP error -32001: Request timed out` under the SDK's
  default; it only succeeded once the test harness passed an explicit
  `{timeout: 180000}` per call. Any real MCP client that doesn't override
  its default per-call timeout for this tool will see a generic
  protocol-level timeout instead of this package's own "still running, call
  get_findings later" fallback (that fallback can never fire — the SDK's
  shorter default always wins the race). Unresolved: either document the
  needed client-side timeout override in `mcp-server/README.md`, or lower
  `DEVDIGEST_MCP_POLL_TIMEOUT_MS`'s default to sit under typical MCP client
  defaults — not decided this session, flagged for the plan owner.
- 2026-08-17 (resolved): lowered `DEVDIGEST_MCP_POLL_TIMEOUT_MS`'s default
  from 150000ms to 45000ms (`src/config.ts`) — 45s sits comfortably under
  the SDK's 60s `DEFAULT_REQUEST_TIMEOUT_MSEC`, leaving ~15s margin for the
  resolve/trigger/poll HTTP round-trips, so the tool's own "still running"
  fallback now has a real chance to fire before a generic client-side
  protocol timeout does. Updated the `run_agent_on_pr` tool description
  (`src/tools/run-agent-on-pr.ts`), `README.md`'s config table, and
  `docs/mcp-server-plan.md`'s Work Items 3/6 to match. Still true: a client
  making a single review wait past 45s (e.g. a genuinely slow model) will
  get the `status:'running'` fallback rather than a hang — this was the
  intended behavior all along, just now reachable in practice.

## Session Notes

- 2026-08-17: Implemented Work Item 10 (`container.ts`, `tools/index.ts`,
  `index.ts`) on top of already-existing foundation files + 5 tool factories.
  `npm run typecheck` passes clean across the full package; manual stdio
  smoke test (background process, kept-open stdin) confirmed the server
  starts, registers all 5 `devdigest_`-prefixed tools, and connects without
  throwing. No real end-to-end run against a live DevDigest API was
  performed this session — see plan's Verification section for that
  follow-up.
- 2026-08-17: Ran the plan's live E2E walkthrough against the already-running
  local stack (Postgres healthy, API on :3001, `acme/payments-api` #482
  pre-seeded with 3 existing runs) using a throwaway `@modelcontextprotocol/sdk`
  `Client`+`StdioClientTransport` harness (not committed — deleted after
  use). Found and fixed the `full_name`/`fullName` bug above; all 5 tools'
  happy paths and all 3 negative cases (unimported repo, nonexistent PR,
  unknown agent) pass after the fix, including one real `run_agent_on_pr`
  call against the live OpenRouter-backed "General Reviewer" agent
  (verdict `approve`, 0 findings — the demo repo has no real diff content,
  `clone_path` is `null` for `acme/payments-api`, so an empty-diff verdict
  is expected seed-data behavior, not a bug) and a follow-up `get_findings`
  call on the resulting `run_id`.
- 2026-08-18: Implemented `devdigest review --mode working` (`src/cli/`),
  reusing `reviewer-core`'s `reviewPullRequest` in-process (new, narrow
  tsconfig aliases — see AGENTS.md's amended Non-default conventions entry
  and `docs/cli-working-review-plan.md`). Dogfooded the CLI against this
  session's own real uncommitted diff mid-implementation (real OpenRouter
  call, `~/.devdigest/secrets.json` key): it correctly surfaced the
  pre-`--packages=external` bundling gap above as a CRITICAL finding on its
  own PR. A later run also returned a CRITICAL finding claiming
  `tsconfig.json`'s `paths` needs `baseUrl` alongside it or every tool
  silently ignores `paths` — empirically false in this repo (`tsc`, `tsx`,
  and `esbuild` all resolved the paths correctly with no `baseUrl` present,
  confirmed by the passing typecheck and the real successful runs above);
  a reminder that a grounded citation (real file:line) is not the same as a
  factually correct claim — grounding only proves the finding cites real
  diff content, not that its claim about that content is true. `npm run
  typecheck` and `npm test` (14 new hermetic tests, `test/cli/`) both pass;
  `server/`'s own typecheck also re-verified clean after moving
  `DEFAULT_PROVIDER`/`DEFAULT_MODEL` into `seed-prompts.ts`.
