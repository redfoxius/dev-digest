# PR diff-loading self-heal + fail-loud guardrail

**Status:** implemented (2026-08-17) — all 8 Work Items landed on
`feat/mcp-server`. See `server/INSIGHTS.md`'s 2026-08-17 entries for
implementation findings. Not yet through `pr-self-review` (no PR opened for
this change yet).

## Context

PR #18 (redfoxius/dev-digest) was reviewed via the MCP `run_agent_on_pr` tool
without the PR ever being opened in the DevDigest studio UI first. The
resulting review silently reported `approve` / score 100 / 0 findings — a
false-clean verdict — because the diff-loading pipeline degraded to an empty
diff without anyone (human or LLM) being told the pipeline itself had failed.

**Root cause chain** (all file:line citations below re-verified against the
current tree on `feat/mcp-server` before writing this plan):

1. `server/src/modules/reviews/diff-loader.ts:19-28` (`loadDiff()`) tries
   `container.git.diff(base, headSha)` — a real `git diff` inside the local
   clone at `server/clones/<owner>/<repo>` — and falls back only on throw or
   on `diff.files.length === 0`.
2. For PR #18 the local clone only had `main`; `headSha` wasn't fetched, so
   `git diff` threw "unknown revision", falling through to the fallback.
3. `diffFromPrFiles()` (`diff-loader.ts:33-44`) reconstructs a diff from the
   `pr_files` table. That table is only (re)populated as a side effect of
   `GET /pulls/:id` (`server/src/modules/pulls/routes.ts:301-316`), which
   does a live GitHub refresh, delete, and reinsert — and silently no-ops
   (`routes.ts:342-343`, a `warn` log) if `container.github()` fails (e.g. no
   token). Since the review was launched via MCP, `GET /pulls/:id` was never
   hit, so `pr_files` was empty → `diffFromPrFiles()` returned `{files: []}`.
4. A fix already exists as dead code: `SimpleGitClient.fetchPullHead(repo, n)`
   (`server/src/adapters/git/simple-git.ts:72-75`, declared on the port at
   `server/src/vendor/shared/adapters.ts:219`) fetches `pull/<n>/head`
   directly into the local clone. It is called nowhere in `server/src`
   outside its own no-op test stub (`server/src/adapters/mocks.ts:271`).
5. **Correction to the originally-cited call site**: the actual place an
   empty diff gets handed straight to the LLM with no check is
   `server/src/modules/reviews/run-executor.ts:96-106` (`executeRuns()`'s
   pre-work step — `loadDiff()` → `runLog.info('Diff ready — 0 changed
   file(s)...')` → proceeds into the per-agent loop regardless), **not**
   `service.ts:226-231` as originally cited. That line range is actually
   `ReviewService.deriveIntent()` — a separate, secondary manual
   re-derivation endpoint (`POST /pulls/:id/intent/derive`) that also calls
   `loadDiff()` but is not the path that produced PR #18's false verdict.
   Both call sites share `loadDiff()`, so fixing it once fixes both, but the
   plan below targets `run-executor.ts` as the primary regression-test
   surface.

**Trade-off accepted by this plan** (per the agreed strategy, not up for
renegotiation here): once Layers 1+2 have both been attempted, *any*
remaining empty diff — including a PR that genuinely has zero changed files
— fails the run loudly rather than producing a trivial "clean" review. This
is intentional: the strategy explicitly prioritizes eliminating false-clean
verdicts over preserving the (rare, and already partially-broken-today)
"empty PR gets an instant clean review" convenience.

## Scope

- In scope:
  - `server/src/modules/reviews/diff-loader.ts` — Layers 1, 2, 3.
  - `server/src/modules/pulls/routes.ts` — extract the GitHub-refresh block
    into a reusable function, call it instead of inline logic (behavior
    preserved for the existing route).
  - New `server/src/modules/pulls/repository.ts` and
    `server/src/modules/pulls/service.ts`.
  - `server/src/platform/errors.ts` — new `DiffUnavailableError`.
  - `server/src/adapters/mocks.ts` — extend `MockGitClient` for test control
    over Layer 1/2 failure paths.
  - New/updated tests under `server/test/`.
