# Backend architecture audit — backlog

**Status:** planning complete, execution deferred — the findings below are
final and sequenced into the phased roadmap at the bottom; no fixes have
been applied. Pick this doc back up in its own session and work phase by
phase (see **Roadmap — execution phases**).

## Context

Audit of `server/` (Fastify 5 + Drizzle + Postgres) and `reviewer-core/`
against five Claude skills:

- [`onion-architecture`](../.claude/skills/onion-architecture/SKILL.md) — the dependency rule, ports/adapters, routes→service→repository anatomy, the DI container as composition root.
- [`fastify-best-practices`](../.claude/skills/fastify-best-practices/SKILL.md) — plugins, routes, error handling, hooks, auth, rate limiting, logging.
- [`drizzle-orm-patterns`](../.claude/skills/drizzle-orm-patterns/SKILL.md) + [`postgresql-table-design`](../.claude/skills/postgresql-table-design/SKILL.md) — schema, indexing, transactions, relations, migrations.
- [`security`](../.claude/skills/security/SKILL.md) (OWASP Top 10:2025) + [`typescript-expert`](../.claude/skills/typescript-expert/SKILL.md) — injection/traversal/SSRF, secrets, auth boundaries, type hygiene.

Four read-only passes over the live code produced the raw findings below,
each agent citing real `file:line` for every claim. A fifth pass
spot-verified the highest-stakes claims directly against source — the path-
traversal regex (`repos/constants.ts`'s `GITHUB_URL_REGEX` + `helpers.ts`'s
`parseRepoUrl`), the error handler's raw-message fallback (`app.ts:159-164`),
`pulls/routes.ts`'s un-transacted write sequence, and the missing indexes on
`agent_runs`/`reviews`/`findings` (`db/schema/{runs,reviews}.ts`) — all
confirmed accurate. Findings below are deduplicated across scans (several
issues showed up from two angles at once, e.g. `pulls/routes.ts` failing
both the onion-architecture layering rule and the "no transactions" rule).

## Roadmap — execution phases

The Tier 0/A/B/C sections below are the reference backlog (every item with
its `file:line` evidence); this section is the *execution order* for a
future session — sequenced so each phase is independently shippable, lower
phases don't block on higher ones, and no single diff mixes a security fix
with a schema migration with a large refactor. Phase numbers are a
recommended order, not a hard dependency chain, except where noted.

| Phase | Goal | Pulls in | Migration? | Size/risk |
|---|---|---|---|---|
| **1. Security hotfix** | Close the two live vulnerabilities | Tier 0 #1–2 | No | Small, standalone PR — ship first regardless of what else happens |
| **2. Hardening quick wins** | Close the rest of the small gaps surfaced by the security/fastify scans | Tier A #1, #4, #5, #8, #9 | No | Small, one PR — no user-visible behavior change |
| **3. Correctness quick wins** | Fix the two concrete bugs (drift risk, extra round-trips) and the DX papercut | Tier A #2, #3, #6, #7 | No | Small, one PR |
| **4. Module layering: `pulls`/`polling`/`workspace`/`settings`** | Bring the four non-compliant modules up to the routes→service→repository shape; de-dupe the PR-sync logic while moving it | Tier B #1, #2, #3 | No | Medium/large — the biggest single refactor here; do it in its own PR, ideally one module at a time (`pulls` first since it's both the biggest violation and where the transaction bug in Phase 5 lives) |
| **5. Data-integrity: transactions** | Wrap the four identified multi-statement write sequences in `db.transaction()` | Tier B #4 | No | Medium — natural to do *during* Phase 4 for `pulls/routes.ts` specifically (the extraction and the transaction fix touch the same lines), standalone for the other three call sites |
| **6. Data-integrity: schema** | Add missing indexes + the `reviews.agent_id`/`run_id` FK + the `onDelete` fix | Tier B #5, #6, #9 | **Yes** — one migration (`pnpm db:generate` + manual `pnpm db:migrate` per root `AGENTS.md`) | Medium — the FK addition (#6) needs an orphan-cleanup decision first; the indexes and `onDelete` fix are purely additive and could ship alone if #6 needs more design time |
| **7. Observability + coverage** | Fix the SSE memory leak, add the missing `inject()` tests | Tier B #7, #8 | No | Small–medium, unrelated to each other — fine as two small PRs or one grab-bag "hardening" PR |
| **8. Deferred, own scoping session each** | CHECK constraints/enums, `relations()` retrofit, `repo-intel`'s `fs.readFile` → port, pgvector index (only once the memory/RAG feature actually lands) | Tier C (all) | Partially | Large — each bullet is explicitly its own future session per this doc; don't schedule until there's a concrete trigger (e.g. the RAG feature landing is the trigger for the pgvector item) |

