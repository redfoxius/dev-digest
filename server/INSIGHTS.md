# INSIGHTS — server

Practical findings hit while working in this module. Append-only: correct a
stale entry with a new dated line, never edit or delete history silently.

Before writing here, check [AGENTS.md](AGENTS.md) — a finding that should
*always* apply belongs there as a standing rule; this file is for things too
specific, too contextual, or too unproven for that yet.

**Anti-vague test:** if someone who just read the code wouldn't be surprised,
don't write it. See the repo's `engineering-insights` skill for the full
workflow and quality bar.

## What Works

## What Doesn't Work

- 2026-08-09 — Deriving a config-derived convention candidate's `language`
  via `languageIdForFile(evidence_path)` is wrong: that function resolves by
  SOURCE-file extension (`.ts`, `.go`), but config filenames (`tsconfig.json`,
  `go.mod`, `.golangci.yml`) have no registered source extension, so it
  silently returns `null` for every config-origin candidate — exactly the
  pool where the field matters most (highest-confidence, always-`accepted`).
  Fixed with a second, pack-aware helper (`languageForConfigFile`,
  `conventions/langs/index.ts`) that returns whichever pack's `id` matched
  the filename, instead of re-deriving from an extension that isn't there.
  Before adding a "language" field to anything keyed by a config file path
  (not a source file path), check whether the extension-based registry
  lookup even applies — it doesn't for config filenames.
  (`server/src/modules/conventions/service.ts`,
  `server/src/modules/conventions/langs/index.ts:languageForConfigFile`)

## Codebase Patterns

- 2026-08-14 — `docs/smart-diff-plan.md` Phase 2 describes `SmartDiffService`
  as "constructed with `Container` … composes: 1. Files … 2. Latest review's
  findings … (a query joined to `agent_runs`, ordered by `created_at DESC`)" —
  phrasing that reads as if the join query itself belongs inside
  `smart-diff/service.ts`. It doesn't: `onion-architecture`'s CRITICAL rule
  (service.ts never imports `drizzle-orm`) still applies to a brand-new
  capability module exactly like it does to `reviews`/`intent`. The single-PR
  batch-key algorithm (re-derived from `pulls/routes.ts`'s multi-PR version)
  had to land as a new `ReviewRepository.getLatestReviewBatchFindings(prId)`
  method (`review.repo.ts`), with the service only calling it — a plan
  description of "the service composes X and Y" is about the USE CASE, not
  necessarily where the query text itself is allowed to live. Confirmed by
  re-reading `intent/service.ts`, which never touches `container.db` directly
  either, only `container.reviewRepo.*` methods, despite deriving output from
  several data sources the same way this plan describes Smart Diff doing.
  Scoping the algorithm to one `prId` also let it become a single `leftJoin`
  (`reviews` → `agentRuns` on `reviews.runId = agentRuns.id`) instead of the
  two-`Map` bulk-grouping shape `pulls/routes.ts` needs for its multi-PR list
  — simpler, and still correct against `reviews.runId`'s missing FK (an
  orphaned/unmatched `runId` just yields `multiAgentRunId: null` from the
  join, falling back to the review's own id as its batch key, same as the
  bulk version's fallback).
  (`server/src/modules/reviews/repository/review.repo.ts:getLatestReviewBatchFindings`,
  `server/src/modules/smart-diff/service.ts`)

- 2026-08-14 — Reusing repo-intel's `EXCLUDED_DIRS` shape (each entry wrapped
  `/x/` for path-segment matching) against a `pr_files.path` value needs a
  leading-slash normalization repo-intel's OWN walk code never needed: a
  repo-relative path like `dist/bundle.js` or `vendor/foo.go` has NO leading
  slash, so `path.includes('/dist/')` is false even though `dist` is
  genuinely the path's first segment — repo-intel's walk (`pipeline/walk.ts`)
  never hits this because it matches directory NAMES directly, not this
  `/x/`-wrapped substring shape. `smart-diff/classifier.ts`'s
  `classifyFile()` (Phase 1 of `docs/smart-diff-plan.md`) fixed it by
  matching against a synthetic `` `/${path}` `` instead of the raw lowercased
  path. Caught by two failing unit tests (`dist/bundle.js`, a `/vendor/`-path
  Go file both wrongly landing `core` instead of `boilerplate`) before the
  fix — any future consumer of an `EXCLUDED_DIRS`-style `/dir/`-wrapped
  pattern list against a repo-relative path needs the same normalization.
  (`server/src/modules/smart-diff/classifier.ts`,
  `server/test/smart-diff-classifier.test.ts`)