- Out of scope (per the agreed strategy):
  - `mcp-server/` — it is the caller that exposed the bug, not the root
    cause. **No changes needed there anyway** — confirmed
    `mcp-server/src/tools/run-agent-on-pr.ts:111-117` already surfaces any
    `status:'failed'` run as `isError:true` with `row.error` as the message,
    so Layer 3 marking the run `'failed'` closes the loop for the MCP caller
    for free.
  - `reviewer-core/`'s LLM-prompting logic — untouched; `reviewPullRequest()`
    is simply never called when the guardrail trips.
  - Any new "reindex" UI/button — Layers 1 and 2 are silent, automatic,
    server-side self-heal steps inside the existing review flow, not a new
    user-facing feature.
  - Widening the `agent_runs.status` enum with a new value (`index_stale` /
    `no_diff`). Decision: reuse the existing `'failed'` status
    (`completeAgentRun`'s type union is `'done' | 'failed' | 'cancelled'` —
    `server/src/modules/reviews/repository.ts:201`,
    `server/src/modules/reviews/repository/run.repo.ts:165`) with a
    distinguishing `error` message, via the existing `failAll()` path in
    `run-executor.ts:75-94` — that path already renders on the client and
    over SSE with zero contract changes. Adding a new enum value would
    require touching both hand-synced `vendor/shared` copies
    (`server/src/vendor/shared/contracts/observability.ts:41` and its
    client twin) for a distinction the UI doesn't need to render specially.

## Modules Touched

- `server/src/modules/reviews/diff-loader.ts` — Layers 1-3 land here (single
  choke point; both call sites — `run-executor.ts:98` and `service.ts:226`
  — get the fix for free).
- `server/src/modules/pulls/repository.ts` (new), `server/src/modules/pulls/service.ts`
  (new), `server/src/modules/pulls/routes.ts` (edited) — Layer 2's reusable
  refresh capability.
- `server/src/platform/container.ts` — new `pullsSync` getter +
  `ContainerOverrides.pullsSync`, composition-root wiring for
  `PullsSyncService` (see Architectural Constraints).
- `server/src/platform/errors.ts` — new `DiffUnavailableError` class.
- `server/src/adapters/mocks.ts` — `MockGitClient` test seams.
- `server/test/diff-loader.test.ts` (new), `server/test/pulls.it.test.ts`
  (extended), `server/test/reviews.it.test.ts` (extended).

## Architectural Constraints

- **Onion architecture** (`server/AGENTS.md:22-23`; onion-architecture
  skill): `pulls/service.ts` must not import `drizzle-orm` — all DB access
  goes through the new `pulls/repository.ts`. `pulls/service.ts` may call
  `container.github()` (a port) directly, matching the existing pattern in
  `reviews/service.ts`/`run-executor.ts` calling `container.git`/
  `container.llm`.
- **Cross-module access goes through a container getter, not a direct
  import — corrected after architecture-reviewer feedback.** An earlier
  draft of this plan proposed `diff-loader.ts` doing
  `import { refreshPrFromGitHub } from '../pulls/service.js'` directly,
  justified by analogy to `run-executor.ts:3`'s
  `import { reviewPullRequest } from '@devdigest/reviewer-core'`. That
  analogy doesn't hold: `reviewer-core` is the Domain ring — a separate
  package the server depends on *inward* — whereas `pulls` is a sibling
  Application-ring module in the same `server/` package, so a direct import
  is a lateral, same-ring dependency that bypasses the composition root.
  `container.ts:143-149`'s `intentDeriver` getter is a direct in-repo
  precedent for exactly this shape (a cross-module orchestration capability
  composing a port + a private repo), and its own doc comment says it's
  "wired here so it stays swappable via `ContainerOverrides` in unit tests
  instead of being constructed inline in `run-executor.ts`/`reviews/service.ts`"
  — the plan's proposed `refreshPrFromGitHub` is that same shape. Confirming
  the inconsistency: this plan's own `pulls/routes.ts` already reaches into
  a sibling module correctly, via `container.reviewRepo.getLatestReviewBatchFindings(...)`
  (`pulls/routes.ts:287`), not a direct import.

  **Corrected design**: `pulls/service.ts` exports a `PullsSyncService`
  class (constructor takes the `Container`, mirroring
  `RepoIntelService`/`IntentDeriverService`) implementing a `PullsSync`
  port with one method, `refreshFromGitHub(repo: RepoRow, pull: PullRow):
  Promise<PrDetail>`. `container.ts` gets a new lazily-constructed
  `pullsSync` getter (same pattern as `repoIntel`/`intentDeriver`:
  `this.overrides.pullsSync ?? (this._pullsSync ??= new
  PullsSyncService(this))`) and `ContainerOverrides.pullsSync?: PullsSync`
  for test injection. `diff-loader.ts` and `pulls/routes.ts` both call
  `container.pullsSync.refreshFromGitHub(repo, pull)` — no direct
  cross-module import anywhere. `pulls/repository.ts` stays private to the
  `pulls` module; only `pulls/service.ts` imports it.
