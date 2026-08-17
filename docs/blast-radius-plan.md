# Blast Radius

**Status:** in progress — server route, mcp-server tool, and client UI implemented and typechecked; existing test suites pass unchanged (client 180, server 333); `GET /pulls/:id/blast` verified live against real indexed data. Not yet verified visually in a browser (Claude-in-Chrome extension unavailable this session) — see Verification section.

**Layout correction (post-implementation):** the original text spec said "add a Blast tab," but the reference mockup image places Blast Radius as a compact summary **panel on the Overview tab**, not a standalone tab. Client UI was corrected to both: `BlastRadiusCard` on Overview, linking to the full `BlastTab` (every symbol, expandable, clickable callers, plus a Tree/Graph toggle — `BlastGraphView.tsx`, a dependency-free two-column SVG bipartite graph) — kept rather than deleted since the interactive tree still needs a home and the text spec explicitly asked for it too.

**Second mockup pass (colors + card content):** `BlastRadiusCard` originally showed the top-2 symbols as flat one-line rows; corrected to show only the single most-impacted symbol, fully expanded (its callers, capped at 4 with a "+N more" tail, and its endpoint/cron chips, capped at 6 combined) — matching the mockup's `rateLimit()` example rather than a bare name+count list. Endpoint/cron chips (in both `BlastTab` and `BlastRadiusCard`) were plain-gray; recolored to the mockup's blue/amber using this app's existing semantic tokens (`--accent`/`--accent-bg` for endpoints, `--warn`/`--warn-bg` for crons — same tokens `IntentCard`'s evidence/risk badges already use), including the top-of-tab endpoint/cron count badges for consistency.

**Repo-intel fixes found during live verification (in scope after all — root causes of "0 callers everywhere"):**
1. **Const-export extraction gap** (`astgrep/langs/typescript.ts` + `langs/go.ts`): a top-level `export const COLLIDERS = {...}` (or any non-function-literal `const`/`let`/`var`) was silently skipped by the symbol extractor — invisible to reference resolution. Fixed: now indexed as a `'const'`-kind symbol (module-scope only, confirmed safe — `parseSymbols` never recurses into function bodies). `INDEXER_VERSION` bumped 2→3 so every already-indexed repo gets a forced full reindex to pick this up.
2. **Global vs. per-symbol caller cap** (`repo-intel/service.ts`'s `tryPersistentBlast`): `MAX_CALLERS_PER_SYMBOL` was applied to the PR's *entire* flattened caller list, not per changed symbol as the constant's own name/doc claimed — so a PR touching many symbols could have one or two high-rank symbols exhaust the whole 20-caller budget, leaving every other symbol showing 0 callers even with real ones. Fixed to cap per `viaSymbol`; regression-locked by `test/repo-intel-blast-cap.test.ts`.
3. **Not fixed, flagged only**: reference-tracking (`parseReferences`) only captures call/`new`/JSX usage sites, not plain identifier reads of a const's value (e.g. `COLLIDERS.wall`) — so a const that's only ever read, never called, still won't show a caller even after fix #1. Out of scope for this pass; a real import-based reference model would be needed.

**React key collision (client bug, found via a console warning):** `BlastRadiusResponse.downstream`/`changed_symbols` key by bare symbol *name*, not (file, name) — two different changed files can legitimately declare a same-named symbol (confirmed live: `renderWithIntl`, a local test helper, declared identically in both `FindingCard.test.tsx` and `VerdictBanner.test.tsx`), producing two distinct `downstream` entries with the same `symbol` string. `BlastTab`'s `SymbolRow` list and `BlastGraphView`'s symbol nodes/edges were keyed by `impact.symbol` alone — fixed to `${symbol}-${index}`. Verified live that both entries' `callers` were independently `[]` (no visible cross-symbol data corruption in this case), but the underlying repo-intel caller-attribution query only filters by symbol *name* (`getResolvedCallers`'s `toSymbol` match), not the specific declaring file — so if two same-named symbols in different changed files **both** had real external callers, a caller could theoretically be misattributed to the wrong one. Flagged, not fixed — would need `declFile` threaded through `ResolvedCallerRow`/`BlastCallerRow`.