**Suggested first session scope:** Phases 1–3 (all Tier 0 + Tier A) — nine
small, independent, no-migration fixes; safe to land as 2-3 PRs in one
sitting. **Suggested second session scope:** Phase 4 alone (the `pulls`
module split) since it's the highest-effort, highest-blast-radius item and
deserves undivided attention rather than being bundled with the schema
work in Phases 5-6.

## Tier 0 — Security, fix before any non-local deploy

1. **Path traversal in repo import → can `rm -rf` outside `server/clones/`.**
   `GITHUB_URL_REGEX` (`modules/repos/constants.ts:18`) parses `owner`/`name`
   with `[^/]+` / `[^/.]+`, which happily matches `owner=".."`. `clonePathFor`
   (`adapters/git/simple-git.ts:35-37`) does `join(cloneDir, owner, name)`
   with no containment check, and `clone()` (lines 51-67) unconditionally
   `rm(dest, { recursive: true, force: true })`s that path if it already
   exists, before cloning. `POST /repos {"url":"https://github.com/../workspace"}`
   resolves `dest` to the clone-dir's parent and deletes whatever's there.
   Verified the regex match live. Fix: reject `owner`/`name` containing `.`,
   `..`, or a path separator — or resolve `dest` and assert it's still inside
   `cloneDir` before any `rm`/`mkdir`. Effort: small.
2. **Git URL validation checks a substring, not scheme/host — `ext::` transport class.**
   `RepoInput` only requires `z.string().url()` plus a `"github.com"`
   substring somewhere in the string (not the actual host), so
   `ext::sh -c '...' github.com/a/b` passes validation and reaches
   `git clone` verbatim — git's `ext::` transport RCE class
   (CVE-2017-1000117-adjacent). The locally installed git (2.50.1) blocks
   `ext::` by default, so exploitability today depends on the deploy host's
   git version/config — the app-level validation itself provides no defense
   either way. Fix: allowlist exact `https://github.com/...` /
   `git@github.com:...` shapes via `new URL()` + hostname check, not a
   substring test. Effort: small.

## Tier A — Quick wins (small, low risk)

1. **Gate the error handler's raw message behind `NODE_ENV`.** `app.ts:159-164`'s
   final fallback sends `e.message` verbatim for any error that isn't a Zod
   error, serialization error, or `AppError` — a raw driver/SDK error message
   could carry internal details. Octokit/git already redact credentials from
   their own errors (verified), so today's practical risk is low, but there's
   no `config.nodeEnv === 'production'` guard as a backstop. Swap to a
   generic message when `statusCode >= 500` in production.
2. **Fix the reviews-routes hand-rolled `.parse()`.** `modules/reviews/routes.ts:32`
   does `RunRequest.parse(req.body ?? {})` instead of a schema-declared body —
   the one exception to an otherwise fully schema-validated route surface, and
   the literal anti-pattern `server/AGENTS.md` already names. Either get
   `schema: { body: RunRequest.optional() }` working, or add an explicit
   comment citing why it can't be (the existing inline comment suggests this
   was tried and reverted).
3. **`app.log` → `req.log` in `pulls/routes.ts`.** Six `.warn()` calls
   (lines 38, 76, 109, 327, 386, 392) use the instance logger instead of the
   request-scoped child, losing `reqId` correlation for exactly the
   sync-skipped/offline warnings most worth tracing back to one request.