- 2026-08-05 — `multi_agent_runs` (`server/src/db/schema/runs.ts`) sat in the
  schema with zero inserts/selects anywhere in the codebase (confirmed by
  repo-wide grep) before this date — its shape (`id, workspaceId, prId,
  ranAt`, no agent-specific fields) is exactly a "batch" grouping row, but
  nothing wired it up. Before assuming an empty/unused table like this is a
  "future lesson" placeholder (per root `CLAUDE.md`'s do-not-touch note) and
  leaving it alone, confirm with whoever owns the course content — in this
  case the user explicitly said to use it rather than add a parallel
  mechanism. Now wired: `ReviewService.runReview()` inserts one row per
  `POST /pulls/:id/review` call and stamps every `agent_runs` row it creates
  with `multi_agent_run_id` (migration `0012_lively_molly_hayes.sql`).
  (`server/src/db/schema/runs.ts:8-20`, `server/src/modules/reviews/service.ts:114-136`)

- 2026-08-05 — Any "PR list shows the latest X" feature that reads from
  `reviews`/`agent_runs` must account for "Run all agents" creating MULTIPLE
  independent rows (one per agent) in one user action, each with its own
  `createdAt`/`ranAt`. Picking a single row via `ORDER BY ... DESC` +
  first-seen-per-PR (the pattern used for SCORE, and initially copied for
  FINDINGS/COST) silently drops every sibling agent's data whenever the row
  with the max timestamp happens to be a "boring" one (e.g. an agent that
  found nothing). This bit both the FINDINGS column
  (`docs/findings-by-severity-plan.md`'s 2026-08-05 correction) and
  `latest_run_cost_usd` (from the review-cost feature, commit `122c07c`) —
  same root cause, found independently by the user for each. Fixed via the
  `multi_agent_runs` batch-id grouping above; SCORE was deliberately left as
  single-latest-row (a score isn't meaningfully summable across agents).
  Generalizable check for the next "latest N" feature over these two tables:
  ask "what happens when 3 agents ran together and 2 of them are boring?"
  before shipping.
  (`server/src/modules/pulls/routes.ts:114-186`,
  `server/test/reviews.it.test.ts` — "PR-list FINDINGS/COST sum every agent
  from the LAST 'run all' action…")

- 2026-07-27 — `@devdigest/shared` is hand-copied into both `server/src/vendor/shared`
  and `client/src/vendor/shared`, not a real linked package — and the copies
  have already drifted: `AgentManifest`, the `sessionId` field on the
  OpenRouter payload, and the `'openrouter'` provider id exist in the server
  copy but not the client copy. Grep the client copy before assuming a shared
  contract change only needs to happen here.
  (`server/src/vendor/shared/contracts/eval-ci.ts:144-172`,
  `server/src/vendor/shared/adapters.ts:64-69,83` vs the equivalent
  `client/src/vendor/shared/` files, which lack them)

- 2026-08-04 — Growing a shared trace contract (e.g. `RunStats`) means
  updating fixtures in at least 3 separate places, not the 2 you'd find by
  grepping component tests: `server/test/contracts.test.ts` builds its own
  standalone `RunTrace.parse({...})` fixture, independent of
  `RunTraceDrawer.test.tsx`'s. Skipped it once while planning the `cost_usd`
  field and only caught it because the unit suite failed on a Zod
  `invalid_type` error, not from reading the plan.
  (`server/test/contracts.test.ts:160`)

- 2026-08-04 — No SQL `sum()`/`.groupBy()` call exists anywhere in
  `server/src/modules` — the established idiom for a per-PR aggregate (score,
  now cost) is an `IN`-query over the small PR-id list + JS `Map` grouping in
  the route handler itself, not a database-side aggregate. Follow this
  pattern rather than reaching for Drizzle's `sum()` (which also types as
  `string | null` even over a `double precision` column).
  (`server/src/modules/pulls/routes.ts:137-145`, mirroring the pre-existing
  `latestReviewByPr` map at `server/src/modules/pulls/routes.ts:119-128`)

- 2026-08-04 — Extending a shared allowlist constant (`SUPPORTED_EXT` →
  `repo-intel/languages/index.ts`) means auditing every consumer via
  `pnpm typecheck`, not just `grep`. A pre-refactor grep found 3 documented
  consumers + 1 already-known 4th; `depgraph/index.ts` was a genuine 5th
  that only surfaced as a `tsc` import error after the migration. Separately:
  `dependency-cruiser` (used there to build the TS/JS import graph) has no
  concept of Go — once the shared registry started admitting `.go` files,
  this call site needed an explicit `languageIdForFile(f) === 'typescript'`
  filter before `cruise()`, or Go paths would silently flow into a tool that
  can't parse them.
  (`server/src/adapters/depgraph/index.ts:20,55`)

- 2026-08-04 — Adding a second `DepGraph` implementation didn't need a
  registry or a container-level branch: `UnionDepGraph` composes
  `[DepCruiseGraph, GoDepGraph]` behind the same `DepGraph` port and the
  container swaps one `new X()` for `new UnionDepGraph()`
  (`server/src/platform/container.ts:123`) — both existing pipeline call
  sites (`pipeline/full.ts:216`, `pipeline/incremental.ts:219`) already
  passed the full multi-language file list and left filtering to the
  adapter, so nothing upstream had to change. Worth reusing this
  compose-behind-the-port shape for the next per-language port (e.g. a
  future language's own regex fallback or depgraph builder) instead of
  threading a language switch through call sites.
  (`server/src/adapters/depgraph/union.ts`)

- 2026-08-04 — The seeded `PERFORMANCE_REVIEWER_PROMPT`
  (`server/src/db/seed-prompts.ts`) had asserted, as a static fact sent to
  the LLM on every review, "With max ~10 connections this stalls the whole
  service" — DevDigest's own DB pool size, stated as if it were true of
  whatever repo is actually being reviewed. Not a code bug (typechecks,
  runs fine), but a correctness bug in prompt content — worth grepping
  seeded prompt strings for other repo-specific facts (pool sizes,
  concurrency limits, provider names) whenever "review any repo" tooling
  is extended, since nothing catches a wrong assumption baked into prose.
  (`server/src/db/seed-prompts.ts` pre-Phase-4; removed in the same change
  that added per-diff `# Languages in this diff` framing, see
  `server/src/modules/reviews/helpers.ts:buildStackFraming`)

- 2026-08-04 — `pnpm typecheck` only covers `src/**/*.ts` (per
  `server/tsconfig.json`'s `include`) — `server/test/**` is NEVER
  type-checked, only transpiled by vitest's esbuild (which strips types
  without checking them). Adding a required field to a shared interface
  (`IndexState.languages`) silently left 3 test fixtures constructing that
  interface's shape without the new field — `pnpm typecheck` passed clean
  every time; only running the actual test suite (or manually re-reading
  every literal typed as that interface) surfaced them. Don't trust
  `pnpm typecheck` alone as a completeness signal when growing a type that
  test fixtures also construct.
  (`server/tsconfig.json:26` `"include": ["src/**/*.ts"]`)

- 2026-08-07 — `FEATURE_MODELS` (`contracts/platform.ts:43-79`) already had a
  `'conventions'` entry (from the Skills-feature session, unused until this
  one) but its shipped default was `openai`/`gpt-5.4` — a flagship, non-cheap
  model, silently contradicting the Conventions Extractor lesson's explicit
  "cheap model" requirement. Before wiring a new module to an existing
  `FeatureModelId` slot, check its registry default actually matches what the
  feature needs — a placeholder registered by an earlier session isn't
  guaranteed to have the right default, only the right shape. Fixed in both
  vendor copies to `openrouter`/`deepseek/deepseek-v4-flash`.
  (`server/src/vendor/shared/contracts/platform.ts:73-78`,
  `server/src/modules/settings/feature-models.ts:51-56`)

- 2026-08-07 — `SkillsService.create()` hardcodes `source: 'manual'`
  (`server/src/modules/skills/service.ts:107-118`) — there is no service-level
  entry point for creating a skill with a different `SkillSource`. A new
  producer of skills (here, Conventions Extractor's `source: 'extracted'`)
  must call `SkillsRepository.insert()` directly (it already accepts
  `source` as a parameter, `server/src/modules/skills/repository.ts:17-26`)
  rather than going through `SkillsService`, and reuse `toSkillDto` from
  `skills/helpers.ts` for the response shape. Don't add a new
  `SkillsService` method just to unlock a different `source` value — the
  repository already supports it.
  (`server/src/modules/conventions/service.ts` `createSkillFromCandidates`)

- 2026-08-09 — When a DB-reading service method needs real, verifiable
  computation (ranking, stratification, any non-trivial algorithm), split
  the algorithm into a pure function in `pipeline/*.ts` (input arrays/
  values in, result out — no DB, no `this`) and keep the service method as
  a thin fetch-then-delegate wrapper. Mirrors `pipeline/rank.ts`'s existing
  split of PageRank out of its DB wrapper; followed again for
  `pipeline/sample.ts`'s `stratifyByLanguage`. Makes the actual logic
  hermetically unit-testable (`repo-intel-sample.test.ts`) without a
  repository stub or Postgres, and sidesteps subtle real-world flakiness
  (see the `DepCruiseGraph` macOS entry below) a DB/real-pipeline-backed
  test would otherwise be at the mercy of.
  (`server/src/modules/repo-intel/pipeline/sample.ts`,
  `server/src/modules/repo-intel/service.ts:getConventionSamplesStratified`)

- 2026-08-09 — `reviews.runId` (`server/src/db/schema/reviews.ts:19`) is a
  plain `uuid` column with NO foreign-key reference to `agent_runs.id`
  (comment at `run.repo.ts:73-77` already flags this for `deleteAgentRun`'s
  manual cascade). Building `SkillsRepository.getStats`'s findings-by-
  category query (joining `agent_run_skills` → `agent_runs` for the window
  filter → `reviews` via `reviews.runId` → `findings`) means that join has
  no referential-integrity guarantee — an orphaned/stale `reviews.runId`
  would silently produce no rows rather than a DB-level error. Any new
  query joining through `reviews.runId` should assume the same.
  (`server/src/modules/skills/repository.ts:getStats`)

- 2026-08-09 — `POST /agents/:id/skills {skill_ids}` (the bulk reorder/
  replace endpoint) and `PATCH /agents/:id/skills/:skillId {enabled}` are
  NOT interchangeable for "attach a skill enabled" despite both mutating
  the same `agent_skills` link: the bulk POST defaults a BRAND-NEW skill_id
  in the list to `enabled: false` (`agents/repository.ts:299`, preserving
  existing links' enabled state via `enabledById` — reorder semantics), while
  only PATCH both attaches AND sets `enabled: true` in one call ("toggle to
  attach", `agents/repository.ts:307-`). A `skills.it.test.ts` stats fixture
  first tried the bulk POST to link+enable a skill for a control-experiment
  seed and got `used_by: 0` — silently wrong, not an error — until switched
  to PATCH.
  (`server/src/modules/agents/repository.ts:287-305`,
  `server/test/skills.it.test.ts:GET /skills/:id/stats`)

- 2026-08-09 — Adding a new automatic Container-level capability call site
  inside `executeRuns()` (Intent Layer's `container.intentDeriver.derive()`,
  mirroring `repoIntel`) silently makes every EXISTING `*.it.test.ts` that
  exercises `POST /pulls/:id/review` (here: only `reviews.it.test.ts`, 3
  `buildApp()` call sites) reach for a REAL network call through whatever
  concrete adapter the port defaults to — `LocalSecretsProvider` reads the
  developer's real `~/.devdigest/secrets.json`, and since a real
  `OPENROUTER_API_KEY` is commonly configured there on a dev machine already
  used for manual verification (confirmed present on this machine), the
  integration suite would make real, billed OpenRouter requests with no test
  asserting on it — and `curl https://openrouter.ai` confirmed real egress is
  reachable from this environment, so it's not merely theoretical. Fixed by
  adding `intentDeriver: new MockIntentDeriver(undefined)` alongside the
  existing `embedder`/`git`/`llm` overrides at each of the 3 sites. Any
  future port added to a background/automatic call path (not just a route
  handler reachable only via an explicit new test) needs the SAME audit of
  pre-existing integration tests that already reach that code path, not just
  hermeticity for new tests written against the port itself.
  (`server/test/reviews.it.test.ts` — 3 `overrides` blocks,
  `server/src/modules/reviews/run-executor.ts` — `executeRuns()`'s
  `container.intentDeriver.derive()` call before the per-agent loop)

- 2026-08-09 — The `FEATURE_MODELS` non-cheap-default bug (2026-08-07 entry
  above, for `'conventions'`) also existed for `'review_intent'`
  (`openai`/`gpt-4.1`) until the Intent Layer feature actually wired a real
  producer to that slot. Confirms the general warning holds for every
  currently-unwired `FeatureModelId` slot — `risk_brief` and `conformance`
  still default to `openai`/`gpt-4.1` too and haven't been checked against
  their own future feature's cost requirement yet; don't assume either is
  "already correct" just because it hasn't been flagged. Fixed to
  `openrouter`/`deepseek/deepseek-v4-flash` in both vendor copies.
  (`server/src/vendor/shared/contracts/platform.ts:52-57`)

- 2026-08-09 — `pnpm db:generate` also handled a pure-addition diff spanning
  TWO tables (4 new columns total) plus a NEW `CHECK` constraint
  (`pr_intent_confidence_range`) in the same migration cleanly, with no
  interactive prompt — extends the 2026-08-07 addendum (which only confirmed
  a single-column, single-table case) to confirm a multi-table/multi-column/
  CHECK-constraint addition is equally safe, as long as nothing is
  dropped/renamed in the same diff.
  (`server/src/db/migrations/0017_simple_violations.sql`)

## Tool & Library Notes

- 2026-08-13 — `server/src/adapters/llm/openai.ts:15` and `anthropic.ts:16`'s
  `DEFAULT_TIMEOUT` (was 60_000, even shorter than OpenRouter's) bumped to
  300_000 alongside the same fix in `reviewer-core/src/llm/openrouter.ts` —
  see that package's `INSIGHTS.md` (2026-08-13 entry) for the full,
  live-reproduced root cause (a free-tier `review_intent` FeatureModel +
  the per-attempt abort applying even across retries). Not independently
  reproduced against these two direct, non-OpenRouter adapters this
  session — bumped preemptively for consistency; same failure shape is
  plausible but unconfirmed here.

- 2026-08-09 — `test/skills.test.ts`'s shared `makeFakeDb` chain (queue-based
  fake `Db`) had no `innerJoin`/`leftJoin`/`groupBy` no-op methods before
  `SkillsRepository.getStats` — every prior `SkillsRepository` query was a
  plain `select().from().where()`. Any new join-based repository method unit
  -tested through this fake needs those three added to the chain object
  (they're no-ops; the fake resolves purely from the queued-result array
  order, not real SQL), or `.innerJoin is not a function` fails immediately.
  (`server/test/skills.test.ts:makeFakeDb` chain object)

- 2026-08-09 — `DepCruiseGraph.buildEdges`
  (`server/src/adapters/depgraph/index.ts`) silently returns ZERO edges for
  any fixture rooted under `os.tmpdir()` on macOS. `/tmp` and `/var` are
  themselves symlinks to `/private/tmp`/`/private/var` on macOS;
  dependency-cruiser's resolver canonicalizes (realpaths) a dependency's
  RESOLVED path but not the ENTRY file paths passed into `cruise()`, so
  `toRel(root, dep.resolved)` produces a long `../../private/...` escape
  that never matches `fileSet`, and every edge is dropped as "not a local
  file" — with no error surfaced (the adapter's own try/catch is built to
  degrade silently on a broken tsconfig, which hides this failure mode
  too). No existing test caught this because nothing exercised the real
  `DepCruiseGraph` against a real on-disk fixture before —
  `depgraph-go.test.ts` only covers `GoDepGraph` (its own resolver,
  unaffected), `indexer-pipeline.test.ts`'s stub replaces `depgraph`
  entirely. Confirmed via a standalone repro (`cruise()` called directly
  against a `/tmp`-rooted fixture — `source` stayed `/tmp/...`, `resolved`
  came back `/private/tmp/...`). **Not fixed** (out of scope for the
  session that found it) — a real correctness gap worth its own follow-up.
  Any new test needing a real, ranked TS fixture should seed
  `file_rank`/`file_edges` rows directly instead of depending on
  `runFullIndex` + dependency-cruiser on macOS.
  (`server/src/adapters/depgraph/index.ts`,
  `server/test/repo-intel-sample.it.test.ts`)

- 2026-08-09 — Addendum to the 2026-08-07 `drizzle-kit generate` entry
  below: a single-column, add-only schema diff (migration `0015`,
  `conventions.language`) generated cleanly with NO interactive prompt —
  the prompt only triggers when a diff has both an addition AND a
  removal/rename to disambiguate in the same table. Safe to run
  `pnpm db:generate` normally for a pure `ADD COLUMN`; only fall back to
  hand-writing the migration+snapshot when the diff also drops/renames a
  column. (`server/src/db/migrations/0015_wandering_jackpot.sql`)

- 2026-08-06 — `adm-zip@0.6.0`'s own `entry.getData()` ALREADY caps
  decompression output via `zlib.inflateRawSync(compressed, {
  maxOutputLength: <entry's own declared header.size> })` — verified
  directly by calling its internal `Inflater` (`node_modules/adm-zip/methods/inflater.js`)
  with a mismatched declared-vs-actual payload: it throws a `RangeError`
  rather than fully materializing an oversized buffer. This is that
  version's fix for a real CVE (referenced in its own source as
  CVE-2026-39244) — so "adm-zip lets a lying zip header cause a
  decompression bomb" is a STALE assumption for this pinned version; the
  actual residual bug was narrower: the RangeError wasn't caught anywhere in
  `readZipEntries`, so a size-mismatched entry surfaced as an uncaught
  exception → generic 500, not a clean `ValidationError` (422). Rewrote to
  decompress via `entry.getCompressedData()` + our own
  `zlib.inflateRawSync(compressed, { maxOutputLength: remaining })` against
  a shared cross-entry budget (not the entry's own declared/attacker-
  controlled size) — makes the safety property independent of adm-zip's
  internal implementation, adds proper CRC-32 verification via Node's
  built-in `zlib.crc32()` (Node ≥22, no dependency needed), and converts the
  failure into a clean `ValidationError`. Verified against a HAND-CRAFTED
  zip with a patched declared-size header (both local + central-directory
  4-byte LE fields overwritten post-hoc, matching how a real attacker would
  do it) — see `test/skills.test.ts`'s `patchDeclaredSize` helper. Before
  "fixing" a reviewer-flagged vulnerability in a vendored dependency, verify
  it's still reproducible against the ACTUAL installed version — reading 2-3
  levels into `node_modules` source directly settled this in minutes.
  (`server/src/modules/skills/service.ts` — `readZipEntries`)

- 2026-08-06 — Node's GLOBAL `fetch()` (built on Node's own internal, bundled
  undici) rejects a `dispatcher` built from the userland `undici` NPM
  package — fails at runtime with `InvalidArgumentError: invalid onError
  method`, not a type error, so it only surfaces when actually called.
  Verified directly: an `Agent` from `import { Agent } from 'undici'` works
  fine as a `dispatcher` for `undici`'s OWN `fetch` (`import { fetch } from
  'undici'`), but throws when passed to `globalThis.fetch`. To pin a
  connection's DNS resolution (e.g. for an SSRF DNS-rebinding fix), import
  BOTH `fetch` and `Agent` from `undici` together — never mix Node's global
  fetch with an externally-constructed `undici` `Agent`.
  (`server/src/adapters/url-fetcher/http.ts:1,116-140` — `undiciFetch`)

- 2026-08-06 — A custom `lookup` function passed via `undici`'s `Agent({
  connect: { lookup } })` (or Node's `net.connect`/`tls.connect` `lookup`
  option generally) gets invoked with TWO different callback contracts
  depending on `options.all`: the classic `dns.lookup` single-address form
  `(err, address, family)` when `options.all` is falsy, but an ARRAY form
  `(err, [{address, family}])` when `options.all` is true — which recent
  Node versions request by default (Happy Eyeballs / `autoSelectFamily`).
  Implementing only the single-address form fails with `ERR_INVALID_IP_ADDRESS:
  Invalid IP address: undefined` even though the lookup function itself was
  called correctly — verified by direct reproduction before shipping the
  fix. A custom `lookup` must branch on `options?.all` and support both
  shapes. (`server/src/adapters/url-fetcher/http.ts:129-134`)

- 2026-08-06 — `@fastify/multipart`'s `limits` object has 7 independent
  fields (`fieldNameSize`, `fieldSize`, `fields`, `fileSize`, `files`,
  `headerPairs`, `parts`) — setting only `fileSize`/`files` (the two that
  bound the actual uploaded file) leaves `fields`/`parts` at effectively
  Infinity, letting a client flood a file-upload-only route with unbounded
  non-file form parts before `request.file()` ever gets a chance to reject
  anything. For a route that only ever expects ONE file and ZERO other
  fields (`/skills/import/file/preview`), the tightest correct config sets
  `fields: 0` outright, not just a large-but-finite number.
  (`server/src/modules/skills/routes.ts:75-90`)

- 2026-08-06 — `@fastify/multipart`'s `limits.fileSize` truncates the upload
  stream SILENTLY by default when exceeded — `throwFileSizeLimit: true` is
  required to make it throw a (413) `RequestFileTooLargeError` instead. Without
  it, `data.toBuffer()` returns a buffer whose length is capped at (never
  exceeds) the configured limit, so any downstream `buffer.length >
  MAX_ARCHIVE_BYTES` guard can never fire for an actually-oversized upload —
  it silently accepts a truncated/corrupted file instead of rejecting it.
  (`server/src/modules/skills/routes.ts:70-73`)

- 2026-08-04 — `server/pnpm-workspace.yaml` is pnpm's own `allowBuilds`
  build-script-approval file, not a stray tooling artifact (previously
  assumed so and excluded from commits — it's real and meant to be
  committed). `pnpm add <pkg-with-a-postinstall>` auto-appends a placeholder
  line here; `pnpm install`/`pnpm typecheck` hard-fail until it's resolved
  to `true`/`false`. This is where to approve a new native/build-script dep.
  (`server/pnpm-workspace.yaml:2`)

- 2026-08-07 — `drizzle-kit generate` (`server/drizzle.config.ts`) prompts
  interactively ("is column X created or renamed from Y?") whenever a single
  schema-diff both adds and drops columns on the same table — piping
  keystrokes via `printf | script -q /dev/null pnpm db:generate` did NOT
  reliably answer it (the process hung and had to be killed). Reliable
  alternative used for migration `0014_add_convention_fields.sql`:
  hand-write the SQL (mirroring the existing migration's `ALTER TABLE`
  style) + hand-derive the new `meta/NNNN_snapshot.json` from the previous
  snapshot (a small Python script copying `tables['public.<table>'].columns`
  and swapping in the new/removed ones, then a fresh random `id` +
  `prevId` = old `id`) + append one entry to `meta/_journal.json`. Verified
  correct by re-running `pnpm db:generate` afterward — it reported "No
  schema changes, nothing to migrate", confirming the hand-written snapshot
  exactly matches the Drizzle schema file.
  (`server/src/db/migrations/0014_add_convention_fields.sql`,
  `server/src/db/migrations/meta/0014_snapshot.json`)

- 2026-08-07 — The SSRF blocklist in `isDisallowedIPv4`
  (`url-fetcher/http.ts`) covered RFC1918 (10/8, 172.16/12, 192.168/16),
  loopback, link-local/169.254.169.254 (AWS/GCP/Azure metadata), and
  unspecified — but NOT RFC 6598 `100.64.0.0/10` (Carrier-Grade NAT), which
  is where Alibaba Cloud's ECS metadata endpoint (`100.100.100.200`) lives.
  Found by `pr-self-review`'s `security` skill on a THIRD review pass of
  this same file — the first two passes (checking IPv4-mapped-IPv6 bypass
  and DNS-rebinding TOCTOU) didn't happen to probe this specific range.
  Cloud-metadata SSRF blocklists need one range per cloud provider's own
  metadata-service addressing scheme, not just the two most common ones
  (169.254.169.254 covers AWS/GCP/Azure/DigitalOcean/most others, but not
  Alibaba Cloud) — worth an explicit checklist next time rather than
  re-deriving it from memory.
  (`server/src/adapters/url-fetcher/http.ts:16`)

- 2026-08-07 — Same file, FOURTH consecutive `pr-self-review` `security`
  pass finding a new gap in `isDisallowedTarget`/`isDisallowedIPv4`: the
  IPv6 branch never checked `::` (the "unspecified" address, IPv6's
  analog of `0.0.0.0` — the IPv4 form was already blocked, at line 17,
  specifically BECAUSE of the "0.0.0.0 Day" OS-level bypass class, but the
  IPv6 twin was missed). A clean way to have caught this earlier: for
  every IPv4 check in `isDisallowedIPv4`, ask "does IPv6 have a direct
  analog of this?" as a checklist item, rather than reviewing the IPv6
  branch's completeness independently. Separately (WARNING, not fixed the
  same way): `ipv4MappedAddress` deliberately does NOT match the
  deprecated `::a.b.c.d` (no `ffff`) IPv4-COMPATIBLE form when it appears
  in `::<hex>:<hex>` compressed form — verified `net.isIP('::1:2')` is a
  perfectly ordinary, valid IPv6 address bit-for-bit identical in shape to
  a deprecated-form embedded IPv4 address, so blocking that shape
  categorically would false-positive on real IPv6 hosts. Confirmed low
  real-world exploitability too (modern kernels don't specially route the
  deprecated form). Sometimes the correct fix for a WARNING is "add a test
  proving why NOT fixing it further is the right call," not more code.
  (`server/src/adapters/url-fetcher/http.ts:27-43,52-59`; test:
  `url-fetcher.test.ts` — "an ordinary compressed IPv6 address... is NOT a
  false-positive")

## Recurring Errors & Fixes

- 2026-08-05 — `ReviewRunExecutor.runOneAgent()` (`run-executor.ts`) called
  `repo.markReviewed(pull.id, pull.headSha)` per-agent, right after that
  agent's own review persisted — meaning `deriveReviewStatus()`
  (`pulls/status.ts`) flips a PR to `reviewed` the instant the FIRST of N
  requested agents finishes a "Run all" batch, while the other N-1 are still
  `status: 'running'`. Observed live: 1 of 3 agents done, PR list showing
  "Reviewed" with 2 agents visibly still running in the timeline. Fix:
  moved the `markReviewed` call out of `runOneAgent` and into
  `executeRuns()`, called once after its `for` loop settles ALL jobs (gated
  on `anySucceeded`, so a fully-failed batch still doesn't mark reviewed).
  Zero behavior change for the single-agent case (batch of 1 settles at the
  same moment either way). Regression test: `test/reviews.it.test.ts` — "PR
  status does not flip to 'reviewed' until every agent in the batch has
  settled" (uses a `ControllableMockLLM` that blocks one agent on a gate the
  test releases manually, to deterministically observe mid-batch state
  without racing real async completion order).
  (`src/modules/reviews/run-executor.ts:106-149`)

- 2026-08-05 — `pulls/routes.ts`'s SCORE column had the SAME "pick the
  literal latest row" bug already fixed for FINDINGS/COST that same day
  (see the entry above and `docs/findings-by-severity-plan.md`'s two
  correction addenda) — reported live only after the first two fixes
  shipped, from a real PR where 3 agents scored 6/52/100 and the list
  showed "100" (whichever agent finished last). Confirms this class of bug
  ("pick literally the newest row" for a per-PR aggregate) is easy to
  reintroduce piecemeal — SCORE was deliberately left alone during the
  first pass with the reasoning "not meaningfully summable," which was
  true (sum/average would be wrong) but missed that MIN is the right
  aggregate for a worst-case gate value, same as everywhere else in this
  app that already keys off `blockers` rather than an average. Worth
  auditing for a 4th instance rather than assuming these three were the
  only per-PR "latest row" reads.
  (`src/modules/pulls/routes.ts` — `latestReviewScoreByPr`/
  `latestReviewScoresByPr`)

- 2026-08-05 — `JobRunner.enqueue()` (`src/platform/jobs.ts`) returned a
  `done` promise that rejects when the job handler ultimately fails (after
  `withRetry` exhausts retries) — but every real caller
  (`RepoService.add`/`refresh`, `runCloneJob`'s index follow-up) only
  `await`s `enqueue()` itself and never touches `done`. Confirmed via
  `grep -rn "\.done\b" src/` returning zero hits outside `jobs.ts` itself.
  Result: a real `git clone` failure (e.g. a seeded demo repo like
  `acme/payments-api` that doesn't exist on GitHub — 404 on both the PR-list
  API call *and* the clone) became a genuine unhandled promise rejection
  with no listener anywhere in `src/` (no `process.on('unhandledRejection', ...)`
  either — only SIGTERM/SIGINT in `server.ts`), and Node's default behavior
  is to crash the whole process. This killed the entire server for every
  workspace/repo, not just the one bad clone, whenever a user hit "Refresh"
  on a repo whose remote is unreachable/nonexistent. The DB-side failure
  recording (`jobs.status = 'failed'` + `error` message) was already
  correct — the bug was purely the unhandled rejection layer above it. Fix:
  `done.catch(() => {})` right after `queue.add()`, before returning
  `{ id, done }` — marks the promise handled (satisfies Node's
  unhandledRejection check) while leaving `done` itself unchanged for any
  future caller that does want to `await`/`.catch()` it. Regression test:
  `test/jobs.test.ts` — asserts `process.on('unhandledRejection', ...)`
  never fires for a failing fire-and-forget job (fails without the fix,
  verified by temporarily reverting it), plus a second test proving `done`
  still rejects for a caller that does await it.
  (`src/platform/jobs.ts:98-108`)

- 2026-08-04 — `getUnresolvedReferences`'s (`service.ts`) phantom-API gate
  filtered `parseInvocationHeads` output through a single, JS/TS-only
  `PHANTOM_GLOBALS_ALLOWLIST` — a leftover from before Go existed in this
  codebase. Since Phase 1 wired `parseInvocationHeads` for Go too (bare
  calls only, same precision rule as TS/JS), every ordinary Go builtin
  call (`len`, `make`, `append`, `println`, ...) was an `identifier`-kind
  bare call indistinguishable from a real phantom — none were in the
  TS-only list, so every Go file would have them flagged as phantom APIs.
  Found via a post-completion Phase 6 audit, not during implementation —
  `getUnresolvedReferences` had zero positive-path tests for either
  language before this. Fix: split into
  `PHANTOM_GLOBALS_BY_LANGUAGE` (keyed by `languageIdForFile`), added Go's
  predeclared functions + builtin-type conversion names. Generalizable
  lesson (folded into the `add-language-support` skill): a per-language
  dispatcher being correct says nothing about a consumer one layer above
  it that has its own hardcoded single-language assumption — grep every
  consumer of the 4 astgrep functions, not just the dispatcher itself.
  (`server/src/modules/repo-intel/service.ts` —
  `PHANTOM_GLOBALS_BY_LANGUAGE`; test:
  `server/test/repo-intel-phantom-gate.test.ts`)

- 2026-08-04 — tree-sitter-Go's `pointer_type` node (`*Foo`) has TWO
  children in order `['*', 'type_identifier']` — taking `children()[0]` to
  "unwrap the pointer" silently grabs the `*` token, not the type. No
  crash, no type error: a Go method's receiver-type resolution just always
  returned `null`, so the `Receiver.Method` dual-emit convention (mirrored
  from the TS/JS class-method pattern) quietly degraded to bare-name-only
  until checked against a real parse, not just the grammar's field list.
  Fix: filter children by `kind() === 'type_identifier'`, never assume
  position. (`server/src/adapters/astgrep/langs/go.ts:67-72`)

- 2026-08-04 — A literal NUL byte (0x00) was found embedded mid-template-
  literal in `depgraph/index.ts` (sitting where a space should be, between
  two `${}` interpolations) — pre-existing, unrelated to any session's
  edits. It silently broke exact-string-match `Edit` calls against that
  line (the text looked like a normal space in `Read` output). Diagnosed
  with `sed -n '<n>p' file | od -c` after repeated no-visible-cause
  replace failures; fixed by rewriting the file's bytes directly (Python,
  `bytes.replace(b'\x00', b' ')`) rather than another string-based edit.
  Worth trying `od -c` early if an `Edit` inexplicably can't find text that
  `Read` clearly shows.

- 2026-08-06 — `agents/repository.ts`'s `insert()`/`update()` were still
  using the OLD unsafe pattern (JS-computed `existing.version + 1`, no
  transaction wrapping the row write + `agent_versions` snapshot) on the
  same day `skills/repository.ts`'s equivalent methods were already fixed to
  the atomic-`sql`-increment-in-a-transaction pattern in the SAME PR —
  `skills/repository.ts`'s own docstring even says the fix "mirror[s] the
  same fix in `agents/repository.ts`'s `bumpVersionAfterSkillChange`," but
  nobody had actually mirrored it back into `insert()`/`update()` there.
  `bumpVersionAfterSkillChange` (a THIRD write path in the same file, for
  skill-link changes) already had the atomic/transactional fix. Lesson: when
  fixing a race/consistency bug in one repository file, `grep` sibling
  repository files (and OTHER write paths in the SAME file) for the same
  shape before considering the fix complete — a correct pattern existing
  once in a file is not evidence every write path in that file uses it.
  (`server/src/modules/agents/repository.ts:86-172` vs
  `server/src/modules/skills/repository.ts:79-148`)

## Open Questions

- 2026-08-06 — `z.coerce.boolean()` on a query param (`?enabled=false` being
  read as `true` — any non-empty string coerces truthy) was found and fixed
  in exactly one place (`server/src/modules/skills/routes.ts:39-46`, now
  `z.enum(['true','false']).transform(...)`). Not audited: whether the same
  `z.coerce.boolean()` footgun exists on any OTHER boolean query/body field
  elsewhere in `src/modules/**/routes.ts` — worth a repo-wide grep for
  `z.coerce.boolean()` before assuming this was the only instance.

- 2026-07-27 — No sync/codegen step keeps `src/vendor/shared` in step with
  the client's copy — is a checked-in diff script or a build-time copy step
  worth adding, or does the course intentionally keep this manual?

## Session Notes

- 2026-08-04 — `engineering-insights` did not auto-invoke during the whole
  `feat/review-cost` session (a multi-file feature with real findings — see
  above) despite matching its own "end of a non-trivial coding session"
  trigger in its `SKILL.md` description. It only ran because the user
  explicitly asked whether it had fired. Confirms the skill's own
  "Course arc" note in `references.md`: a description/manual trigger alone
  is not reliable enough without a `Stop` hook forcing it.

- 2026-08-04 — Go language support (Phase 0+1+2 of
  `docs/go-language-support-plan.md`) landed on `docs/go-language-support-plan`
  (PR #3, fork). Verified end-to-end against real Go source (not just unit
  fixtures) before writing formal tests — caught the pointer-receiver bug
  above that way. Phase 3 (import graph without `dependency-cruiser`),
  Phase 4 (de-hardcode system prompts), Phase 5 (`languages[]` DB column)
  remain deferred.

- 2026-08-04 — Phase 3 (Go import graph) also landed same branch/PR:
  `GoDepGraph` resolves local imports via `go.mod`'s `module` directive +
  the Phase 1 `parseImports` output, fanning an edge out to every file in
  the imported package's directory (Go resolves at package granularity,
  not file granularity — picking a single representative file would have
  undercounted a package's PageRank fan-in). Phase 4/5 still deferred.

- 2026-08-04 — Phase 4 (de-hardcode system prompts) also landed same
  branch/PR: rewrote `GENERAL_REVIEWER_PROMPT`/`PERFORMANCE_REVIEWER_PROMPT`
  neutral (matching `SECURITY_REVIEWER_PROMPT`'s existing style) and added
  `buildStackFraming()` to inject per-diff language framing at review-run
  time instead — kept out of `reviewer-core` entirely (it has no
  `language` concept anywhere in its types) by folding the framing into
  the plain `systemPrompt` string server-side, before the
  `reviewPullRequest()` call. Phase 5 (`languages[]` DB column) is the
  only phase still deferred.

- 2026-08-04 — Phase 5 (repo language detection) also landed same
  branch/PR, closing out all 6 phases of `docs/go-language-support-plan.md`.
  `repo_index_state.languages` is derived from the actually-walked/indexed
  file set (`languagesPresent()` over `walk.files`/`allFiles`) rather than
  `go.mod`/`package.json` marker files as the plan originally sketched —
  more accurate for "what did we actually index" and free (both pipelines
  already compute that file list for other T3 steps). No downstream
  consumer reads this column yet — confirmed via a repo-wide grep before
  implementing, so it's genuinely informational/future-use, not dead code
  masquerading as used.

- 2026-08-04 — User asked to double-check Phase 6 after all 6 phases were
  marked done. Re-reading the phase's literal scope against what was
  actually tested (not just re-reading the "done" summary) surfaced a real
  bug — the phantom-globals allowlist gap above — that every phase's own
  "Tests:" note had missed, because `parseInvocationHeads` was implemented
  and dispatcher-wired in Phase 1 but its only real consumer
  (`getUnresolvedReferences`) was never exercised end-to-end for either
  language. Distilled into the `add-language-support` skill (new example
  + a workflow step) so the next language checks this before declaring
  Phase 6 complete, not after. Also created the skill itself this session
  (`.claude/skills/add-language-support/`), the first non-course-provided
  project skill authored from this repo's own findings.

- 2026-08-09 — Implemented Phase 7 of `docs/go-language-support-plan.md`
  (Conventions Extractor multi-language support, all 5 sub-phases 7.1-7.5)
  on `feat/conventions-multilang`, following up a separate plan-only PR
  (#12, `docs/conventions-extractor-multilang-plan`) that did the
  root-cause analysis first. Same "verify empirically, don't trust the
  analysis as written" discipline as the original Go implementation: 7.3's
  empirical checks (real DB, real `repoIntel`, not `conventions.it.test.ts`'s
  `FakeRepoIntel`) confirmed one predicted gap was real (`_test.go` leaking
  into samples) and one predicted risk was NOT a bug (the model pool already
  worked on Go) — both findings changed the actual scope of 7.2/7.5 versus
  what the plan alone would have suggested. Two genuine architecture/
  dependency decisions (gofmt handling, YAML dependency choice) were
  resolved via `AskUserQuestion` mid-session rather than picked
  unilaterally, per the plan's own "Open Questions" flagging them as
  undecided. Full suite (server 281 unit + 62 integration, client 121)
  green at every phase boundary, each phase committed separately.