**"View in Diff" jumped to the wrong place, round 1 (files outside the diff):** verified live that ~60% of a PR's blast-radius callers are files the PR never touched (e.g. `server/src/platform/container.ts` calling a changed symbol without itself being in the diff) — `DiffViewer`/`SmartDiffViewer` only render `pr.files`, so scrolling to a file outside that set has nothing to match and lands somewhere arbitrary. Fixed in `page.tsx` with a new `handleCallerClick(file, line)`.

**"View in Diff" jumped to the wrong place, round 2 (wrong LINE even inside the diff):** reported after round 1 shipped — still wrong for files that ARE in the diff. Root cause: `container.repoIntel.getBlastRadius`'s `callers[].line` numbers come from whatever commit was last (re)indexed (`repo_index_state.last_indexed_sha`, typically the default branch's current tip), not from the specific PR's own frozen `head_sha` — for a merged/older PR where the file was edited again afterward, the two line-numbering systems diverge even though the file is technically "in the diff". Fixed properly: `BlastRadiusResponse` gained an `indexed_sha` field (`BlastService` now also calls `getIndexState`); `page.tsx`'s `handleCallerClick` only allows the in-app "View in Diff" jump when `indexed_sha === pr.head_sha` (the *exact* same commit the diff itself renders) — otherwise, regardless of diff membership, it opens a GitHub blob link (`lib/github-urls.ts`'s `githubBlobUrl`) pinned to `indexed_sha`, where the line number is guaranteed correct. `BlastTab`/`BlastRadiusCard`/`OverviewTab`'s `prFilePaths` prop now carries "files where an in-app jump is actually valid" (already snapshot-gated), not raw diff membership.

**Indicator + color (user-requested polish):** caller rows show a `Github` icon (added to `vendor/ui/icons.tsx`) colored `var(--ok)` (green) for links that open on GitHub, vs. the existing corner-arrow icon for genuine in-app jumps — so it's clear before clicking which will happen.

**Session gotcha (not a code bug):** the locally running `server/` process during this session's live testing was a plain `tsx src/server.ts`, not `tsx watch` — it silently kept serving stale code (missing `indexed_sha` entirely) through several rounds of edits with no restart. Anyone testing server-side changes locally should confirm their dev process is actually in watch mode (`pnpm dev`, per `server/README.md`), not just check that *a* process is listening on :3001.

## Context

The goal: a "Blast Radius" view on a PR — which symbols the diff changed, who
calls them, and which HTTP endpoints/cron jobs are reachable from those
callers — answering "what else could this diff touch?" beyond the changed
lines themselves. Spec (user-provided): new server route
`GET /pulls/:id/blast`, a `blast/` server module, a `get_blast_radius` MCP
tool wired to it, and a new "Blast" tab on the PR page with an expandable
symbol → callers → endpoints tree, deterministic (no LLM on the hot path,
one optional LLM summary call at most).

**Key finding from research (changes the scope significantly): the hard
algorithmic work already exists.** `server/src/modules/repo-intel/service.ts:252-336`'s
`getBlastRadius(repoId, changedFiles)` is a **complete, already-shipped**
facade method:

- Persistent path (`tryPersistentBlast`, `service.ts:347-`) reads
  `symbols`/`references`/`file_rank`/`file_facts` straight from Postgres —
  **no AST/import-graph rebuild on the request path**, satisfying that
  acceptance criterion for free.
- Callers are resolved via an indexed join
  (`references(repoId, declFile, toSymbol)` → `symbols` → `file_rank`,
  `repository.ts:506-535`) — already **precise** (only resolved
  `decl_file` references count) and already **sorted by rank descending**
  (`service.ts:404`).
- `factsByFile` (`types.ts:82-86`) already carries **both** `endpoints` and
  **`crons`** per caller file — the mockup's "reset-rate-buckets (hourly)"
  chip is already computable, not new work.
- Degraded/partial states are already first-class: `BlastResult.degraded?`
  + `reason?: DegradedReason` (`types.ts:87-88`), with an explicit
  ripgrep-based fallback path (`getBlastRadius`'s non-persistent branch,
  `service.ts:260-336`) when the index isn't built yet.
- `server/src/modules/index.ts:23`'s own module-registry comment already
  anticipates this: *"Each course lesson adds its own module here (skills,
  intent/smart-diff, **blast**, brief/context/onboarding, …)"* — `blast/`
  as a standalone module is the intended shape, not a deviation.