4. **Add Pino `redact` for the settings test-connection route.** `app.ts:50-59`
   has no `redact.paths` despite `POST /settings/test-connection` accepting a
   raw API key in its body (`settings/routes.ts:75`). Nothing logs the body
   today — this is a safety net for the next debug statement, not an active
   leak.
5. **`chmod` backstop on `secrets.json`.** `adapters/secrets/local.ts:48`'s
   `writeFile(..., { mode: 0o600 })` only applies the mode on file creation —
   verified Node ignores `mode` on an existing file. Add an explicit
   `chmod(filePath, 0o600)` after every write so a loosely-permissioned
   restore doesn't stay that way silently.
6. **Batch the N+1 in `reviewsForPull`.** `modules/reviews/service.ts:167-181`
   calls `agents.getById()` once per distinct `agentId` inside a loop instead
   of one `inArray` lookup. A PR reviewed by 5 agents does 5 extra round
   trips per page load.
7. **Rate-limit `/repos` clone/refresh/resync.** `modules/repos/routes.ts:26,38`
   and `modules/repo-intel/routes.ts:44` rely only on the global 120/min
   limiter despite triggering comparable background cost (clone, full/
   incremental reindex) to `/pulls/:id/review`, which already has its own
   tight 10/min limit.
8. **Workspace-scope `cancelRun`/`getRunTrace`.** `modules/reviews/service.ts:85`
   and `run.repo.ts:94,206` have no `workspaceId` filter, unlike every
   sibling method in the same file. Not exploitable today (single-workspace
   via `LocalNoAuthProvider`), but it's the one inconsistency against an
   otherwise-consistent workspace-scoping convention — cheap to close now
   before multi-tenancy makes it load-bearing.
9. **Workspace-scope repo-intel's index-state/resync routes.** `modules/repo-intel/routes.ts:36`
   resolves tenancy but never checks the given `repoId` belongs to that
   workspace (self-documented as "tenant-agnostic" in the code). Same
   future-multi-tenant caveat as #8.

## Tier B — Medium refactors (touch shared modules/schema, moderate risk)

1. **Split `pulls/routes.ts` into routes → service → repository.** At 431
   lines this is the single largest onion-architecture violation: it
   `import`s `drizzle-orm` directly (line 3), does GitHub-sync upserts and a
   diff-stat backfill loop inline (lines 22-112), computes the PR-list's
   batch-key/worst-score/findings-rollup logic inline (lines 113-231), and
   does an un-transacted `delete(prFiles)→insert→delete(prCommits)→insert→
   update(pullRequests)` sequence on every PR-detail refresh (lines 289-323) —
   a crash mid-sequence wipes a PR's files/commits with nothing to replace
   them. Extract a `PullsService` + `PullsRepository`; wrap the refresh
   sequence in `db.transaction()` while you're in there.