- **Composition root**: no new adapter is introduced (`fetchPullHead` and
  `github()` are both already-wired ports/methods on `Container`), so
  `platform/container.ts` needs no changes for this plan.
- `reviews/repository.ts:6-7`'s documented ownership ("the ONLY layer
  touching the DB for the review domain... reviews, findings, pr_intent,
  agent_runs, run_traces") is why Layer 2's `pr_files`/`pr_commits`/
  `pull_requests` writes belong in a new `pulls/repository.ts`, not bolted
  onto `reviews/repository/pull.repo.ts` (which today only *reads* those
  tables for the review flow, plus one write: `markReviewed`,
  `reviews/repository/pull.repo.ts:47-52`).
- `server/AGENTS.md:34`: `reviewer-core` is consumed as TS source, never
  built — not touched by this plan, so nothing to re-verify there.
- Route handlers stay thin (fastify-best-practices skill,
  onion-architecture skill's Module Anatomy): `GET /pulls/:id`
  (`pulls/routes.ts`) keeps its existing try/catch (swallow-on-failure,
  serve persisted data) around a single call to the new service function —
  no business logic added to the route itself, matching what's already
  there today minus the inlined DB/GitHub calls.

## Relevant INSIGHTS.md Gotchas

- `server/INSIGHTS.md:130` — an existing entry about `pr_files.path`
  path-segment matching; not directly touched by this change but confirms
  `pr_files` is actively read/matched elsewhere in the reviews module, so
  Layer 2's repopulation must keep writing the same shape
  (`path`/`additions`/`deletions`/`patch`) `diffFromPrFiles()` already
  expects (`diff-loader.ts:36-41`) — do not change that row shape.
- `server/INSIGHTS.md:157` — references `runs.ts:8-20` and
  `reviews/service.ts:114-136` for run-row lifecycle; confirms `agent_runs`
  rows are created up front (`service.ts:141-151`, still accurate) before
  the background execution in `run-executor.ts` runs — Layer 3's thrown
  error must reach `run-executor.ts`'s existing `failAll()` (it already does,
  no new plumbing needed — see Work Item 4's acceptance criteria).
- No existing `server/INSIGHTS.md` entry documents `fetchPullHead` being
  dead code or the `pulls`/`reviews` module's split DB ownership over
  PR-adjacent tables — this plan's Work Item 8 (engineering-insights skill,
  session protocol) should add one once implemented, since it's exactly the
  kind of non-obvious cross-module fact that entry format calls for.

## Skills Implementer Will Need

- `onion-architecture` — governs where the new `pulls/repository.ts` /
  `pulls/service.ts` split lives and requires the `container.pullsSync`
  getter documented above (an architecture-reviewer pass on an earlier
  draft of this plan flagged, and this revision fixed, a direct
  cross-module import that bypassed the composition root). Re-check the
  new files against its Anti-Patterns list (no `drizzle-orm` outside
  `repository.ts`, no `new <Adapter>()`/`new PullsSyncService()` outside
  `container.ts`, no direct `pulls/service.ts` import from
  `diff-loader.ts`) before considering Work Items 2-3 done.
- `fastify-best-practices` — confirms the `GET /pulls/:id` route handler
  should shrink to "call the service, shape the response" after extraction;
  don't let the try/catch swallow-and-log-warn UX pattern
  (`routes.ts:342-343`) leak error-handling logic beyond the route.
- `drizzle-orm-patterns` — `pulls/repository.ts` is a brand-new file with
  insert/delete/update queries copy-adapted from `pulls/routes.ts:305-339`;
  skim this skill before writing it even though the query shapes themselves
  are mechanical.