So this feature is **mostly plumbing + UI**, not new analysis: an HTTP route
exposing an existing facade method, a response contract, an MCP tool wired to
that route, and a client tab to render it.

## Not yet present (the actual new work)

- No HTTP route anywhere exposes `getBlastRadius` — `repo-intel/routes.ts:32-65`
  only has `GET /repos/:id/index-state` and `POST /repos/:id/resync`.
  `getBlastRadius` is currently called in-process only, by
  `reviews/run-executor.ts`.
- No cap on callers-per-symbol (user's spec: "20 per symbol"). `callers` is
  a flat, rank-sorted array with a `viaSymbol` field — grouping + capping
  per symbol needs to happen at the route/response-shaping layer, not the
  facade (don't touch `service.ts`, which other callers already depend on
  as-is).
- No `@devdigest/shared` contract for the response DTO, no client hook, no
  UI tab, no MCP tool wiring.

## Plan

### 1. `server/src/modules/blast/` (new module)

- **`service.ts`** — thin `BlastService`, same shape as
  `smart-diff/service.ts`'s `SmartDiffService`: resolve `pull =
  container.reviewRepo.getPull(workspaceId, prId)` (404 via `NotFoundError`
  if missing, mirroring `SmartDiffService.getSmartDiff`), `files =
  container.reviewRepo.getPrFiles(prId)` (drop `status === 'removed'`
  paths), call `container.repoIntel.getBlastRadius(pull.repoId,
  changedPaths)`, then group `callers` by `viaSymbol`, cap each group at 20
  (already rank-sorted, so `.slice(0, 20)` per group is correct), and shape
  into the response contract below. **No new repo-intel/DB code.**
- **`routes.ts`** — `GET /pulls/:id/blast`, `{schema: {params: IdParams}}`,
  default rate limit (a read against already-persisted data, not an
  LLM-triggering route — no `config.rateLimit` override needed, unlike
  `POST /pulls/:id/review`'s `{max:10, timeWindow:'1 minute'}`).
  `getContext(container, req)` for workspace scoping first, same as every
  other route.
- Register in **`server/src/modules/index.ts`**: import + one entry
  (`blast`), same one-line pattern every other module follows.

### 2. `@devdigest/shared` contract (BOTH hand-copies)

- New **`server/src/vendor/shared/contracts/blast.ts`** (new file, sibling
  to `findings.ts`/`review-api.ts`) — zod schema for the response: changed
  symbols, callers grouped by symbol (capped 20, rank-sorted), impacted
  endpoints, impacted crons, `degraded`/`reason`.
- Hand-copy the identical file into **`client/src/vendor/shared/contracts/blast.ts`**
  — both copies edited together, per this repo's non-default convention
  (`server/INSIGHTS.md` already documents this pair drifting when only one
  side is edited).

### 3. `client/` — new "Blast" tab

- **`PrDetailHeader.tsx:115-130`** — add a 4th `Tabs` entry ("Blast",
  `?tab=blast`), alongside the existing Overview/Agent runs/Files changed.
- **`page.tsx:173-214`** — add the matching conditional render block for
  `tab === "blast"`.
- New hook **`client/src/lib/hooks/blast.ts`** — `usePrBlastRadius(prId)`,
  identical `useQuery` shape to `usePrReviews`/`usePrSmartDiff`
  (`lib/hooks/reviews.ts:52-58`, `lib/hooks/smart-diff.ts:11-17`):
  `queryKey: ["blast", prId]`, `queryFn: () => api.get(/pulls/${prId}/blast)`.
- New **`BlastTab`** component (sibling to `DiffTab.tsx`): a symbol list,
  each expandable to its capped callers list (plain `useState`-driven
  expand/collapse — this codebase has no tree library and doesn't need one,
  per `SmartDiffViewer`'s and `ReviewRunAccordion`'s existing pattern), plus
  endpoint/cron chips per the mockup.
- **File:line click → jump to Diff tab**: reuse the **existing** external
  scroll-target mechanism `SmartDiffViewer` already exposes for the Findings
  tab's "View in Diff" button (`SmartDiffViewer.tsx:181-192`'s odd/even
  nonce split from commit `9d598e0`, `ScrollTarget` type in
  `diff-viewer/helpers.ts:15-19`). A caller row's file:line click sets
  `?tab=diff` + an external `ScrollTarget` the same way Findings already
  does — **no new jump mechanism to build.**

### 4. `mcp-server/` — replace the permanent stub

- **`ports.ts`** — add `getBlastRadius(pullId: string): Promise<BlastRadiusResult>`
  to `DevDigestApiClient`, same one-method-per-use-case style as the other
  6 methods.
- **`http-client.ts`** — implement it as a `GET /pulls/:id/blast` call, zod
  response validation the same way every other method in this file already
  does (per `types.ts`'s "narrow local DTO, validated at the http-client.ts
  boundary" convention).
- **`types.ts`** — add the narrow `BlastRadiusResult`/`BlastCallerGroup`
  DTO (hand-copied, same DRIFT RISK treatment as `ConventionCategory`/
  `FindingSeverity` already get — cite the new contract file in the DRIFT
  RISK comment).
- **`tools/get-blast-radius.ts`** — replace the current `STUB_ERROR`
  handler with a real one: `parseRepo` (already shared in `resolve.ts`),
  `resolveRepo`/`resolvePull`, then `client.getBlastRadius(pullId)`, mapped
  to a concise MCP result (small enough it probably doesn't need
  `mappers.ts`'s shared helper — that one's specific to review results).
- **`mcp-server/AGENTS.md`** — dated correction to the "PERMANENT STUB"
  note (it's a repo-wide convention here: append a dated line, don't
  silently rewrite).

## Explicitly out of scope / deferred

- **Optional one-paragraph LLM summary** of the blast map — the spec marks
  this optional ("Опційно можна додати..."); build the deterministic path
  first, add the single LLM call (if at all) as a separate follow-up once
  the core tab is verified. Exactly one call if added, per the acceptance
  criteria — never more.
- **New route-to-file:line mapping** — `extractEndpoints` (`codeindex/extract.ts:182`)
  only returns `"METHOD /path"` strings today, no file:line for the route
  *handler* itself. The mockup's endpoint chips aren't shown as clickable
  file:line (only caller rows are), so this isn't needed for v1 — flag
  explicitly if the UI design later wants endpoint chips clickable too.
- Any change to `repo-intel/service.ts`'s `getBlastRadius`/`tryPersistentBlast`
  themselves — they're already correct and already have another consumer
  (`reviews/run-executor.ts`); this plan only adds a thin HTTP/MCP/UI layer
  on top.

## Verification

1. `server/`: `pnpm typecheck`, unit tests for `blast/service.ts`'s
   grouping/capping logic (fake `repoIntel`/`reviewRepo`, per
   `server/src/adapters/mocks.ts`'s existing pattern) — no DB needed for
   this since the facade itself is mocked.
2. Manual: pick a repo already indexed (`repo_index_state.status = 'full'`),
   open a PR that changes a shared helper with ≥2 real callers and ≥1 HTTP
   endpoint reachable from a caller file — confirm the response has both
   populated and `degraded` is absent/false. Confirm an unindexed repo's PR
   returns a clear `degraded: true, reason: ...` instead of an empty-looking
   `[]`.
3. `client/`: open the new Blast tab in the browser (`./scripts/dev.sh`),
   click a caller's file:line, confirm it switches to the Diff tab and
   scrolls to the right line (reusing the existing external-scroll-target
   path — this is the regression risk, since two features now share it).
4. `mcp-server/`: `npm run typecheck`; smoke-test `get_blast_radius` via
   `npx @modelcontextprotocol/inspector` against a real running stack,
   confirm it returns the same shape the UI shows, not the old stub error.
5. Full acceptance-criteria pass against the original spec's checklist
   (open PR + demo video, 2+ real callers on a demo PR, clickable file:line,
   no request-time AST rebuild, empty vs. degraded states distinct, no LLM
   on the core path).