2. **Consolidate duplicated PR-sync logic — `polling/routes.ts` has the same
   gap.** `modules/polling/routes.ts` independently rebuilds the same
   `insert(t.pullRequests).values(...).onConflictDoUpdate(...)` upsert as
   `pulls/routes.ts`, and the two copies have already drifted (`pulls`
   additionally sets `openedAt`; `polling` doesn't). Fixing #1's extraction
   should produce one shared service method both routes call, not two
   hand-maintained copies.
3. **Give `workspace/routes.ts` and `settings/routes.ts` their missing
   service/repository layers.** Both import `drizzle-orm` straight into
   `routes.ts` with zero `service.ts`/`repository.ts`. `settings/routes.ts`
   additionally has real orchestration logic (provider branching, secret
   rotation, cache invalidation) inline in the `POST /settings/test-connection`
   handler — that belongs in a service. While in there, fold
   `settings/feature-models.ts`'s raw `container.db.select()` (line 41-44)
   into the new repository — it's currently dead code except for one test,
   but its own docstring says it's meant to be imported by onboarding/risk-
   brief/conformance features later; fixing this before any of those land is
   far cheaper than after (the violation escalates from HIGH to CRITICAL the
   moment a second module imports it directly instead of via a container
   getter).
4. **Wrap multi-statement writes in `db.transaction()`.** Zero `.transaction()`
   calls exist anywhere in `src` (grepped). Beyond `pulls/routes.ts` (#1):
   `repo-intel/repository.ts:355-372`'s `replaceEdges`/`replaceFileRank`
   (delete-all-for-repo then chunked insert — a crash mid-insert leaves the
   import-graph empty); `reviews/run-executor.ts:240,252`'s
   `insertReview`→`insertFindings` (a review row can end up claiming N
   findings with zero persisted); `run.repo.ts:78-91`'s `deleteAgentRun`
   (deletes `reviews` then `agentRuns` separately).
5. **Add the missing FK indexes.** `agent_runs` (`db/schema/runs.ts:25-58`)
   has zero indexes beyond its PK despite `activeRunsForPull`/
   `listRunsForPull`/`cancelRunIfRunning`/`reapStaleRunningRuns` all filtering
   on `workspace_id`/`pr_id`/`status`. `reviews`/`findings`
   (`db/schema/reviews.ts:9,30`) are the same — `reviewsForPull` (called on
   every PR-detail load) full-scans both. Same gap, lower traffic, on
   `conformanceChecks.prId`, `composedReviews.prId`, `evalRuns.caseId`,
   `ciInstallations.agentId`, `ciRuns.ciInstallationId`,
   `multiAgentRuns.{workspaceId,prId}`. (Compare `repos.ts`'s `repos_ws_idx`
   or `pulls.ts`'s `pr_ws_idx`, which already do this correctly — the pattern
   exists in the codebase, it's just applied inconsistently.) Requires a
   migration; purely additive, no data risk.
6. **Add the missing FK constraint on `reviews.agent_id`/`reviews.run_id`.**
   Both are plain `uuid()` with no `.references()` (`db/schema/reviews.ts:17,19`) —
   `run.repo.ts:73-76` already self-documents working around the `run_id`
   half of this gap. Deleting an agent never touches `reviews.agent_id`,
   leaving it permanently orphaned. Needs a migration, a decision on
   cascade-vs-set-null, and a cleanup pass for any already-orphaned rows
   (potentially the largest single item in this tier).
7. **Stop the SSE run-bus from growing forever.** `platform/sse.ts:76-83`'s
   `complete()` only removes the `EventEmitter`; `buffers`/`seq`/`completed`/
   `cancelled` keep every run's entry for the life of the process. Prune
   those once the run's trace is persisted (e.g. from `run-executor.ts` right
   after `saveRunTrace`), with a short grace window for a late SSE
   subscriber.
8. **Add `inject()` coverage for untested real-logic routes.** No test hits
   `DELETE /agents/:id`, `DELETE /repos/:id`, `POST /repos/:id/refresh`,
   `GET /pulls/:id` (including its GitHub-refresh-vs-offline-fallback
   branch), `GET /workspace`, the agent skills/models routes,
   `POST /repos/:id/resync`, `GET /repos/:id/index-state`, `DELETE /runs/:id`,
   or `POST /runs/:id/cancel` — several have branching or cascade/cancellation
   semantics worth pinning down.
9. **Fix the inconsistent `onDelete` on creator columns.** `agents.createdBy`/
   `repos.createdBy` (`db/schema/agents.ts:34`, `repos.ts:18`) have no
   `onDelete`, so deleting a user who ever created an agent/repo throws an FK
   violation — while the structurally identical `agentRuns.agentId` already
   uses `onDelete: 'set null'`. Likely an oversight, not a deliberate choice.

## Tier C — Bigger, deferred (needs its own scoping session)

- **Add DB-level CHECK constraints (or real Postgres enums) for TEXT
  "enum" columns.** Zero `CHECK` constraints exist in any of the 12
  migrations. `jobs.status`, `pullRequests.status`, `reviews.kind`,
  `findings.severity`/`category` rely entirely on TypeScript to keep out
  garbage values — Postgres itself will accept any string. Worth a
  deliberate decision (which columns are worth it vs. accepted risk), not a
  blanket mechanical fix.
- **Retrofit Drizzle `relations()` across the schema.** Zero `relations()`
  calls exist; every join anywhere in the codebase is hand-rolled
  `.leftJoin`/`.innerJoin`. Purely additive and non-breaking to add, but
  touches all ~34 tables — its own PR, not a quick win.
- **`repo-intel`'s direct `fs.readFile` calls.** `modules/repo-intel/service.ts`
  and both `pipeline/{full,incremental}.ts` read cloned-repo files straight
  off disk rather than through a port — ties the service to `GitClient`'s
  concrete on-disk layout. Organizational polish per onion-architecture's
  spirit, not a named anti-pattern in the letter of the skill; low urgency.
- **pgvector ANN index for `memory.embedding`/`codeChunks.embedding`.**
  Neither column has an `hnsw`/`ivfflat` index, but neither also has any
  consumer anywhere in `src/modules` yet (grepped, confirmed) — this is the
  memory/RAG feature a later lesson fills in. **Do not build the index
  blind**; decide the index type and build it once real rows and query
  patterns exist.
- **Repo-wide `db.query.*.findMany({ with: ... })` adoption** — depends on
  the `relations()` retrofit above; bundle together.

## Not an action item (FYI only)

- **`agent_runs.cost_usd` migration churn** (`0009_complex_runaways.sql`
  drops it, `0010_mature_iron_lad.sql` re-adds it moments later) — harmless
  on a fresh DB (matches `schema.ts` today); only relevant to an environment
  that had exactly `0009` applied before `0010` shipped. No action.
- **LLM-output → shell/FS/SQL injection surface doesn't exist yet.**
  `commitFiles`/`openPullRequest` (the Octokit adapter methods that would be
  the injection point) have no callers in `modules/` today — the CI/agent-
  runner lesson that would wire them up hasn't landed. Revisit this audit
  item when it does, not before.
- **Raw SQL is already fully parameterized.** `repo-intel/repository.ts`'s
  hand-written `sql` template-tag queries (including the reserved-word-quoted
  `"references"` table) were checked for injection and are clean — no action
  needed, noted so a future pass doesn't re-flag it.

## Already solid (confirmed while auditing — worth preserving as reference)

- **`modules/agents/*` and `modules/repos/*`** are second and third fully
  compliant routes→service→repository slices alongside `modules/reviews`
  (already cited in the onion-architecture skill) — good additional worked
  examples, especially `repos/service.ts`'s async-job orchestration
  ("no HTTP and no raw SQL live here" is stated in its own docstring).
- **`platform/container.ts`** is a textbook composition root — every
  concrete adapter is behind a lazy getter gated by `ContainerOverrides`,
  and the shared `agentsRepo`/`reviewRepo` getters are self-documented as
  existing specifically to stop cross-module repository imports.
- **Schema hygiene is otherwise good**: consistent `timestamptz` (no bare
  `timestamp` anywhere), no `varchar(n)`, zero `: any`/`as any` in any
  repository file, idempotent unique constraints
  (`pullRequests(repoId, number)`, `repos(workspaceId, fullName)`), and
  `findings.reviewId`'s cascade is a real DB constraint, not just an
  app-level assumption.
- **Auth/credential handling checked and clean**: Octokit and git both
  redact credentials from their own thrown errors (verified against
  installed package source + a live failed-clone repro); CORS is a real
  origin allowlist, not a wildcard; no unsafe TypeScript escape hatches
  (`any`, `@ts-ignore`, unchecked non-null assertions) anywhere in `src`.
- **The rate-limiting *pattern* is right where it's applied** —
  `/pulls/:id/review`'s tight 10/min override plus the disabled global
  limiter under test plus the disabled limiter on the long-lived SSE
  endpoint is exactly the right shape; Tier A #7 is about extending the same
  pattern to two more routes, not fixing a broken one.