- `engineering-insights` (session protocol, `server/AGENTS.md:52-53`, root
  `AGENTS.md:53-54`) — run after implementation to record the
  `fetchPullHead`-was-dead-code finding and the pulls/reviews table-ownership
  split in `server/INSIGHTS.md`.
- `pr-self-review` (root `AGENTS.md:56-64`) — mandatory immediately after
  `gh pr create` and after any subsequent push; light mode will hit
  `onion-architecture`, `fastify-best-practices`, and `drizzle-orm-patterns`
  given the touched files, which is exactly the coverage this plan needs
  re-checked as a merge gate.

## Work Items

1. **Layer 1 — active reindex in `loadDiff()`.**
   Files: `server/src/modules/reviews/diff-loader.ts`.
   Change `loadDiff()` to call `container.git.fetchPullHead({owner, name},
   pull.number)` in a best-effort `try/catch` (swallow — clone may not exist
   yet, or the remote may be unreachable; the subsequent `git diff` attempt
   surfaces its own failure) **before** the existing `container.git.diff()`
   attempt, which stays structurally as-is (`if (diff.files.length > 0)
   return diff`, else fall through). Depends on: nothing.
   Acceptance: for a PR whose `headSha` isn't yet in the local clone,
   `loadDiff()` now succeeds via a real `git diff` instead of falling all
   the way through to `pr_files`. Existing `MockGitClient` consumers are
   unaffected since `fetchPullHead()` is already a no-op stub
   (`adapters/mocks.ts:271`).

2. **Layer 2 groundwork — extract the GitHub-refresh into `pulls/repository.ts` +
   `pulls/service.ts`, wired through a new `container.pullsSync` getter.**
   Files: new `server/src/modules/pulls/repository.ts`, new
   `server/src/modules/pulls/service.ts`, edited
   `server/src/modules/pulls/routes.ts`, edited
   `server/src/platform/container.ts`.
   `pulls/repository.ts`: DB-only functions (mirroring
   `reviews/repository/pull.repo.ts`'s plain-function style) —
   `replacePrFiles(db, prId, files)`, `replacePrCommits(db, prId, commits)`,
   `updatePrDetailFields(db, prId, {body, additions, deletions,
   filesCount})` — lifted verbatim from `pulls/routes.ts:305-339`'s
   delete+insert/update calls, no behavior change.
   `pulls/service.ts`: a `PullsSync` port interface with one method,
   `refreshFromGitHub(repo: RepoRow, pull: PullRow): Promise<PrDetail>`, and
   a `PullsSyncService implements PullsSync` class — constructor takes the
   `Container` (mirroring `RepoIntelService`/`IntentDeriverService`'s
   `constructor(private container: Container)`), method body calls
   `container.github()`, then `gh.getPullRequest({owner, name},
   pull.number)`, then the three repository writes above, then returns the
   `PrDetail`. **Throws** on any failure (GitHub call, DB write) — no
   swallowing inside the service; that stays the caller's decision.
   `container.ts`: add `pullsSync?: PullsSync` to `ContainerOverrides`
   (alongside `repoIntel`/`intentDeriver`, `container.ts:56-59`), a private
   `_pullsSync?: PullsSync` field, and a `get pullsSync(): PullsSync`
   getter following the exact `repoIntel`/`intentDeriver` shape
   (`container.ts:137-154`): `if (this.overrides.pullsSync) return
   this.overrides.pullsSync; this._pullsSync ??= new
   PullsSyncService(this); return this._pullsSync;`.
   `pulls/routes.ts`'s `GET /pulls/:id` handler (`routes.ts:301-343`):
   replace the inline `try { const gh = await container.github(); ... }
   catch (err) { app.log.warn(...); ... }` block's *body* with a single
   `await container.pullsSync.refreshFromGitHub(repo, pr)` call, keeping
   the existing try/catch wrapper (still logs the same warn message, still
   serves persisted `prFiles`/`prCommits` on failure) unchanged.
   Depends on: nothing (parallel to Work Item 1).
   Acceptance: `GET /pulls/:id`'s behavior is byte-for-byte unchanged for
   both the live-refresh and offline-fallback branches (verified by Work
   Item 6). No route handler contains raw `db.insert`/`db.delete`/`db.update`
   for `prFiles`/`prCommits`/`pullRequests` detail fields anymore. No file
   outside `pulls/service.ts` imports `pulls/repository.ts`; no file outside
   `platform/container.ts` calls `new PullsSyncService(...)`.

3. **Layer 2 — wire the refresh fallback into `loadDiff()`.**
   Files: `server/src/modules/reviews/diff-loader.ts`.
   After Layer 1's `git diff` attempt is exhausted (throws or returns 0
   files), call `container.pullsSync.refreshFromGitHub(repoRow, pull)` in a
   best-effort `try/catch` (swallow — no token / GitHub unreachable is an
   expected, non-fatal case, same as today's `routes.ts:342-343` warn), then
   re-call the existing `diffFromPrFiles(repo, pull.id)` and return it if
   non-empty. Depends on: Work Item 2.
   Acceptance: a PR whose local clone diff genuinely can't be produced (e.g.
   Layer 1 fails outright) but whose GitHub API refresh succeeds now
   produces a non-empty diff via the freshly-repopulated `pr_files`, without
   requiring anyone to have opened the PR in the studio UI first — this is
   the direct fix for the PR #18 scenario.

