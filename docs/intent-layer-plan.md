# Intent Layer — PR intent classification, scope-aware review filtering

**Status:** implemented and reviewed — server + reviewer-core + client wiring done, migration generated and applied, i18n gap fixed; architecture-reviewer and plan-verifier both passed (see "Implementation & Review" below); not yet committed/PR'd; no new automated tests were added this pass (deferred by explicit decision) and `pr-self-review` is still pending until a PR is opened.

## Context

DevDigest already ships dead scaffolding for this feature: the `pr_intent` table (`server/src/db/schema/reviews.ts:50-57`), the `Intent` zod contract (`server/src/vendor/shared/contracts/brief.ts:8-14`, mirrored in `client/src/vendor/shared/contracts/brief.ts`), `ReviewRepository.upsertIntent`/`.getIntent` (`server/src/modules/reviews/repository/pull.repo.ts:47-68`, wrapped in `server/src/modules/reviews/repository.ts:130-137`), and a `FeatureModelId` slot `'review_intent'` already rendered generically in Settings (`client/src/app/settings/.../SettingsModels/SettingsModels.tsx`) — but **zero producers call any of it**. This plan wires a real producer per the user's authoritative spec: a separate flash-class cheap OpenRouter model call returns a structured `Intent` (`intent` — the spec calls this field "summary"; this plan keeps the existing DB/contract field name `intent`, see "Contract field naming" below — `in_scope[]`, `out_of_scope[]`) from the PR's title/description, linked issue/ticket, an optional linked plan/spec (fetched, never invented when unreachable), and a file list with **hunk headers only, never hunk bodies** (cost + privacy). The derived intent is persisted per PR, re-derivable manually (independent of running a full review), shown on the PR page **before** the review results, injected into the reviewer's prompt, and used to deterministically filter findings down to in-scope ones (preserving at most one out-of-scope signal when it's serious).

A safe-fetch port already exists and is directly reusable for the spec-URL fetch: `HttpUrlFetcher` (`server/src/adapters/url-fetcher/http.ts`) is wired at `container.urlFetcher` (`server/src/platform/container.ts:159-162`), already enforces scheme allowlisting, DNS-rebinding-safe resolved-IP pinning, a full private/loopback/link-local/CGN/cloud-metadata blocklist (IPv4 **and** IPv6, including the 100.64.0.0/10 and `::` gaps closed by two dated `server/INSIGHTS.md` entries, 2026-08-07), `redirect: 'error'`, and a 10s timeout. Its only current consumer is the Skills import-from-URL flow (`server/src/modules/skills/service.ts:262-` — `previewUrlImport`), which is the pattern to copy for content-type/size handling.