4. **Layer 3 — fail-loud guardrail.**
   Files: `server/src/platform/errors.ts`, `server/src/modules/reviews/diff-loader.ts`.
   Add `DiffUnavailableError extends AppError` to `errors.ts` (alongside
   `NotFoundError`/`ValidationError`/`ExternalServiceError`/`ConfigError`,
   `errors.ts:19-38`): `code: 'diff_unavailable'`, `statusCode: 502`,
   constructor takes enough context (owner, name, PR number) to produce a
   message like: `"Diff pipeline returned no changed files for
   <owner>/<name>#<n> even after an active git reindex and a live GitHub
   refresh — refusing to hand an empty diff to the reviewer (would produce a
   false 'clean' verdict). Check clone/GitHub token connectivity, or confirm
   this PR genuinely has zero changed files, then retry."`
   In `diff-loader.ts`'s `loadDiff()`: if, after both Layers 1 and 2, the
   diff is still `{files: []}`, **throw** `DiffUnavailableError` instead of
   returning the empty diff. Depends on: Work Items 1 and 3.
   Acceptance (verify by re-reading, not re-deriving): confirm
   `run-executor.ts:96-105`'s existing `try { diff = await runLog.step(...,
   () => loadDiff(...)) } catch (err) { runLog.error(...); await
   failAll(...); return; }` requires **zero** code changes to correctly
   catch this new throw and mark every queued job in the batch `status:
   'failed'` with the thrown message as `error` — verify this by tracing the
   call, don't assume; if it doesn't already work as described, that's a
   plan-invalidating discovery and work should stop for re-scoping.
   Also confirm `service.ts:221-238`'s `deriveIntent()` (which has no
   try/catch around its `loadDiff()` call at `service.ts:226`) correctly
   propagates the new error through Fastify's `setErrorHandler`
   (`server/src/app.ts:116-153`) as a 502 rather than crashing unhandled.

5. **Test seams — extend `MockGitClient`.**
   Files: `server/src/adapters/mocks.ts`.
   Add to `MockGitClient` (currently `mocks.ts:257-298`): a
   `fetchPullHeadCalls: { repo: RepoRef; n: number }[]` array populated by
   `fetchPullHead()` (currently a bare no-op at `mocks.ts:271`), plus
   `opts.fetchPullHeadThrows?: boolean` and `opts.diffThrows?: boolean` (or
   an `Error`) so `diff()` can simulate the "unknown revision" failure Layer
   1 is meant to route around. Depends on: nothing (parallel).
   Acceptance: a test can assert `fetchPullHead` was called with the right
   `RepoRef`/PR number, and can force `diff()` to throw independent of the
   default fixture return.

6. **Regression tests — Layer 2 extraction preserves `GET /pulls/:id`
   behavior.**
   Files: `server/test/pulls.it.test.ts` (existing suite already covers
   `GET /pulls/:id` at lines ~136-296, per file: "live-refresh branch" /
   "offline-fallback branch" / "zero-reviews PR" tests). Depends on: Work
   Item 2.
   Acceptance: existing tests pass unmodified (proves the extraction is
   behavior-preserving); add one new case asserting `pr_files` rows are
   actually replaced (not merely that the HTTP response looks right) after
   a live-refresh call, since that's the exact side effect Layer 2 depends
   on for the review flow.

7. **New unit tests — `diff-loader.ts`'s three layers.**
   Files: new `server/test/diff-loader.test.ts` (unit, no Docker — construct
   a `Container` with `ContainerOverrides` per the onion-architecture
   skill's Testability section, injecting `MockGitClient`/`MockGitHubClient`
   for Layer 1/Layer 2's real behavior, and optionally
   `ContainerOverrides.pullsSync` with a hand-written fake `PullsSync` where
   a test wants to isolate `diff-loader.ts`'s own branching from
   `PullsSyncService`'s internals).
   Depends on: Work Items 1, 3, 4, 5.
   Acceptance, at minimum:
   - Layer 1 succeeds: `MockGitClient.diff()` returns files → `loadDiff()`
     returns them, `fetchPullHeadCalls` recorded a call.
   - Layer 1 fails (`diffThrows`), Layer 2 succeeds (GitHub mock returns
     files, no override needed given `MockGitHubClient`'s default
     `getPullRequest` fixture already has one file) → `loadDiff()` returns
     the GitHub-sourced diff, via `container.pullsSync.refreshFromGitHub`.
   - Layer 1 and Layer 2 both fail/empty (`diffThrows: true` and
     `MockGitHubOptions.detail = { files: [] }`, or `container.github()`
     unconfigured to throw `ConfigError`) → `loadDiff()` rejects with
     `DiffUnavailableError`.

8. **Regression test proving the PR #18 scenario is fixed end-to-end.**
   Files: `server/test/reviews.it.test.ts` (existing integration suite using
   testcontainers + `MockLLMProvider`/`MockGitClient`/`MockIntentDeriver`,
   confirmed pattern at lines 1-60). Depends on: Work Items 1-7.
   Acceptance: seed a PR with **no** `pr_files` rows, a `MockGitClient`
   configured to throw on `diff()` (simulating a stale clone missing
   `headSha`), and no GitHub token configured (simulating the MCP-triggered,
   never-opened-in-UI path) — trigger a review run and assert the resulting
   `agent_runs` row has `status: 'failed'` with an error message
   identifying the diff pipeline (not `status: 'done'` with `verdict:
   'approve'`/`score: 100`/0 findings, which is the exact false-positive
   this plan eliminates). Add a second case in the same style confirming
   that when `pr_files` *is* pre-seeded (today's only working path), the
   run still succeeds normally — proving no regression for the currently
   working case.

## Verification

- `cd server && pnpm typecheck` — no new type errors from the
  `pulls/repository.ts` / `pulls/service.ts` split or the new
  `DiffUnavailableError`.
- `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` — unit
  suite including the new `diff-loader.test.ts`.
- `cd server && pnpm exec vitest run .it.test` — integration suite
  (testcontainers Postgres required) including the extended
  `pulls.it.test.ts` and `reviews.it.test.ts`; this is the suite that
  proves Work Item 8's PR #18 regression case actually fails loud instead
  of silently approving.
- Manual end-to-end sanity check mirroring the real bug report: with
  `./scripts/dev.sh` running and a repo imported but its clone's local
  `head` intentionally stale (or simply a repo never diff-loaded via the
  UI), call `POST /pulls/:id/review` directly (or via the MCP
  `run_agent_on_pr` tool per `mcp-server/README.md`) without ever hitting
  `GET /pulls/:id` first, and confirm the run either (a) self-heals via
  Layer 1/2 and produces a real diff-backed review, or (b) fails with the
  `DiffUnavailableError` message surfaced in the run's Live Log / trace —
  never a silent `approve`/100/0-findings result.
- After implementation: run the `engineering-insights` skill against
  `server/` to record the `fetchPullHead`-dead-code and pulls/reviews
  table-ownership findings in `server/INSIGHTS.md`, per this repo's session
  protocol (`server/AGENTS.md:52-53`).
- On `gh pr create` (and again after any subsequent push): run
  `pr-self-review` (light mode is sufficient given the touched skills list
  above) per root `AGENTS.md:56-64` — its posted review + `blocked-critical`
  label gate the merge, not this document.