**Confirmed decisions (from the user's authoritative spec + follow-up):**
- Cheap classifier default model: `openrouter/deepseek-v4-flash` — confirmed.
- Spec-content HTML handling: naive tag-stripping, no new dependency — confirmed.
- Confidence: kept as an internal/audit mechanism (DB column + log field + evidence-tier ceiling clamp), but the **UI does not show a numeric percentage** — the mockup/spec show a qualitative tag instead. `ConfidenceNum` is therefore **not** reused in the UI for this card (correction from the first draft) — only `evidence_tier` renders, as a `Badge`.
- UI placement: `OverviewTab.tsx`, not `FindingsTab`/`ReviewRunAccordion` — corrected below with real, explore-verified file paths.

## Scope

- In scope: intent derivation (cheap-model LLM call, header-only diff input), linked-issue/spec-URL fetching with explicit unreachable-link flagging, indirect signal fallback, confidence clamping (audit-only), `pr_intent` schema/contract growth, a read route **and** a manual re-derive route, `PromptParts.intent` threading, deterministic scope-based finding filtering, a new PR-level `IntentCard` on `OverviewTab.tsx`, run-log instrumentation distinguishing the two LLM calls.
- Out of scope: `pr_brief` (broader composed brief — a separate future lesson), Blast Radius / Risks / PR History / Smart Diff (siblings in `brief.ts`, not touched — the mockup's two-column "PR BRIEF" + "BLAST RADIUS" layout is aspirational; this plan builds a single full-width card), any change to the Settings UI itself (it already renders the `review_intent` picker generically — verify only), CI/eval-runner wiring (no CI runner exists yet in this repo), automatic re-derivation on PR update/webhook (spec explicitly says manual trigger only).

## Modules Touched

- `server/src/modules/intent/` — **new** module: `types.ts` (the `IntentDeriver` port + a minimal `IntentLog` logging interface) and `service.ts` (`IntentDeriverService`). No `routes.ts` of its own — both HTTP entry points live in `reviews/routes.ts` (see API changes). Named per the roadmap comment at `server/src/modules/index.ts:22-24`, which already lists `intent/smart-diff` as a future-lesson module.
- `server/src/modules/reviews/` — `run-executor.ts` (automatic hook point), `repository/pull.repo.ts` + `repository.ts` (schema-driven changes + `getPrCommits`), `routes.ts` (new `GET /pulls/:id/intent` **and** `POST /pulls/:id/intent/derive`), `service.ts` (`getIntent` passthrough + new `deriveIntent` orchestration reusing `loadDiff`), `diff-loader.ts` (reused as-is, no change needed).
- `server/src/db/schema/reviews.ts`, new migration.
- `server/src/vendor/shared` + `client/src/vendor/shared` — `contracts/brief.ts` (Intent + evidence tier), `contracts/findings.ts` (**new** `Finding.in_scope`), `contracts/review-api.ts` (unaffected — inherits via `.extend()`), `contracts/platform.ts` (default-model fix), `contracts/trace.ts` (PromptAssembly.intent).
- `server/src/platform/container.ts`, `server/src/adapters/mocks.ts` — new `IntentDeriver` port getter + mock, mirroring `RepoIntel`.
- `reviewer-core/src/prompt.ts` — new `PromptParts.intent` slot + trusted scope-filtering instruction trailer.
- `reviewer-core/src/review/run.ts` — new `ReviewInput.intent` field threaded into `promptParts`; new scope-filter step after grounding, before `scoreFromFindings`.
- `reviewer-core/src/review/reduce.ts` — new pure `filterByScope()` function.
- `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/` — new `IntentCard/` rendered here (not `FindingsTab`).
- `client/src/lib/hooks/reviews.ts` — new `usePrIntent` + `useDeriveIntent` hooks.
- `client/src/lib/feature-models.ts` — default-model fix (mirrors server).

## Architectural Constraints

- Dependencies point inward only; `reviewer-core` must stay I/O-free — intent *derivation* (LLM + GitHub + HTTP fetch) cannot live there, only the *rendering* of an already-derived intent string into the prompt, and the *deterministic filtering* of already-tagged findings, can (`reviewer-core/AGENTS.md:26-29`, "Never add DB/GitHub/FS calls here"). `filterByScope()` is pure (findings array in, findings array out) — exactly the shape `scoreFromFindings`/`reduceReviews` already use in the same file, so it belongs in `reduce.ts`, not in the server.
- Every module keeps the routes → service → repository shape; only a `repository.ts`/`*.repo.ts` file may import `drizzle-orm` (onion-architecture skill, "Module Anatomy"). The new `modules/intent/` deliberately has **no** `repository.ts` — it has no persisted resource of its own; persistence stays in `reviews`' `ReviewRepository` (which already owns `pr_intent`), reached via `container.reviewRepo`.
- A new cross-module capability that composes several ports (here: LLM + GitHubClient + UrlFetcher + a DB read) is modeled as its own port+service pair wired onto `Container`, exactly like `RepoIntel` (`server/src/modules/repo-intel/types.ts:139` port, `server/src/platform/container.ts:132-135` getter, `overrides.repoIntel` override seam) — **not** instantiated inline inside `run-executor.ts` or `reviews/service.ts`, so it stays swappable in unit tests via `ContainerOverrides`, the same way `buildCallersDigest`/`buildRepoMapDigest` already consume `container.repoIntel` (`server/src/modules/reviews/run-executor.ts:193-201`).
- No concrete adapter may be constructed outside `platform/container.ts` (onion-architecture, Composition Root, CRITICAL) — `IntentDeriverService` must receive `Container`, not build its own LLM/GitHub/fetch clients.
- All external/author-controlled content in the prompt is untrusted and must go through `wrapUntrusted()` — never appended to the trusted system prompt string (`reviewer-core/src/prompt.ts:6-9,30-34`). The `INJECTION_GUARD` constant **already explicitly names** "derived intent/scope" as untrusted-adjacent content models must treat as data, not instructions (`reviewer-core/src/prompt.ts:16-28`) — this plan's `intent` section satisfies that existing guard. The one piece of **trusted** text this plan adds (the scope-tagging instruction telling the model how to set `Finding.in_scope`) is server-authored framing, not PR/spec content, so it is placed OUTSIDE the `wrapUntrusted()` block, the same way the `## Derived intent` heading itself is trusted while its contents are wrapped.
- `@devdigest/shared` is hand-copied into `server/src/vendor/shared` **and** `client/src/vendor/shared` — every contract edit lands in both, in the same change (root `CLAUDE.md`, "Non-default conventions").
- Migrations are manual (`pnpm db:migrate`), never run on boot (root `CLAUDE.md`, "Non-default conventions").

## Relevant INSIGHTS.md Gotchas

- `server/INSIGHTS.md` (2026-08-07): `FEATURE_MODELS`' `'conventions'` entry shipped with a non-cheap default despite the feature explicitly requiring a cheap model — fixed to `openrouter/deepseek-v4-flash`. **The exact same bug exists today for `'review_intent'`**: both `server/src/vendor/shared/contracts/platform.ts:52-57` and `client/src/lib/feature-models.ts:22-27` default it to `openai`/`gpt-4.1` — not cheap. The user's spec confirms the intended default is `openrouter/deepseek-v4-flash`; fix both copies the same way.
- `server/INSIGHTS.md` (2026-08-06, ×2): Node's global `fetch` rejects an `undici`-package `Agent` dispatcher; a custom DNS `lookup` must handle both the single-address and `options.all` array callback shapes. Both already correctly handled inside `HttpUrlFetcher` — reuse, don't re-solve.
- `server/INSIGHTS.md` (2026-08-07, ×2): the SSRF blocklist's IPv4 CGN gap and IPv6 `::`-unspecified gap were each found on a **third/fourth** `pr-self-review` security pass on this exact file — both are now fixed in `HttpUrlFetcher`. Reusing the port as-is means this plan inherits the fix; re-implementing fetch logic locally would silently lose it.
- `server/INSIGHTS.md` (2026-08-05, multiple entries): any "per-PR aggregate across a multi-agent batch" must NOT pick "the literal latest row" naively. **Does not apply to intent** — intent is derived exactly ONCE per `executeRuns()` call (batch-level, before the per-agent loop) or once per manual re-derive click, always upserted as a single `pr_intent` row keyed by `prId` — no "which agent's version wins" ambiguity.
- `client/INSIGHTS.md` (2026-08-06): a `.default()` field added to a shared zod contract breaks every hand-built literal typed as that contract in existing tests — relevant if `confidence`/`evidence_tier`/`Finding.in_scope` are added with `.default(...)`; recommend required fields for `confidence`/`evidence_tier` (derivation always produces them) but `.nullish()` (not `.default()`) for `Finding.in_scope` specifically, since **most existing Finding-producing code paths will never set it** (only the main reviewer, when intent was injected, sets it) — a `.nullish()` field doesn't force every existing `Finding` literal (fixtures, other Finding producers like lethal-trifecta/phantom/hook detectors) to add it, unlike `.default()`'s output-type gotcha.
- `server/INSIGHTS.md` (2026-08-04): growing a shared trace-adjacent contract needs fixture updates in `server/test/contracts.test.ts` too, not just component tests — applies to `Intent`/`Finding`/`PromptAssembly`.
- `client/INSIGHTS.md` (2026-08-07): a matching `messages/en/<feature>.json` namespace may already exist unused — check before writing new i18n copy for `IntentCard` from scratch.

## Skills Implementer Will Need

- `onion-architecture` — for the new `modules/intent/` port+service pair (no repository.ts, no routes.ts — a pure capability module), the `container.intentDeriver` getter, and keeping both call sites (`run-executor.ts` automatic, `reviews/service.ts` manual) going through the container.
- `drizzle-orm-patterns` + `postgresql-table-design` — for the `pr_intent` migration (new NOT NULL columns on an empty, zero-write table; a `CHECK (confidence BETWEEN 0 AND 1)` constraint) and the new `getPrCommits` repository read.
- `zod` — for growing `Intent` (required `confidence`/`evidence_tier`/`sources`) and `Finding` (`.nullish() in_scope`) in both vendor copies, and for the classifier's own structured-output schema (`IntentDerivation`, distinct from the persisted `Intent` shape — see Call sequence).
- `fastify-best-practices` — for the two new routes in `reviews/routes.ts` (`GET`/`POST`, zod `params` validation via `IdParams`, matching the existing `GET /pulls/:id/reviews` shape and the conventions module's POST-trigger-with-no-body shape).
- `security` — SSRF review of the spec-URL fetch path (size-cap/content-type/HTML-stripping code around the reused fetch port), and TWO separate prompt-injection review passes: the final review prompt's new `## Derived intent` section, AND the intent-classifier's own system prompt (a new, distinct injection surface — see Risks).
- `frontend-ui-architecture` — for the new `IntentCard/` component folder shape under `OverviewTab/_components/` (nested, per the existing `_components/` inside a component folder convention), the `lib/hooks/reviews.ts` additions, and the re-derive button mirroring the Conventions "Rescan" mutation pattern.
- `react-best-practices` — hook/component correctness review for `usePrIntent`/`useDeriveIntent`/`IntentCard`, and for `OverviewTab.tsx` gaining a second data-fetching concern (currently pure-props).
- `pr-self-review` — mandatory per root `CLAUDE.md` session protocol, right after `gh pr create` and again after any push to that PR.
- `engineering-insights` — mandatory per root `CLAUDE.md` session protocol, at the end of the implementation session.

---

## 1. Data sources

Ordered by trust/quality, all resolved inside `IntentDeriverService.derive()`:

1. **PR title + description (`pull.title`, `pull.body`)** — already on `PullRow` (`server/src/db/schema/pulls.ts:16,26`), no fetch needed. Per the spec: **if the description is empty**, the classifier falls back to title + file names + hunk headers (source #4 below) — this is the explicit fallback path named in the spec, not just a generic "indirect signals" bucket.
2. **Linked GitHub issue/ticket** — re-fetched live via `container.github().getIssue(repo, n)` after re-running the same regex `OctokitGitHubClient.resolveLinkedIssue` already uses (`server/src/adapters/github/octokit.ts:127-135`) — **not** read from `PrDetail.linked_issue`, since that DTO is only populated on a live `GET /pulls/:id` call and isn't guaranteed fresh inside a background review run or a standalone manual re-derive call. Best-effort: on GitHub-client-unavailable or a 404/deleted issue, log and continue — same "never let enrichment break the run" contract as `buildCallersDigest` (`run-executor.ts:396-400`) — **but see the unreachable-link rule below**, which is stricter than plain best-effort-and-move-on for the *linked plan/spec* case specifically.
3. **Linked plan/spec URL** — extracted from `pull.body` by a new small heuristic (no existing extractor in the codebase): the first `http(s)://` URL in the body that is **not** a same-repo GitHub PR/issue/commit self-link and does not end in a known binary/image extension. Fetched via `container.urlFetcher.fetch(url)`.
   - **Unreachable-link rule (explicit spec requirement):** if a spec/ticket link is present in the PR body but the fetch fails (network error, non-2xx, SSRF-blocked, timeout, or a content-type this plan doesn't parse), the derivation must **not** silently proceed as if the link didn't exist and invent content for it. Instead: record `"spec_link_unreachable:<url>"` in `sources`, and the classifier's system prompt explicitly instructs: "if a linked spec/ticket could not be retrieved, say so in your intent summary — never guess what it might contain." This is a distinct code path from "no spec link was present at all," and both the persisted `sources` array and the rendered intent text must make the distinction visible.
4. **File list — hunk headers only, never hunk bodies** (used for (a) the description-empty fallback per source #1, and (b) always included alongside sources #1-3 as baseline structural context, since the spec frames it as a standing input, not purely a fallback-only signal):
   - Changed file paths + additions/deletions counts: `diff.files.map(f => ({ path: f.path, additions: f.additions, deletions: f.deletions }))` — already computed once per batch by `loadDiff()` before this hook point, or by the manual-trigger route's own `loadDiff()` call.
   - Hunk headers: `diff.files[].hunks` is `DiffHunk[]` (`server/src/vendor/shared/adapters.ts:187-195` — `file, oldStart, oldLines, newStart, newLines, newLineNumbers`). `DiffHunk` structurally contains **no line-body text at all** — only numeric hunk-boundary metadata. The classifier input is built by re-rendering the standard `@@ -oldStart,oldLines +newStart,newLines @@` header string from these numbers — genuinely new code (no existing formatter does this), but low-risk: it's impossible to accidentally leak hunk body content through this path because `DiffHunk` never carries it. The only place hunk *bodies* exist is `UnifiedDiff.raw` (the full diff text) and per-file slices via `sliceDiff()` (`reviewer-core/src/review/reduce.ts:58-72`) — `IntentDeriverService` must never touch `diff.raw` or call `sliceDiff()`, only `diff.files[].{path,additions,deletions,hunks}`. Worth a code comment at the call site making this constraint explicit, since it's easy for a future edit to accidentally reach for `diff.raw` "for more context."
   - Branch name: `pull.branch` (already on `PullRow`) — also used as a fallback signal alongside hunk headers when the description is empty.
   - Commit messages: `container.reviewRepo.getPrCommits(prId)` — **new** repository read; `pr_commits` is already persisted on PR sync (`server/src/modules/pulls/routes.ts:301-303`), so this is a DB read, not a GitHub call.

**Evidence tier** (the audit-only confidence mechanism): `direct` when a real description and/or a successfully-fetched spec/ticket backs the intent; `ticket_only` when only a linked issue (no real description); `indirect_only` when the description is empty and derivation falls back to title + hunk headers + branch + commits only, per the spec's explicit fallback path. **Open question, still unresolved:** the exact "empty description" threshold (this plan proposes: null/whitespace-only, or <40 meaningful chars after stripping template boilerplate) — flag for confirmation.

## 2. Call sequence

Two entry points share one implementation — no duplication:

```
(a) AUTOMATIC — once per executeRuns() batch, before the per-agent loop:
executeRuns(workspaceId, pull, repo, jobs, logger)
  runLog.step('Loading PR diff', loadDiff(...))                 // existing, run-executor.ts:98
  runLog.step('Deriving PR intent', () =>                       // NEW
      container.intentDeriver.derive({ workspaceId, pull, repo, diff, log: runLog }),
      { kind: 'tool' })
  for (agent, runId) of jobs:
    runOneAgent(..., diff, agent, runId, runLog)
      → reviewPullRequest({ ..., intent: <rendered string>, ... })  // NEW ReviewInput field

(b) MANUAL — POST /pulls/:id/intent/derive, independent of any review run:
ReviewService.deriveIntent(workspaceId, prId)
  pull = this.repo.getPull(workspaceId, prId); repo = this.repo.getRepo(pull.repoId)
  diff = await loadDiff(container, this.repo, workspaceId, pull, repo)   // same helper, reused
  return this.container.intentDeriver.derive({ workspaceId, pull, repo, diff,
      log: <adapter wrapping app.log: {tool,info,error}> })
```

`IntentDeriverService.derive({ workspaceId, pull, repo, diff, log })`:

```
1. resolveFeatureModel(container, workspaceId, 'review_intent')     // cheap model, defaults to openrouter/deepseek-v4-flash
2. best-effort: container.github().getIssue(...) if a #N reference is found  (data source 2)
3. best-effort-with-explicit-failure-flagging: extract + container.urlFetcher.fetch(specUrl)
   (data source 3 — records "spec_link_unreachable:<url>" on failure, never invents content)
4. always: diff.files paths + additions/deletions + rendered hunk headers, pull.branch,
   container.reviewRepo.getPrCommits(prId)                          (data source 4)
5. log.tool('PR intent LLM call (<provider>/<model>)', { promptComponents, model, estTokens })
   llm.completeStructured({ model, schema: IntentDerivation, sessionId: `${owner}/${name}#${number}:intent`, ... })
6. server-side clamp: confidence = min(model_confidence, tierCeiling(evidenceTier))
7. container.reviewRepo.upsertIntent(prId, { intent, in_scope, out_of_scope,
   confidence, evidence_tier, sources })
8. log.info('intent: derived (tier=..., confidence=..., N source(s))')
9. return the Intent (or undefined on total derivation failure — logged via log.error, never thrown to the caller)
```

- `IntentDerivation` (the classifier's own structured-output schema) is **distinct** from the persisted `Intent` contract — the classifier emits only `{ intent, in_scope, out_of_scope, confidence }` (its own self-reported confidence, pre-clamp); `evidence_tier` and `sources` are computed server-side from which data sources actually resolved, not emitted by the model. Define `IntentDerivation` locally in `modules/intent/service.ts` (not a new shared contract) since nothing outside this module needs it.
- Failure mode: intent derivation is **best-effort at the batch level** for path (a) — a total failure logs and `executeRuns()` proceeds with `intent: undefined` (prompt section omitted), not routed through `failAll()`. For path (b), a total failure surfaces as a normal 5xx to the manual-trigger button (the user clicked an explicit action and should see it failed), unlike (a)'s silent degrade.
- `IntentLog` (new, `modules/intent/types.ts`) is a minimal interface — `{ tool(msg, data?): void; info(msg, data?): void; error(msg, data?): void }` — **not** a dependency on `platform/run-logger.ts`'s concrete `RunLogger` class, so `modules/intent/` doesn't need to import platform internals just to log. `RunLogger` instances already satisfy this shape structurally (duck-typed) for call site (a); call site (b) passes a tiny inline adapter forwarding to Fastify's `app.log` (pino), since a manual re-derive has no SSE run/trace to fan into.
- **Distinguishing the two LLM calls in logs** (explicit spec requirement): satisfied two ways — (1) the `runLog.step('Deriving PR intent', ...)`/`log.tool('PR intent LLM call ...')` label is textually distinct from the main review's own step labels (`'Starting review with agent "..."'`, `run-executor.ts:167`); (2) the OpenRouter `sessionId` passed to the classifier call (`${owner}/${name}#${number}:intent`) is a different session id than the main review's (`${owner}/${name}#${number}:${agent.name}`, `run-executor.ts:259`), so they group separately in the OpenRouter dashboard too, not just in DevDigest's own logs.

## 3. Schema changes

### 3a. `pr_intent` table — `server/src/db/schema/reviews.ts:50-57`

Add three columns (table currently has zero writers anywhere — safe, non-breaking, no backfill needed). Field name stays `intent`, per "Contract field naming" below.

```ts
export const prIntent = pgTable('pr_intent', {
  prId: uuid('pr_id').primaryKey().references(() => pullRequests.id, { onDelete: 'cascade' }),
  intent: text('intent').notNull(),
  inScope: jsonb('in_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  outOfScope: jsonb('out_of_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  confidence: doublePrecision('confidence').notNull(),                      // NEW, audit-only (not shown as a % in UI)
  evidenceTier: text('evidence_tier', {                                    // NEW
    enum: ['direct', 'ticket_only', 'indirect_only'],
  }).notNull(),
  sources: jsonb('sources').$type<string[]>().notNull().default(sql`'[]'::jsonb`), // NEW
}, (t) => ({
  confidenceRange: check('pr_intent_confidence_range', sql`${t.confidence} >= 0 AND ${t.confidence} <= 1`), // NEW
}));
```

- `confidence` — `doublePrecision`, mirrors `findings.confidence` (`reviews.ts:43`). **Not rendered as a percentage anywhere in the UI** — the mockup/spec show a qualitative tag, not a number. This column stays for the DB/audit-log/clamping mechanism only.
- `evidenceTier` — closed enum so the UI can render a fixed 3-way qualitative badge without string matching. `sources` — audit-trail array (e.g. `["pr_description", "linked_issue#42", "spec:https://...", "spec_link_unreachable:https://...", "branch_name", "commit_messages", "changed_paths", "hunk_headers"]`).
- `check()` import from `drizzle-orm/pg-core` — new import in this file.

### 3b. `findings` table — `server/src/db/schema/reviews.ts:30-48`

```ts
export const findings = pgTable('findings', {
  ...
  inScope: boolean('in_scope'),   // NEW, nullable — see contract note below
});
```

Nullable, no default: most findings (safety-kind findings, or any review run without an injected intent) simply never set it. `boolean` import added from `drizzle-orm/pg-core`.

### 3c. Migration

Pure `ADD COLUMN` × 4 across two tables (no drops/renames) — per `server/INSIGHTS.md` (2026-08-09 addendum), `pnpm db:generate` handles this cleanly with no interactive prompt. Run `pnpm db:generate` then `pnpm db:migrate`.

### 3d. Shared contracts — BOTH `server/src/vendor/shared/contracts/brief.ts` and `client/src/vendor/shared/contracts/brief.ts`

```ts
export const EvidenceTier = z.enum(['direct', 'ticket_only', 'indirect_only']);
export type EvidenceTier = z.infer<typeof EvidenceTier>;

export const Intent = z.object({
  intent: z.string(),               // the spec's "summary" — see naming note below
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
  confidence: z.number().min(0).max(1),        // NEW, required — audit/log/clamp only, not shown as % in UI
  evidence_tier: EvidenceTier,                  // NEW, required
  sources: z.array(z.string()),                 // NEW, required
});
```

`PrIntentRecord = Intent.extend({ pr_id: z.string() })` (`review-api.ts:60-62`) needs no change — inherits the new fields via `.extend()`.

**Contract field naming (explicit note for the implementer):** the user's spec text calls the summary field `summary`; the live DB column, zod field, and repository methods all already use `intent`. This plan does **not** rename the existing field — `intent` **is** the "summary" the spec describes. Renaming would touch every existing read/write site (`pull.repo.ts`, `review-api.ts`, `run-executor.ts`, any future consumer) for a purely cosmetic gain, contradicting the "wire the dead scaffold, don't rebuild it" economics that make this plan cheap. No ambiguity for the implementer: write `intent`, not `summary`.

**`Finding.in_scope`** — BOTH `server/src/vendor/shared/contracts/findings.ts` and the client copy:

```ts
export const Finding = z.object({
  ...
  in_scope: z.boolean().nullish(),   // NEW — set by the reviewing LLM itself when intent was injected; absent otherwise
});
```

`.nullish()`, not `.default()` — per the `client/INSIGHTS.md` 2026-08-06 gotcha, and because most `Finding` producers (lethal-trifecta/phantom/hook detectors, any run without intent) legitimately never set it; a `.default()` would force every existing `Finding` literal in the codebase (fixtures, other producers) to add it for no benefit.

**`PromptAssembly.intent`** — BOTH `server/src/vendor/shared/contracts/trace.ts` and the client copy: `intent: z.string().nullish()`, mirroring `repo_map`/`callers`.

### 3e. Repository — `server/src/modules/reviews/repository/pull.repo.ts`

- `upsertIntent`/`getIntent` (lines 47-68) — extend both to read/write `confidence`/`evidenceTier`/`sources` alongside existing fields.
- **New**: `getPrCommits(db, prId)` — `select().from(t.prCommits).where(eq(t.prCommits.prId, prId))`, mirroring the existing `getPrFiles` right above it. Wrap in `ReviewRepository.getPrCommits()` next to the existing `getPrFiles` wrapper.
- **New**: `getPull`/`getRepo` are already exposed on `ReviewRepository` (`pull.repo.ts:9-26`) — the manual-trigger `ReviewService.deriveIntent()` reuses these directly, no new repository code needed for that part.

## 4. API changes

**Two new routes** in `server/src/modules/reviews/routes.ts` (co-located with the existing `GET /pulls/:id/reviews`, same `IdParams` pattern):

- `GET /pulls/:id/intent` → `ReviewService.getIntent(workspaceId, prId)` → thin passthrough to `container.reviewRepo.getIntent(prId)` (mirrors `reviewsForPull`). Returns `PrIntentRecord | null` (`null` before any derivation has run).
- `POST /pulls/:id/intent/derive` → `ReviewService.deriveIntent(workspaceId, prId)` — the manual re-derivation endpoint the spec requires ("when the PR updates, the user can manually trigger re-derivation"). No request body, mirroring `POST /repos/:id/conventions/extract`'s no-body-POST shape (`conventions/routes.ts:47-50`). Returns the freshly-derived `PrIntentRecord`. Synchronous (single cheap-model call, no SSE run stream, no `agent_runs`/`RunTrace` row — lighter than a review run, matching the Conventions "Rescan" precedent).
- `PrDetail` is **not** extended with an inline `intent` field — kept a separate fetch (like `reviews`), consistent with existing precedent.

## 5. Prompt-builder changes

### 5a. `reviewer-core/src/prompt.ts`

- New `PromptParts.intent?: string` field, documented like `callers`/`repoMap` ("derived, untrusted, delimiter-wrapped, omitted when undefined").
- Rendered in `assemblePrompt()` as a new `## Derived intent` section, positioned **right after** `## PR description` and **before** `## Skills / rules` — the model sees "what the PR claims" then "what we inferred" before anything else.
- The wrapped, untrusted part: `wrapUntrusted('derived-intent', intentText)` — satisfies the existing `INJECTION_GUARD`, which already names "derived intent/scope" explicitly (`prompt.ts:16-28`).
- A second, **trusted** piece of text is appended immediately after the wrapped block (own paragraph, outside `<untrusted>`): the scope-tagging instruction —
  > "For each finding you report, set `in_scope` to `false` only if it is clearly about code entirely outside the PR's stated scope above; otherwise `true`. When the intent above is low-confidence (see its evidence tier), be conservative — only mark something out of scope if you're genuinely confident it's unrelated to what this PR is doing."
  This is server-authored framing, not PR/spec content, so it does not go through `wrapUntrusted()` — same reasoning as why `INJECTION_GUARD` itself and the `## Derived intent` heading are trusted while the intent text between them isn't.
- Render format for `intentText` (composed server-side):
  ```
  Intent: <intent>
  In scope: <in_scope bullets>
  Out of scope: <out_of_scope bullets>
  Evidence: <evidence_tier label, e.g. "inferred from branch/commits/file names only — low confidence">
  ```
  No numeric percentage in the prompt either — qualitative framing only; the model doesn't need a fake-precise number, it needs to know "trust this less."
- Size cap: new `MAX_INTENT_CHARS` (propose 1500, smaller than `MAX_PR_DESCRIPTION_CHARS = 4000` since intent+scope is a compact LLM-authored summary) — judgment call, flagged.
- `PromptAssembly` gets the new `intent: z.string().nullish()` field (3d above); update `assemblePrompt()`'s returned `assembly` object.

### 5b. `reviewer-core/src/review/run.ts`

`ReviewInput` (lines 44-93) needs a new `intent?: string` field, and the `promptParts` object built at lines 130-139 needs `intent: input.intent` added — `assemblePrompt()` alone doesn't wire anything into the actual review call without this; `reviewPullRequest()`'s own input/promptParts construction is a second, necessary edit site.

## 6. Scope-based finding filtering

The spec requires: "comments outside declared scope are filtered out, but one signal is preserved if a serious issue is found outside the PR's stated bounds." This is deterministic post-processing, not just prompt context — proposed design (**explicitly this plan's own inference, not spec-given mechanics — flag for user confirmation before building**, since a deterministic file-path-matching alternative also exists and would avoid trusting the model's own scope judgment):

- `Finding.in_scope: z.boolean().nullish()` (3d above) — set by the **reviewing LLM itself**, informed by the injected `## Derived intent` section's trusted instruction trailer (5a above). Only the model can judge scope-relatedness semantically; string-matching a finding's file/title against free-text `out_of_scope` bullets would be far less reliable than letting the same model that already read the diff and the intent make the call.
- New pure function in `reviewer-core/src/review/reduce.ts`, alongside `scoreFromFindings`/`reduceReviews` (same file, same "pure, no I/O, determinism-over-model-self-report" philosophy already documented there for `score`):
  ```ts
  export function filterByScope(findings: Finding[]): { kept: Finding[]; dropped: Finding[] } {
    // Only ordinary findings are scope-filtered — safety-critical kinds
    // (secret_leak, lethal_trifecta, phantom, hook) always pass through,
    // regardless of the PR's declared scope.
    const scoreable = findings.filter((f) => (f.kind ?? 'finding') === 'finding');
    const exempt = findings.filter((f) => (f.kind ?? 'finding') !== 'finding');
    const inScope = scoreable.filter((f) => f.in_scope !== false);
    const outOfScope = scoreable.filter((f) => f.in_scope === false);
    // Preserve AT MOST ONE out-of-scope finding — the highest severity
    // (CRITICAL > WARNING > SUGGESTION), ties broken by higher confidence,
    // then first-seen.
    const bestOutOfScope = outOfScope.sort((a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.confidence - a.confidence,
    )[0];
    const kept = [...exempt, ...inScope, ...(bestOutOfScope ? [bestOutOfScope] : [])];
    const dropped = outOfScope.filter((f) => f !== bestOutOfScope);
    return { kept, dropped };
  }
  ```
- Wired into `reviewPullRequest()` (`reviewer-core/src/review/run.ts`), **after** the citation-grounding gate and **before** `scoreFromFindings`, and **only when `input.intent` was actually provided** (no intent → no declared scope → skip filtering entirely, so a review run without intent behaves exactly as it does today). Reuses the existing `ReviewOutcome.dropped: {finding, reason}[]` field (already used for grounding drops) rather than adding a parallel field.
- **Explicitly flagged for confirmation**: (1) the severity-then-confidence tie-break rule for "which one out-of-scope finding survives" is this plan's own proposal; (2) whether scope-filtering should apply during map-reduce's per-chunk partial reviews or only once on the final merged set (this plan applies it once, post-merge, post-grounding); (3) whether a deterministic file-path-based filter is preferred over trusting the model's own `in_scope` self-tag — this plan recommends the model-tag approach because `out_of_scope` bullets are free-text, not file globs, but this is a real design fork worth explicit sign-off.

## 7. UI changes

### 7a. Settings

`SettingsModels.tsx` already renders the "PR Review · Intent" picker end-to-end — **no new UI code needed**, only a verification pass, plus the default-model fix.

**Default-model fix (both vendor copies, confirmed by the user's spec)**: `server/src/vendor/shared/contracts/platform.ts:52-57` and `client/src/lib/feature-models.ts:22-27` — change `defaultProvider: 'openai', defaultModel: 'gpt-4.1'` → `defaultProvider: 'openrouter', defaultModel: 'deepseek/deepseek-v4-flash'`.

### 7b. Results display — new `IntentCard` on `OverviewTab.tsx`

**Verified real file paths, superseding an earlier draft's `FindingsTab` placement:**

- PR detail page: `client/src/app/repos/[repoId]/pulls/[number]/page.tsx`. Tabs are `?tab=` query-param-driven with plain conditional rendering (no nested `layout.tsx`): `overview` → `OverviewTab`, `findings` → `FindingsTab` (tab-bar label "Agent runs"), `diff` → `DiffTab` (tab-bar label "Files changed"). Tab bar: `PrDetailHeader.tsx` (`client/src/app/repos/[repoId]/pulls/[number]/_components/PrDetailHeader/PrDetailHeader.tsx:111-120`).
- `OverviewTab.tsx` (`client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx`) is the correct home — confirmed real, already routed, currently near-empty (only renders the raw `prBody` in a `<section>` under `SectionLabel icon="MessageSquare"`, lines 11-22). The mockup's "PR BRIEF" card (verdict/score) does **not** exist today — `VerdictBanner` only renders per-run inside `ReviewRunAccordion` on the Agent-runs tab, not as a PR-level aggregate on Overview — building that aggregate is **out of scope** for Intent Layer. Likewise the mockup's "BLAST RADIUS" column is a wholly separate, unbuilt feature — already out of scope. **Do not build a two-column layout waiting for either** — a single full-width `IntentCard`, placed above the existing Description `<section>`, is sufficient.
- "Show intent before review results" is satisfied **trivially by tab separation** — Overview and Agent-runs are already different tabs, so no within-tab ordering trick is needed.
- No existing 2-column card-grid convention exists in this codebase — don't invent one. Style `IntentCard` either via the `Card` primitive (`client/src/vendor/ui/primitives/Card.tsx`) or hand-styled like `VerdictBanner`'s wrap — `Card` is the lower-effort default.

**Component + data:**

- New component: `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/_components/IntentCard/` (`IntentCard.tsx`, `IntentCard.test.tsx`, `index.ts`) — nested under `OverviewTab/_components/` per `frontend-ui-architecture`'s "nest `_components/` again once a component folder grows internal subcomponents" rule.
- `OverviewTab.tsx` currently takes only `prBody` as a prop (pure, presentational, lines 7-9) — it needs `prId` added as a prop (threaded from `page.tsx`) so `IntentCard` can fetch by id. Keep `OverviewTab` itself free of any fetching logic — the actual `useQuery`/`useMutation` calls live inside `IntentCard`.
- New hooks in `client/src/lib/hooks/reviews.ts`:
  ```ts
  export function usePrIntent(prId: string | null | undefined) {
    return useQuery({
      queryKey: ["pr-intent", prId],
      queryFn: () => api.get<PrIntentRecord | null>(`/pulls/${prId}/intent`),
      enabled: !!prId,
    });
  }

  export function useDeriveIntent(prId: string | null | undefined) {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: () => api.post<PrIntentRecord>(`/pulls/${prId}/intent/derive`),
      onSuccess: (data) => qc.setQueryData(["pr-intent", prId], data),
    });
  }
  ```
  `useDeriveIntent` mirrors `useExtractConventions`'s exact shape (`client/src/lib/hooks/conventions.ts:34-42`).
- Render: `intent` text (the "summary") + `in_scope`/`out_of_scope` bullet chips (`Badge` from `@devdigest/ui`) + `evidence_tier` as its own qualitative `Badge` (e.g. "Inferred from branch/commits/file names — low confidence" for `indirect_only`) — **no `ConfidenceNum`, no numeric percentage anywhere in this card**.
- Re-derive button: model on the Conventions "Rescan" pattern (`client/src/app/repos/[repoId]/conventions/page.tsx:113-120` + `useExtractConventions`) — **not** `RunReviewDropdown`. Button states: idle → "Derive intent" / "Re-derive" → "Deriving…" while pending, `icon="RefreshCw"`.
- Empty state: `usePrIntent` returning `null` (never derived) → render the card with just the re-derive button and a short empty-state line, not `null`/nothing.
- i18n: check for an existing unused `messages/en/*.json` namespace matching this feature before writing new copy from scratch.

## 8. Logging changes

### 8a. Automatic path — mirrors `'Loading PR diff'` exactly

```ts
await runLog.step(
  'Deriving PR intent',
  () => this.container.intentDeriver.derive({ workspaceId, pull, repo, diff, log: runLog }),
  { kind: 'tool' },
);
```

### 8b. Inside `IntentDeriverService.derive()`, required log content

Per the spec's explicit observability requirement — log **prompt components** (section labels only, never full content), the **selected provider/model**, an **estimated/actual token count**, and the **intent sources list** — never secrets or raw diff/hunk-body content:

- `log.tool('Fetching linked issue #N', { number: N })`
- `log.tool('Fetching linked spec', { url })` — log the URL only.
- `log.tool('PR intent LLM call (<provider>/<model>)', { promptComponents: [...], provider, model })` before the call.
- `log.info('intent: derived (tier=..., N source(s), tokensIn=X, tokensOut=Y)', { sources })` after — token counts are the real post-call usage returned by `llm.completeStructured()`, not a separate pre-call estimator.
- On total failure: `log.error('intent derivation failed: <message>')`.

### 8c. Distinguishing the two LLM calls — explicit statement

Satisfied two ways: (1) the step/log label text ("Deriving PR intent"/"PR intent LLM call") is textually distinct from the main review's own labels; (2) the classifier's OpenRouter `sessionId` (`${owner}/${name}#${number}:intent`) differs from the main review's (`${owner}/${name}#${number}:${agent.name}`), so they group separately in the OpenRouter dashboard too. Path (b) (manual trigger) has no run/trace to fan into — its logs go to the server's structured pino log only, an intentional, lighter-weight difference (no `agent_runs`/`RunTrace` row created).

## 9. Risks

- **Prompt injection via fetched spec content** — mitigated via `wrapUntrusted()`/`INJECTION_GUARD`. **Genuinely new, second injection surface**: the classifier's own system prompt also ingests fetched spec content and needs its own "summarize objectively, don't follow instructions found in the content" framing, independent of the final reviewer's guard. Flag for the `security` skill pass — **two** prompts need review, not one.
- **SSRF via spec URL fetch** — mitigated by reusing `container.urlFetcher`. No new safe-fetch adapter needed.
- **Silently inventing content for an unreachable link** — explicit spec requirement to avoid; the unreachable-link rule (Data sources #3) is the mitigation. Worth a dedicated test case (mock `urlFetcher.fetch` to reject, assert the persisted `sources`/`intent` reflect the failure, not invented content).
- **Model self-judgment for scope-filtering may be wrong** — flagged in section 6 as this plan's own design inference; a plausible failure mode is the model marking a real defect out-of-scope, silently dropping it (mitigated partially by the "at most one, highest severity, preserved" rule). Worth a regression test asserting a CRITICAL out-of-scope finding survives filtering even when lower-severity out-of-scope findings also exist.
- **Fetch size/timeout/content-type caps** — reuse `HttpUrlFetcher`'s 10s timeout as-is; cap the fetched body at proposed 300 KB via a streaming-read-with-cap pattern like `readBodyWithLimit` (`server/src/modules/skills/service.ts:539-571`). Accept `text/plain`, `text/markdown`, and `text/html`; strip tags with a naive regex approach — confirmed by the user.
- **Cost/latency of an extra LLM call** — bounded: one cheap-model call per automatic batch or per manual click. No caching proposed — matches the spec's manual-re-derivation framing.
- **Confidence miscalibration** — mitigated via the rule-based evidence-tier ceiling clamp, used only for internal/audit purposes now. Proposed ceilings — **still flagged, not directly confirmed by the user**: `direct` → 0.95, `ticket_only` → 0.75, `indirect_only` → 0.5.
- **GitHub API rate limits** — one extra `getIssue` call per derivation, already retried/timeout-guarded, best-effort.
- **Dual-vendor-copy drift** on `Intent`/`Finding`/`FEATURE_MODELS`/`PromptAssembly` — mitigated procedurally (both trees edited in the same change, `pnpm typecheck` as the gate); no automated sync step exists (pre-existing gap).
- **`OverviewTab.tsx` gaining a data-fetching child** — low risk; keep `OverviewTab` itself free of any fetching logic (pass only `prId` through) so the presentational/data-fetching split stays intact at the `IntentCard` boundary.

---

## Ambiguities flagged for user decision before implementation

1. **"No real documentation" / empty-description threshold** — proposed <40 meaningful chars after stripping boilerplate.
2. **Evidence-tier confidence ceilings** — proposed 0.95 / 0.75 / 0.5; still a judgment call, not directly addressed by the user's spec.
3. **Scope-filtering mechanics** (section 6) — this plan's own proposed design (model self-tags `in_scope`; server keeps all in-scope + at most one out-of-scope, severity-then-confidence tie-break, applied once post-merge/post-grounding) is an inference from the spec's one-sentence requirement — a real design fork (vs. deterministic file-path matching) worth explicit sign-off.
4. **Manual re-derive empty state** — proposed: `IntentCard` always renders (with a "Derive intent" CTA before first derivation), not hidden until a review has run.
5. **`OverviewTab` prop threading** — proposed adding `prId` as a new prop (currently only takes `prBody`); low-risk mechanical change, noted for completeness.

**File paths of note for the implementer:** `server/src/modules/intent/{types,service}.ts` (new, no repository/routes), `server/src/modules/reviews/{run-executor,routes,service}.ts`, `server/src/modules/reviews/repository/pull.repo.ts` + `repository.ts`, `server/src/db/schema/reviews.ts` + new migration, `server/src/vendor/shared/contracts/{brief,findings,platform,trace}.ts` and the identical `client/src/vendor/shared/contracts/*` copies, `server/src/platform/container.ts`, `server/src/adapters/mocks.ts`, `reviewer-core/src/prompt.ts`, `reviewer-core/src/review/run.ts`, `reviewer-core/src/review/reduce.ts`, `client/src/lib/hooks/reviews.ts`, `client/src/lib/feature-models.ts`, `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/{OverviewTab.tsx,_components/IntentCard/}`, `client/src/app/repos/[repoId]/pulls/[number]/page.tsx`.

---

## Implementation & Review

Implemented by the `implementer` agent per this plan, then independently checked by `architecture-reviewer` and `plan-verifier` in parallel (per this repo's session protocol). No fixes were applied automatically from either review — findings were shown with evidence first; the one actionable gap (i18n) was fixed afterward on explicit request.

### What was built

All 9 numbered plan sections were implemented as specified: intent derivation (`server/src/modules/intent/service.ts`), the two call sites (automatic in `run-executor.ts`, manual via `POST /pulls/:id/intent/derive`), schema growth (`pr_intent.{confidence,evidence_tier,sources}`, `findings.in_scope`, migration `0017_simple_violations.sql`, applied), both `GET`/`POST` routes, prompt-builder wiring (`PromptParts.intent`, `wrapUntrusted` + trusted scope-tagging trailer), the `filterByScope()` pure reducer, the `IntentCard` on `OverviewTab.tsx`, and dual-session-id logging. The 5 items this plan explicitly left as the implementer's judgment call (empty-description threshold, confidence ceilings, scope-filter tie-break, empty-state UI, `OverviewTab` prop threading) were implemented exactly as this plan's own proposed defaults — not deviations.

Verification commands re-run (not self-attested) by `plan-verifier`, all green: `pnpm typecheck` / `npm run typecheck` in all three packages; `server`'s full unit suite (29 files, 288 tests) and integration suite (12 files, 65 tests, real Postgres via testcontainers, including a re-run of `reviews.it.test.ts` specifically to confirm no real OpenRouter call fires); `client` (26 files, 127 tests); `reviewer-core` (3 files, 26 tests).

### architecture-reviewer findings

Checked module boundaries (`modules/intent/` has no `repository.ts`/`routes.ts`), dependency direction (no adapter constructed outside `container.ts` — confirmed via repo-wide grep for `new IntentDeriverService`), contract mirroring (byte-identical `diff` between both `server`/`client` vendor copies of `brief.ts`/`findings.ts`/`trace.ts`), cohesion (`reviewer-core` stays I/O-free — only `OpenRouterProvider`'s pre-existing `fetch` call exists in that tree), data flow (full chain read manually: `run-executor.ts` → `container.intentDeriver.derive()` → port-mediated sources → `container.reviewRepo.upsertIntent()` → `PromptParts.intent` → `reviewPullRequest()`), and prompt-assembly placement (`## Derived intent` section positioned correctly in `prompt.ts:143-151`; the trusted scope-tagging instruction sits genuinely outside `wrapUntrusted()`'s closing tag).

**Result: clean.** One WARNING — `IntentCard/` had no `.test.tsx` file, expected per the explicit decision to defer tests this iteration.

### plan-verifier findings

Independently re-ran every verification command rather than trusting the implementer's report (none existed on disk — reconstructed from `git diff`). All 9 plan sections: **PASS**, each backed by file:line evidence. All 5 architectural constraints: **PASS**. All 5 self-reported implementer deviations (evidence-tier boundary resolution, token-logging source, Status-line update, the `reviews.it.test.ts` hermeticity fix, `contracts.test.ts` fixture update): verified real and accurately described, not just claimed.

Two gaps identified, both unrelated to the tests-deferred decision:
1. **i18n namespace check skipped** — this plan explicitly instructed checking for an existing unused `messages/en/*.json` namespace before hardcoding new UI copy; `client/messages/en/brief.json`'s `block.intent` key already existed, unused, and `IntentCard` hardcoded English strings instead of reusing it. **Fixed** post-review: `IntentCard.tsx` now uses `useTranslations("brief")`, `block.intent` is reused for the card title, and a new `intentCard` object was added to `brief.json` for the remaining strings (button/empty-state/error/evidence-tier copy); `constants.ts`'s evidence-tier label map was removed in favor of the i18n keys, keeping only tier→color mapping. Verified: `pnpm typecheck` clean, full client suite (127 tests) still green.
2. **Two Risks-section-recommended regression tests** (unreachable spec link, CRITICAL finding survives scope filtering) not written — consistent with, and tracked under, the same tests-deferred decision as `IntentCard.test.tsx`.

**Overall verdict: PASS** (was "PASS WITH GAPS" before the i18n fix above).

### Deferred to a later iteration

- New test files for `modules/intent/`, `filterByScope()` (added post-review, see below), `IntentCard`, and the two new routes.
- `pr-self-review` (light or full) — runs once a PR is opened, per this repo's session protocol; not applicable to an uncommitted local diff.

### Post-review fixes (PR #15, `pr-self-review` light mode)

`pr-self-review` ran against the opened PR and found 2 CRITICAL + several WARNING/SUGGESTION issues across `drizzle-orm-patterns`, `postgresql-table-design`, `zod`, and `security`. Both CRITICALs were fixed and independently re-verified (evidence_tier now has a DB `CHECK` via migration `0018`; the classifier's zod schema now bounds `intent`/`in_scope`/`out_of_scope` length). The three WARNINGs were fixed next:

1. **Missing index on `pr_commits.pr_id`** (`drizzle-orm-patterns`) — added `pr_commits_pr_id_idx` (migration `0019`); `getPrCommits` runs on every intent derivation.
2. **`confidence`/`evidence_tier` added `NOT NULL` with no `DEFAULT`** (`postgresql-table-design`) — one reviewer round proposed escalating this to CRITICAL citing a pre-existing writer, which turned out to be a misread of this same PR's own commit as "already merged" (verified false via `git grep`/`git log`: `upsertIntent` had zero callers before this PR). Kept at WARNING. First attempt fixed it forward-only (migration `0019` adding `ALTER COLUMN ... SET DEFAULT`, leaving `0017` untouched) — a re-review correctly called this out as **not actually resolving it**: migrations replay strictly in order, so a later migration's `SET DEFAULT` cannot rescue `0017`'s own `ADD COLUMN ... NOT NULL` from failing if that specific statement ever hits a non-empty table. Checked drizzle-orm's postgres-js migrator source (`node_modules/drizzle-orm/pg-core/dialect.cjs`) to confirm it decides what to (re-)run purely by each migration's journal timestamp, never by a content hash — so editing an already-pushed, already-locally-applied migration file is safe here (it won't replay against a DB that's already past its timestamp). Fixed properly: `0017` now sets the defaults inline (`DEFAULT 0` / `DEFAULT 'indirect_only'`), matching the sibling `sources` column's original pattern exactly; `0019` keeps only the `pr_commits` index. Verified via a fresh testcontainers Postgres run (no prior state) applying the full corrected chain end-to-end.
3. **Scope-filter could silently drop a genuine finding** (`security`) — this is exactly the failure mode flagged in this plan's own §9 Risks ("a plausible failure mode is the model marking a real defect out-of-scope, silently dropping it") and §"Ambiguities" (model self-judgment for scope-filtering may be wrong), never fully closed by the original "at most one, highest-severity, preserved" design. **Behavior change**: `filterByScope()` (`reviewer-core/src/review/reduce.ts`) no longer drops any out-of-scope finding — every one is kept, softened by exactly one severity rank (`CRITICAL→WARNING→SUGGESTION`, floored at `SUGGESTION`). A crafted PR description can now only understate a finding's severity, never erase it from the persisted findings list. `run.ts`'s `filterByScope` call site and the `dropped` bookkeeping were updated to match (`{ kept, downgraded }` instead of `{ kept, dropped }`); 4 new tests added in `reviewer-core/test/reduce.test.ts` (previously the only file with zero coverage for this reducer) pin the new behavior, including the two Risks-section-recommended regression tests (a CRITICAL out-of-scope finding survives, safety-critical kinds pass through untouched).

Verification re-run after all fixes: `pnpm typecheck` clean in `server`/`reviewer-core`; `server` unit (29 files, 288 tests) + integration (12 files, 65 tests, real Postgres via testcontainers — migrations `0018`/`0019` applied fresh in that run) all green; `reviewer-core` (4 files, 30 tests, +4 new) green.
