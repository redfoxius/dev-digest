# PR Why + Risk Brief

**Status:** not started

## Spec
- `specs/cross-cutting/pr-why-risk-brief/spec.md` (SPEC-2026-08-20-pr-why-risk-brief, draft, 31 ACs, zero open `[NEEDS CLARIFICATION]` markers)

## Context

Adds a fourth, additive Overview-tab capability: a composed LLM "Why + Risk
Brief" (`what`/`why`/`risk_level`/`risks[]`/`review_focus[]`) over a PR's
already-derived Intent, deterministic Blast Radius summary, diff stats,
linked issue, and a **brand-new** top-K cosine-similarity search over
Project Context spec chunks (excluding source-code chunks). Fills the
existing, empty `pr_brief` table (one row per PR, overwritten in place —
no new table or migration). New `GET`/`POST /pulls/:id/brief` routes. One new
field on `GET /pulls/:id` (`risk_level`). Four additive client changes to
the existing Overview tab. `PrBriefBanner`/`IntentCard`/`BlastRadiusCard`
are never merged/replaced/removed (settled, non-negotiable).

**Corrections to the spec's own file citations** (verified against actual
source before planning, per this agent's brief):
- The spec's §0 Related list cites `server/src/modules/intent/service.ts` +
  **`routes.ts`** as the GET+POST/derive precedent. `intent/routes.ts` does
  **not exist** — `intent/` only has `service.ts` + `types.ts`. The actual
  `GET /pulls/:id/intent` + `POST /pulls/:id/intent/derive` routes live in
  `server/src/modules/reviews/routes.ts:149-171`, calling
  `ReviewService.getIntent`/`deriveIntent`
  (`server/src/modules/reviews/service.ts:207-238`). The mirrored route
  *shape* (GET-persisted-never-derives, POST-derive-with-tight-rate-limit)
  is identical to what the spec describes — only the file location differs.
  Work Items below cite the real files.
- AC-25 parenthetically states "`DEFAULT_TIMEOUT` = 300000 ms" — the actual
  current constant (`server/src/adapters/llm/openai.ts:15`,
  `anthropic.ts:16`) is `900_000`. The AC's operative requirement ("bound by
  the platform's existing default … unless a tighter `timeoutMs` is
  configured") is satisfied by simply omitting `timeoutMs` from the
  `completeStructured` call regardless of the numeric value — not a spec
  gap, just stale documentation inside the spec; implementer should not
  hardcode `300000`. **Fixed in spec.md** (2026-08-20 revision) to reference
  the constant, not a restated number.

**Corrections after a 2026-08-20 independent cross-model review** of this
spec+plan pair (a fresh agent, different model, verified every citation
against the real codebase before this plan's Work Items below were
revised — this is not a second round of guessing, every item below was
confirmed by reading the actual file cited):

1. **The DB design was wrong.** `server/src/db/schema/reviews.ts:140-145`
   already has an empty `pr_brief` table (`{pr_id PK/FK cascade, json jsonb
   NOT NULL}`), shipped in `0000_init.sql` — one of this codebase's
   pre-provisioned "future lesson fills this in" tables (root `CLAUDE.md`).
   The original WI-2 below created a parallel `pr_risk_brief` table instead
   of reusing it. **Fixed**: this feature now fills `pr_brief` — no new
   migration at all. `RiskBrief`'s full shape (incl. audit fields) is
   stored verbatim in the `json` column; `risk_level` enum validity is
   enforced only at the zod/application layer, not a DB `CHECK` (accepted
   trade-off — the column offers no per-field DB constraints today anyway).
2. **The similarity search (WI-3) would leak source code into the prompt.**
   `code_chunks.source` (`server/src/db/schema/context.ts:45-47`) is an
   enum `['code','docs','spec','insights']` defaulting to `'code'`; the
   original WI-3 ranked ALL embedded chunks regardless of `source`. **Fixed**:
   WI-3 now filters to `source IN ('docs','spec','insights')` before
   ranking — never `'code'` (violates AC-27/AC-29 otherwise).
3. **AC-24's flagged-dot indicator was unreachable.** The original grounding
   scope (WI-6's `validPaths`) omitted `downstream[].callers[].file` — but
   `BlastRadiusCard`'s flagged rows ARE caller rows, and a caller is
   "frequently a file this PR never touched"
   (`BlastRadiusCard.tsx:16-19`), so a `risks[].file_refs` entry citing one
   would always get grounded away by AC-10 before ever reaching the client.
   **Fixed**: AC-10/WI-6 widened to accept caller files for `risks[]`
   grounding (not `review_focus[]`, which stays diff-only by design).
4. **AC-23's risk badge was unreachable for the common case.**
   `PrBriefBanner.tsx:21-23` early-returns an empty-state div whenever
   `verdict == null` (i.e. before any review has run) and never reaches
   where the badge would render — exactly the moment a Risk Brief (which
   doesn't depend on a review having run) would be most useful. Also, the
   component's actual props are `verdict`/`score`/`findings`/`costUsd`, not
   a single `pr` object — the original AC-23/WI-12 wrongly assumed one.
   **Fixed**: AC-23/WI-12 now require the badge in BOTH branches; prop
   naming corrected to the real `riskLevel` prop.
5. **The client-i18n INSIGHTS citation was itself wrong.**
   `client/INSIGHTS.md`'s 2026-08-09 entry claims `IntentCard` is hardcoded
   English — but `IntentCard.tsx:4,28` actually calls
   `useTranslations("brief")`. Only bare `OverviewTab.tsx` has no
   `next-intl` usage. **Fixed**: WI-10's new card and any new copy in
   `IntentCard`/`PrBriefBanner` now use real `next-intl` keys, not
   hardcoded English; the stale INSIGHTS entry itself should be corrected
   during implementation (flagged for `engineering-insights`).

Everything else the review checked came back confirmed accurate: AC
traceability (all 31 ACs claimed by ≥1 WI), the React-Query dedup
assumption (sound — one `QueryClient`, `staleTime: 30_000`), `intent/routes.ts`
not existing, the real `DEFAULT_TIMEOUT`, `context-docs` having no prior
similarity method, `risk_brief`'s registry entry, the TDZ ordering, and
`handleViewInDiff` vs `handleCallerClick` being genuinely distinct.

## Scope

- In scope: everything in spec §6 (AC-1–AC-31) — new `context-docs`
  similarity search, filling the existing empty `pr_brief` table (no new
  table/migration), new routes+service, `GET /pulls/:id` enrichment, and
  the four client changes (new card,
  `PrBriefBanner` badge, `BlastRadiusCard` flagged-dot, `IntentCard` merge).
- Out of scope (per spec §12): populating the existing unused `PrBrief`
  composed type; any change to `GET /pulls/:id/blast`'s deterministic
  `summary` or dependency on the (unimplemented) blast-radius-LLM-summary
  spec; auto-triggering Intent derivation; MCP exposure; cache
  eviction/GC; `IntentCard` surfacing `review_focus[]`; any relevance-search
  capability beyond the single top-K cosine method (no public search route,
  no hybrid search, no configurable threshold).

## Modules Touched

- `server/src/modules/risk-brief/` (new module — routes/service/repository/constants/prompt/grounding)
- `server/src/modules/context-docs/` (new similarity-search capability)
- `server/src/modules/pulls/routes.ts:267-341` (`risk_level` enrichment, both return branches)
- `server/src/modules/index.ts` (module registration)
- `server/src/db/schema/reviews.ts:140-145` (existing, empty `pr_brief` table — this feature fills it; no schema change, no migration)
- `server/src/vendor/shared/contracts/brief.ts` + `platform.ts` (new contracts)
- `client/src/vendor/shared/contracts/brief.ts` + `platform.ts` (hand-copied twin, same change — non-default convention, root `CLAUDE.md`)
- `client/src/lib/hooks/risk-brief.ts` (new)
- `client/src/lib/risk-severity.ts` (new — promoted shared color map)
- `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/**` (new card + 3 existing cards' enrichment)
- `client/src/app/repos/[repoId]/pulls/[number]/page.tsx` (new prop wiring)

## Architectural Constraints

- `onion-architecture` (CRITICAL): `risk-brief/service.ts` must never import
  `drizzle-orm` — persistence goes through a new `risk-brief/repository.ts`,
  the only file in the module allowed to import it
  (`.claude/skills/onion-architecture/SKILL.md` "Module Anatomy"). No new
  external dependency is introduced (LLM/GitHub/embedder ports already
  exist), so no new port/adapter is needed — only new `Container`
  *consumption*, no new `Container` *members*.
- Every external read this feature needs already has a port-typed
  accessor: `container.reviewRepo.getIntent`, `container.repoIntel` (via
  `BlastService`), `container.github()`, `container.llm(provider)`,
  `container.embedder()` (via `ContextDocsService`). No new adapter.
- `RiskBriefService` must be instantiated directly in `risk-brief/routes.ts`
  (constructor takes `Container`), exactly like `BlastService`
  (`server/src/modules/blast/routes.ts:21`) and `ReviewService` — never
  registered as a new `Container` getter (this module owns no
  cross-module-shared repository).
- Pure-function extraction precedent (`server/INSIGHTS.md`, 2026-08-09 —
  "split the algorithm into a pure function… service method stays a thin
  fetch-then-delegate wrapper", reused again 2026-08-20 for
  `assembleOnboardingFacts`): the prompt-assembly/trim logic (AC-7/AC-8/AC-9)
  and the grounding/bounding logic (AC-10/AC-11/AC-12) must each be
  exported top-level pure functions taking already-fetched facts in and
  returning a result — no `Container`, no DB — mirroring
  `intent/service.ts`'s own `filterRiskFileRefs`
  (`server/src/modules/intent/service.ts:368-385`). This is what makes
  AC-8/AC-9/AC-10/AC-11/AC-12's "unit test with a mocked LLM
  response…" verification language achievable without Postgres.
- `frontend-ui-architecture` (CRITICAL — business-logic placement): all new
  client data fetching goes in `client/src/lib/hooks/risk-brief.ts`
  (one hook file per API domain), never inline in a component body.
- `frontend-ui-architecture` (constants promotion rule): `RISK_SEVERITY_COLOR`
  currently lives at
  `OverviewTab/_components/IntentCard/constants.ts:22-29`, scoped to that
  one folder. This feature makes it a genuine 3-folder consumer
  (`IntentCard`, `PrBriefBanner`, `BlastRadiusCard`) plus the new card — the
  skill's own rule ("promote once reused across 2+ *unrelated* component
  folders") is triggered exactly here; importing `IntentCard`'s internal
  `constants.ts` from three sibling, unrelated `_components/` folders would
  violate the skill's unidirectional-flow rule even though they share a
  grandparent (`OverviewTab`). Promote to `client/src/lib/risk-severity.ts`
  (Work Item below) rather than cross-importing.
- `postgresql-table-design` / `drizzle-orm-patterns`: **no new table, no
  migration** (corrected post-cross-model-review — see Context). This
  feature reuses the existing `pr_brief` table
  (`server/src/db/schema/reviews.ts:140-145`,
  `{pr_id uuid PK/FK cascade, json jsonb NOT NULL}`, already in
  `0000_init.sql`). Type the column via Drizzle's `.$type<RiskBrief>()`
  cast on read (the column itself stays untyped `jsonb` at the schema
  level — it's a pre-existing shared table, not owned by this feature
  alone); validate with `RiskBrief.parse(row.json)` after read, since
  jsonb round-trips as `unknown`. Accepted trade-off: `risk_level` enum
  validity has no DB-level `CHECK` (the column offers no per-field
  constraints today regardless). No new index needed — always a
  single-PR lookup by PK.

## Relevant INSIGHTS.md Gotchas

- `server/INSIGHTS.md` (2026-08-09): the `risk_brief` `FeatureModelId`'s
  registry default (`openai`/`gpt-4.1`) has never been checked against a
  real cost requirement, unlike `review_intent`/`conventions` which were
  fixed to a cheap model once a real feature landed on them. §4 of this
  spec explicitly settles "reuse as-is, no new registry entry" — do **not**
  change the default as part of this feature; flag it back to the course
  owner separately if it turns out too expensive in practice, but don't
  quietly "fix" it here (that would relitigate a settled spec decision).
- `server/INSIGHTS.md` (2026-08-14, TDZ entry): `brief.ts`'s `Risk`/
  `RiskSeverity` are declared *before* `Intent` in both vendor copies
  specifically so `Intent.risks: z.array(Risk)` doesn't reference a
  not-yet-evaluated `const`. Add `RiskBrief`/`ReviewFocusItem` *after* both
  `Risk` and `BlastRadius` (since `RiskBrief.risks` reuses `Risk` and
  nothing in `BlastRadius` needs to reference the new types) — verify this
  ordering constraint against the file's actual current layout before
  writing, don't assume from the spec's prose.
- `server/INSIGHTS.md` (2026-08-14): a bare `.optional()` on a field
  destined for LLM structured output triggers an OpenAI `zodResponseFormat`
  warning ("not supported… will become an error"). The `risk_brief` model
  default is `openai`/`gpt-4.1`, so this is directly live here — the
  classifier-facing zod schema (distinct from the persisted `RiskBrief`
  contract, exactly as `IntentDerivation` is distinct from `Intent`) must
  use `.nullish()` for any optional field, never `.optional()`.
- `server/INSIGHTS.md` (2026-08-09, `FEATURE_MODELS` non-cheap-default) —
  already covered above; don't silently "fix" it.
- `server/AGENTS.md` Gotchas: `REPO_INTEL_ENABLED` defaults to true but an
  unindexed repo silently degrades — `BlastService.getBlastRadius` already
  returns `{degraded: true, reason}` in that case (`blast/service.ts:81`);
  the Risk Brief input-assembly must treat that exactly like the spec's §5
  failure contract says (empty blast section, grounding falls back to diff
  paths only) — don't let a degraded Blast response throw.
- `client/INSIGHTS.md` (2026-08-09) — **stale/wrong, corrected by the
  2026-08-20 cross-model review**: it claims `IntentCard` uses hardcoded
  English, but `IntentCard.tsx:4,28` actually calls
  `useTranslations("brief")`. Only bare `OverviewTab.tsx` itself has no
  `next-intl` usage. So: the new card (WI-10) should use real i18n too
  (extend the `brief` namespace, matching `IntentCard`'s own pattern, not
  hardcode English), and `PrBriefBanner`'s risk-badge copy (WI-12) adds
  real keys to `messages/en/prReview.json` (e.g.
  `riskBadge.high`/`medium`/`low`) since that file already uses
  `useTranslations("prReview")`. Correct the stale INSIGHTS entry itself
  as part of this implementation's `engineering-insights` pass.
- `client/INSIGHTS.md` (2026-08-06, `EmptyState`/`ErrorState` title/cta
  text collisions): if the new card's empty/error copy reuses `EmptyState`/
  `ErrorState` primitives, watch for the same `title`===`cta` (or
  `title`===`body`) RTL query collision documented there — use
  `getAllByText`/role-scoped queries in the new card's tests, not a bare
  `getByText`.
- `client/INSIGHTS.md` (2026-08-14, `next-intl` `MISSING_MESSAGE`): any RTL
  test that mounts `OverviewTab` (now transitively including the new card)
  must supply every namespace a descendant unconditionally calls
  `useTranslations` for — `OverviewTab.test.tsx` likely needs no new
  namespace (new card is hardcoded-English per above), but `PrBriefBanner`
  gains new `prReview` keys, so its own test fixture's `prReview` namespace
  object needs those new keys added, not just a namespace presence check.

## Skills Implementer Will Need

- `onion-architecture` — every new server file (`risk-brief/{routes,service,repository,constants,prompt,grounding}.ts`, `context-docs/{similarity,repository,service}.ts` changes) must respect the routes→service→repository chain; only `repository.ts` imports `drizzle-orm`.
- `zod` — the new `RiskBrief`/`ReviewFocusItem`/`RiskBriefGenerateResult` contracts (both vendor copies) and the classifier-facing structured-output schema (`.nullish()` not `.optional()` per the INSIGHTS gotcha above); `POST` body validation.
- `drizzle-orm-patterns` / `postgresql-table-design` — typed jsonb read/write (`.$type<RiskBrief>()` + zod re-validation) against the existing `pr_brief` table (no migration), and the `context-docs` similarity-search repository read (with its `source` filter).
- `fastify-best-practices` — the two new routes (`GET`/`POST /pulls/:id/brief`), rate-limit config mirroring `/pulls/:id/intent/derive`, module registration in `modules/index.ts`.
- `security` — AC-27 (no secrets/env/raw-file content in the prompt — verify the `prompt_assembly` log event lists only section types/lengths, never content, mirroring `intent/service.ts:158-190`); the untrusted-input wrapping in §11; workspace-ownership scoping (AC-3/AC-26).
- `frontend-ui-architecture` — the new `RiskBriefCard` folder anatomy, the `client/src/lib/hooks/risk-brief.ts` domain hook file, the `RISK_SEVERITY_COLOR` promotion to `client/src/lib/risk-severity.ts`, and where the `flaggedRefs`-derivation helper and `IntentCard`'s title-dedup merge helper each belong (colocated vs. `lib/`).
- `react-best-practices` — the new card's loading/error/empty-state early-return pattern (mirroring `IntentCard`/`BlastRadiusCard`), `useMemo` for the parent-derived `flaggedRefs` Map (recomputed only when the brief/risks data changes, not on every render), accessible names for keyboard-operable review-focus rows (AC-28).
- `react-testing-library` — component tests for the new card, `PrBriefBanner`, `BlastRadiusCard`, `IntentCard`; watch for the two documented collision gotchas above.

## Work Items

1. **Shared contracts — `RiskBrief`/`ReviewFocusItem`/`RiskBriefGenerateResult`, and `PrDetail.risk_level`.**
   Files: `server/src/vendor/shared/contracts/brief.ts` (add `ReviewFocusItem`, `RiskBrief`, `RiskBriefGenerateResult` — placed after the existing `Risk`/`RiskSeverity`/`BlastRadius` declarations per the TDZ-ordering gotcha above), `server/src/vendor/shared/contracts/platform.ts` (`PrDetail = PrDetail.extend({ risk_level: RiskSeverity.nullable() })`, import `RiskSeverity` from `./brief.js`), and the identical edits in `client/src/vendor/shared/contracts/brief.ts` + `platform.ts` (hand-copy convention — both copies in the same Work Item, not left to drift). `RiskBrief` fields per spec §10 table (`what`/`why` ≤600 chars via `z.string().max(600)`, `risk_level: RiskSeverity`, `risks: z.array(Risk).max(8)`, `review_focus: z.array(ReviewFocusItem).max(8)`, `pr_head_sha`, `provider`, `model`, `generated_at`). `RiskBriefGenerateResult = z.object({ brief: RiskBrief.nullable(), cached: z.boolean().optional(), degraded_reason: z.enum(['llm_failed','input_too_large']).optional() })`.
   Depends on: none.
   Acceptance: `pnpm typecheck` clean in both packages; a hand-built literal typed as each new contract compiles.
   Satisfies: AC-12, AC-22 (contract shape only — enforcement lands in later Work Items).

2. **~~DB schema + migration~~ — N/A (corrected post-cross-model-review): reuse the existing `pr_brief` table.**
   No file changes, no `pnpm db:generate`, no new migration. `server/src/db/schema/reviews.ts:140-145` already declares
   `pgTable('pr_brief', {pr_id uuid PK/FK cascade, json jsonb NOT NULL})`, shipped empty in `0000_init.sql`. This
   Work Item is now just a verification step confirming that table's current shape matches what WI-4's repository
   assumes before WI-4 starts.
   Depends on: none.
   Acceptance: `select * from pr_brief limit 1` against a fresh dev DB (post `pnpm db:migrate`, no feature-specific migration) confirms the table exists with exactly `{pr_id, json}`.
   Satisfies: AC-1, AC-2, AC-4, AC-5, AC-6, AC-9 (leaves prior row untouched), AC-12 (persisted cap) — via WI-4's repository, not a schema change.

3. **`context-docs` top-K cosine-similarity search (new capability).**
   Files: new `server/src/modules/context-docs/similarity.ts` (pure, exported `rankBySimilarity(queryEmbedding: number[], chunks: {id, path, content, embedding}[], k: number)` — cosine similarity, descending sort, slice `k`; zero DB/network), `server/src/modules/context-docs/repository.ts` (new `getEmbeddedChunks(repoId): Promise<{id,path,content,embedding}[]>` — `select().from(codeChunks).where(and(eq(repoId,...), isNotNull(embedding), inArray(source, ['docs','spec','insights'])))` — **the `inArray(source, ...)` filter is required** (2026-08-20 cross-model review): `code_chunks.source` (`server/src/db/schema/context.ts:45-47`) defaults to `'code'`, and without this filter the search would rank raw repository source-code chunks into the Risk Brief prompt, violating AC-27/AC-29; the only new drizzle import), `server/src/modules/context-docs/service.ts` (new `ContextDocsService.search(repoId, query, k)`: reuses the existing private `resolveEmbedStatus()` — return `[]` immediately when `status !== 'ready'` (AC-29's explicit degrade), else `embedResolution.embedder.embed([query])`, fetch chunks via the new repository method, delegate to `rankBySimilarity`). No SQL-side `<=>` operator — `code_chunks.embedding` has no vector index today and per-repo chunk counts are small; JS-side ranking also matches this codebase's established "no DB-side aggregate, plain select + JS `Map`/computation" idiom (`server/INSIGHTS.md`, 2026-08-04) and keeps the ranking algorithm hermetically unit-testable without Postgres, per the pure-function precedent above.
   Depends on: none.
   Acceptance: unit test for `rankBySimilarity` (fixed embeddings, known cosine ordering) with no DB; a repository-level or service-level unit test seeding mixed-`source` chunks confirms a `source: 'code'` chunk never appears in results even if its embedding would rank highest; a third test confirms `status !== 'ready'` short-circuits to `[]` with zero embed-provider calls.
   Satisfies: AC-29.

4. **`risk-brief` module scaffolding — constants + repository (over the existing `pr_brief` table).**
   Files: new `server/src/modules/risk-brief/constants.ts` (`RISK_BRIEF_INPUT_TOKEN_BUDGET = 8000`, `MAX_RISKS = 8`, `MAX_REVIEW_FOCUS = 8`, `MAX_WHAT_WHY_CHARS = 600`, `RELEVANT_SPEC_K = 3` — one named-constant module, mirroring `intent/service.ts`'s own `MAX_*` convention per §4's explicit instruction), new `server/src/modules/risk-brief/repository.ts` (`RiskBriefRepository`, the only file in this module importing `drizzle-orm`, both methods against `prBrief` (the existing Drizzle table object for `pr_brief`): `getByPrId(prId)` — `select().from(prBrief).where(eq(prBrief.prId, prId))`, then `RiskBrief.parse(row.json)` since jsonb round-trips as `unknown`; `upsert(prId, brief: RiskBrief)` — `insert(prBrief).values({prId, json: brief}).onConflictDoUpdate({target: prBrief.prId, set: {json: brief}})`).
   Depends on: WI-2 (table-shape verification).
   Acceptance: unit test for the repository against a fake `Db` chain confirms `getByPrId` round-trips a stored `RiskBrief` (including a malformed-`json` case throwing a clear parse error, not a silent `undefined`), or deferred to WI-9's integration test.
   Satisfies: AC-8, AC-9 (constant), AC-1, AC-2, AC-5, AC-6 (persistence primitives).

5. **Input assembly + token-budget trimming (pure function).**
   Files: new `server/src/modules/risk-brief/prompt.ts`. Exported `assembleRiskBriefInput(facts, budget)` taking already-fetched facts (intent snapshot or null, blast summary + `changed_symbols`/`downstream`, diff file list + hunk headers, linked-issue title/body or null, relevant-spec excerpts array) and returning `{ sections: string[]; estTokens: number; droppedInputTooLarge: boolean }`. Wraps every PR-influenced/repo-content section via `wrapUntrusted()` (`@devdigest/reviewer-core`) exactly as `intent/service.ts:335-351` does; PR title stays unwrapped (§11, matching `intent/service.ts`'s own convention). Trim order on AC-8: relevant-spec excerpts → linked-issue body (falls back to title-only) → hunk headers, using `estimateTokens` (`@devdigest/reviewer-core`, chars/4) after each trim step, stopping once ≤ `RISK_BRIEF_INPUT_TOKEN_BUDGET`; never trims file paths, additions/deletions counts, or the issue title. If the minimum-required input (title + diff file list) still exceeds budget after every optional section is dropped, returns `droppedInputTooLarge: true` (AC-9) instead of throwing.
   Depends on: WI-4 (constants).
   Acceptance: unit test with an oversized relevant-spec excerpt confirms the final `estTokens` ≤ 8000 and spec-excerpt content is trimmed before file-path/diff-stat content; a second unit test with an oversized issue body confirms drop-to-title-only happens before hunk headers are touched; a third with an artificially huge diff file list confirms `droppedInputTooLarge: true` and no LLM-adapter awareness needed (pure function, no LLM call inside it).
   Satisfies: AC-7, AC-8, AC-9, AC-27 (shape-level — no secrets/patch content ever enters `facts`).

6. **Grounding + output bounding (pure functions).**
   Files: new `server/src/modules/risk-brief/grounding.ts`. Exported `filterRiskRefs(risks, validPaths)` (mirrors `intent/service.ts`'s `filterRiskFileRefs` — drop a risk's `file_refs` entries not present in `validPaths`, drop the whole risk only if it had refs and none matched), `filterReviewFocus(items, diffFilesToHunks: Map<string, DiffHunk[]>)` (drop an entry whose `file` isn't a diff file, or whose `line` isn't in any of that file's hunks' `newLineNumbers` — AC-10/AC-11), `boundRiskBriefOutput(risks, reviewFocus, what, why)` (slice to `MAX_RISKS`/`MAX_REVIEW_FOCUS`, truncate `what`/`why` to `MAX_WHAT_WHY_CHARS` — AC-12). `validPaths` for `filterRiskRefs` is the union of diff file paths ∪ blast `changed_symbols[].file` ∪ `downstream[].endpoints_affected`/`crons_affected` **∪ every `downstream[].callers[].file`** (2026-08-20 cross-model review: without caller files here, AC-24's flagged-dot indicator on `BlastRadiusCard` would be practically unreachable, since its flagged rows ARE caller rows and callers are "frequently a file this PR never touched" — `BlastRadiusCard.tsx:16-19`). `review_focus[]`'s valid set stays diff-files-only, unchanged — Review Focus is diff-only by design (§2 Glossary).
   Depends on: WI-4 (constants).
   Acceptance: unit test with one fabricated file path in a mocked risk/review_focus set asserts it's dropped while a `risks[].file_refs` entry citing a real caller-only (non-diff) file survives; a second test confirms a `review_focus[].file` citing that same caller-only file is still dropped; unit test with an out-of-hunk-range line asserts that `review_focus` entry alone is dropped; unit test with an oversized mocked LLM response (>8 risks, >8 review_focus, >600-char what/why) asserts truncation to the caps.
   Satisfies: AC-10, AC-11, AC-12.

7. **`RiskBriefService` orchestration.**
   Files: new `server/src/modules/risk-brief/service.ts`. `get(workspaceId, prId)` — ownership check via `container.reviewRepo.getPull` (404 via `NotFoundError` on miss, mirrors `BlastService.getBlastRadius:20-21`), returns persisted brief or `null` (AC-1/AC-2/AC-3/AC-26). `generate(workspaceId, prId, force, logger)` — ownership check; load persisted row; if `!force && row && row.pr_head_sha === pull.headSha` return `{brief: row, cached: true}` (AC-4) with zero further work; else assemble facts: `container.reviewRepo.getIntent(prId)` best-effort (never triggers derive — §4 assumption), `BlastService.getBlastRadius` best-effort (catch/empty on throw per §5), `loadDiff(container, reviewRepo, workspaceId, pull, repo)` for file list/hunk headers, linked-issue via the same `extractLinkedIssueNumber` regex + `container.github().getIssue()` best-effort pattern as `intent/service.ts:94-108` (re-derive the regex locally or export it from `intent/service.ts` — check for an existing export before duplicating), relevant specs via `ContextDocsService.search(repoId, intent?.intent ?? pull.title, RELEVANT_SPEC_K)` (AC-30) each wrapped via `wrapUntrusted('relevant-spec', excerpt)`. Calls WI-5's `assembleRiskBriefInput`; if `droppedInputTooLarge`, persist nothing and return `{brief: null, degraded_reason: 'input_too_large'}` (AC-9) — prior row (if any) untouched. Else resolve provider/model via `resolveFeatureModel(container, workspaceId, 'risk_brief')` (AC-13), `container.llm(provider).completeStructured` with a `.nullish()`-fielded classifier schema (never `.optional()`, per the INSIGHTS gotcha), a `sessionId` correlation id (mirrors `intent/service.ts:156`), and no explicit `timeoutMs` (AC-25 — inherits the adapter's real default). On throw/schema-invalid, catch and return `{brief: null, degraded_reason: 'llm_failed'}`, persisting nothing (AC-14). On success: call WI-6's `filterRiskRefs`/`filterReviewFocus`/`boundRiskBriefOutput`, then `RiskBriefRepository.upsert` (best-effort — swallow a persistence-layer throw and still return the generated brief to the caller, per §5's "Postgres unavailable at persist time" failure contract), return `{brief, cached: false}`.
   Depends on: WI-1, WI-2, WI-3, WI-4, WI-5, WI-6.
   Acceptance: unit tests (fake `Container`/mocked ports, no Postgres) covering: cache-hit zero-LLM-call (AC-4); stale-`head_sha` triggers exactly one LLM call + overwrite (AC-5); `force: true` always regenerates even on a fresh cache hit (AC-6); Intent-absent proceeds with degraded input, never blocks (§4/§8); Blast-degraded proceeds with empty blast section (§5); LLM-throw path leaves a pre-seeded valid row's subsequent `get()` unchanged (AC-14); workspace override resolves a non-default provider (AC-13).
   Satisfies: AC-3, AC-4, AC-5, AC-6, AC-9, AC-13, AC-14, AC-25, AC-26, AC-27, AC-30.

8. **Routes — `GET`/`POST /pulls/:id/brief`, module registration.**
   Files: new `server/src/modules/risk-brief/routes.ts` (`GET /pulls/:id/brief` with `params: IdParams, response: {200: RiskBrief.nullable()}`, no rate-limit override — inherits the app-wide default 120/min, AC-16; `POST /pulls/:id/brief` with `params: IdParams, config: {rateLimit: {max: 10, timeWindow: '1 minute'}}` mirroring `reviews/routes.ts:161-166`'s intent-derive config exactly, body parsed manually via a new `RiskBriefGenerateBody = z.object({force: z.boolean().optional()})`'s `.parse(req.body ?? {})` inside the handler — mirrors `/pulls/:id/review`'s established tolerant-manual-parse precedent (`reviews/routes.ts:30-47`), not a route-level `body:` schema entry, since an empty/absent body must be valid), `server/src/modules/index.ts` (add `import riskBrief from './risk-brief/routes.js';` + registry entry — the file's own comment already anticipates a "brief" module name).
   Depends on: WI-7.
   Acceptance: `*.it.test.ts` (real Postgres) covering AC-1 (seeded row, GET verbatim, zero LLM calls), AC-2 (empty table → `null`), AC-3 (unknown/foreign-workspace id → 404 on both routes), AC-15 (11th POST within 60s → 429).
   Satisfies: AC-1, AC-2, AC-3, AC-15, AC-16, AC-26.

9. **`GET /pulls/:id` — `risk_level` enrichment.**
   Files: `server/src/modules/pulls/routes.ts:267-341` — add one `RiskBriefRepository.getByPrId(pr.id)` read (or a slimmer `getRiskLevel(prId)` repository method returning just the enum) into the **single, already-shared** `prBrief` object computation (`:291-296`: "computed ONCE here, shared by both … never hand-duplicated"), i.e. `const prBrief = { ..., risk_level: row?.riskLevel ?? null }` — **one edit, not two** (2026-08-20 cross-model review: the original wording claimed both return branches at `:307`/`:339` each needed a separate edit, but both already spread this same `prBrief` object via `...prBrief`, so a single change to its construction automatically reaches both).
   Depends on: WI-4 (repository), WI-1 (contract field).
   Acceptance: unit/integration test seeds a `pr_brief` row, asserts `GET /pulls/:id`'s response includes the matching `risk_level` on both the live-GitHub-refresh and offline-fallback code paths (test each by toggling whether a GitHub token/mocked client is configured); a PR with no brief row asserts `risk_level: null` on both paths.
   Satisfies: AC-22.

10. **`RiskBriefCard` — new client component (self-fetching).**
    Files: new `client/src/lib/hooks/risk-brief.ts` (`usePrRiskBrief(prId)` — `useQuery({queryKey: ["pr-risk-brief", prId], queryFn: () => api.get<RiskBrief | null>(`/pulls/${prId}/brief`)})`, deliberately named `pr-risk-brief` — not `pr-brief`/`prBrief` — to avoid the naming collision the spec's own Glossary flags; `useGenerateRiskBrief(prId)` — `useMutation` posting `{force}`, invalidating `["pr-risk-brief", prId]` and the PR-detail query key on settle so `risk_level` refreshes too), new `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/_components/RiskBriefCard/{RiskBriefCard.tsx,styles.ts,index.ts,RiskBriefCard.test.tsx}`, new `client/messages/en/brief.json` keys under a new `riskBriefCard.*` namespace entry (2026-08-20 cross-model review correction: `IntentCard` — this card's sibling, colocated under the same `OverviewTab` — actually already uses real `next-intl` via `useTranslations("brief")`, not hardcoded English as originally assumed; this card follows that real, existing pattern instead), loading skeleton, empty state with "Generate" action (`mutate({force: false})`, AC-18), a distinct always-present "Regenerate" action (`mutate({force: true})`, AC-19), `risk_level` badge + `what`/`why` + `risks[]` + clickable `review_focus[]` rows each carrying an `aria-label` with file:line + one-line reason (AC-28) calling a new `onViewInDiff(file, line)` prop, and a `degraded_reason` branch rendering an error/retry state that never shows a fabricated `risk_level`/empty-but-real `risks`/`review_focus` (AC-21).
    Depends on: WI-8 (route), WI-1 (contract), WI-11 (promoted color map).
    Acceptance: component test mounting `OverviewTab` with the GET mock returning `null` renders the empty state and its Generate click fires `force: false` (or omitted); a second test asserts the Regenerate control always calls `force: true`; a third simulates a review-focus click and asserts `onViewInDiff` fires with the exact `{file, line}`; a fourth with a `degraded_reason` mutation result asserts the error state, not a fabricated normal layout.
    Satisfies: AC-17, AC-18, AC-19, AC-20, AC-21, AC-28.

11. **Promote `RISK_SEVERITY_COLOR` to a shared location.**
    Files: new `client/src/lib/risk-severity.ts` (move `RISK_SEVERITY_COLOR`'s definition here verbatim from `OverviewTab/_components/IntentCard/constants.ts:22-29`), update `IntentCard/constants.ts` to re-export or update `IntentCard.tsx`'s import to the new path (`EVIDENCE_TIER_COLOR` stays in `IntentCard/constants.ts` — it's still IntentCard-only).
    Depends on: none (can run in parallel with server-side Work Items).
    Acceptance: `pnpm typecheck` clean; `IntentCard.test.tsx`'s existing risk-chip-color assertions still pass unchanged.
    Satisfies: prerequisite for AC-23, AC-24 (shared-mapping requirement — no AC of its own, purely a refactor enabling those).

12. **`PrBriefBanner` — risk badge, rendered in BOTH branches.**
    Files: `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/_components/PrBriefBanner/{PrBriefBanner.tsx,PrBriefBanner.test.tsx}`, `client/messages/en/prReview.json` (new `riskBadge.high`/`medium`/`low` keys — this file is already i18n'd via `useTranslations("prReview")`). New `riskLevel: RiskSeverity | null | undefined` prop (not a `pr` object — this component's real props are `verdict`/`score`/`findings`/`costUsd`, no `pr` prop exists). **2026-08-20 cross-model-review correction**: `PrBriefBanner.tsx:21-23` today early-returns an empty-state `<div>` whenever `verdict == null`, before ever reaching where a badge would render — but a Risk Brief can exist before any review has run, which is exactly this feature's point. Render the risk badge (a small extracted helper, e.g. `{riskLevel != null && <RiskBadge level={riskLevel} />}`) in BOTH the `verdict == null` empty-state branch AND alongside the normal `VerdictBanner` branch — not only the latter.
    Depends on: WI-11.
    Acceptance: component test with `riskLevel: "high"` and `verdict: null` asserts the badge renders inside the empty-state branch; a second test with `riskLevel: "high"` and a real `verdict` asserts it renders alongside `VerdictBanner`; `riskLevel: null`/`undefined` asserts no badge in either branch.
    Satisfies: AC-23.

13. **Flagged-refs derivation helper (pure function).**
    Files: new `client/src/lib/risk-brief-helpers.ts` — exported `buildFlaggedRefsMap(risks: Risk[], reviewFocus: ReviewFocusItem[]): Map<string, RiskSeverity | 'flagged'>`: for each risk, every `file_refs`/endpoint-mention entry maps to that risk's `severity` (highest severity wins on overlap — `high` > `medium` > `low`, per AC-24's explicit precedence rule); any `review_focus[].file` not already keyed maps to `'flagged'`.
    Depends on: WI-1 (contract types).
    Acceptance: unit test with two risks covering the same file at different severities asserts the higher wins; a `review_focus`-only file asserts the neutral `'flagged'` sentinel; a file covered by neither stays absent from the map.
    Satisfies: AC-24 (derivation logic — rendering lands in WI-14).

14. **`BlastRadiusCard` — flagged-dot indicator.**
    Files: `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/_components/BlastRadiusCard/{BlastRadiusCard.tsx,styles.ts,BlastRadiusCard.test.tsx}`. New optional `flaggedRefs: Map<string, RiskSeverity | 'flagged'> | undefined` prop (no new data-fetch inside this component — parent-derived, per AC-24's explicit constraint). Render a small filled dot immediately before a caller row's existing icon, or an endpoint/cron chip's label, whenever that row's `file`/endpoint string is a key in `flaggedRefs` — colored via WI-11's promoted map for `high`/`medium`/`low`, or `var(--text-muted)` for `'flagged'` — and append `" — flagged by Risk Brief"` (plus the severity word when present) to that row's `title`/accessible name.
    Depends on: WI-11, WI-13.
    Acceptance: component test with one caller's file at `severity: 'high'` in the map asserts that row's dot uses the high-severity color token and its accessible name mentions "flagged"; a second entry present only via `'flagged'` asserts the neutral dot color; a non-flagged caller row renders no dot.
    Satisfies: AC-24.

15. **`page.tsx`/`OverviewTab` wiring — new card + `flaggedRefs`/`riskLevel` prop threading.**
    Files: `client/src/app/repos/[repoId]/pulls/[number]/page.tsx` (add `const { data: riskBrief } = usePrRiskBrief(prId);` — same query key WI-10's card and WI-16's `IntentCard` self-fetch, so React Query dedupes to one network call, per the spec's explicit architectural choice; `const flaggedRefs = React.useMemo(() => riskBrief ? buildFlaggedRefsMap(riskBrief.risks, riskBrief.review_focus) : undefined, [riskBrief]);`; pass `riskLevel={pr.risk_level}` and `flaggedRefs` as new props into `OverviewTab`, and thread a **new**, distinctly-named prop — e.g. `onJumpToDiff={handleViewInDiff}` — bound to the raw, always-in-app-jump `handleViewInDiff` (page.tsx:102-105), **not** the existing `onViewInDiff` prop (bound to `handleCallerClick`, which has a GitHub-fallback branch used by `BlastRadiusCard`'s own caller clicks) — the two must stay distinct since Review Focus entries are server-validated to always be diff files and must never fall back to GitHub (AC-20)), `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/{OverviewTab.tsx,OverviewTab.test.tsx}` (accept and thread `riskLevel`, `flaggedRefs`, `onJumpToDiff` through to `PrBriefBanner`, `BlastRadiusCard`, and the new `RiskBriefCard` respectively — stays presentational/prop-only, no new `useQuery` inside `OverviewTab` itself, preserving its documented pure shape).
    Depends on: WI-10, WI-12, WI-13, WI-14.
    Acceptance: component test mounting `OverviewTab` asserts all four card sections render (`PrBriefBanner`, `IntentCard`, `BlastRadiusCard`, new card) — AC-17; an integration-style test simulates a Review Focus click and asserts the page's active tab becomes `"diff"` with a matching scroll target `{path, line}` — AC-20.
    Satisfies: AC-17, AC-20.

16. **`IntentCard` — merge `RiskBrief.risks[]` into Risk Areas.**
    Files: `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/_components/IntentCard/{IntentCard.tsx,helpers.ts (new),IntentCard.test.tsx}`. `IntentCard` calls `usePrRiskBrief(prId)` internally (same `["pr-risk-brief", prId]` key WI-10's card and WI-15's `page.tsx` also use — React Query dedupes, no duplicate network call, per the spec's explicit architectural choice over prop-threading). New colocated `helpers.ts` (component-specific merge logic, per `frontend-ui-architecture`'s "component-local business logic → colocated helpers.ts") exports `mergeRisks(intentRisks: Risk[], briefRisks: Risk[] | undefined): Risk[]` — case-insensitive, trimmed `title` match; where both sources have a matching title, keep the `RiskBrief` version and drop the `Intent`-only duplicate; when no brief exists yet, returns `intentRisks` unchanged. `RiskChips` renders the merged list.
    Depends on: WI-1, WI-8 (route must exist for the hook to call).
    Acceptance: component test with overlapping-title risks from both sources asserts exactly one chip renders per matched title, using the `RiskBrief`-sourced risk's fields; a second test with only `Intent.risks[]` present (no Brief yet) asserts today's unchanged rendering.
    Satisfies: AC-31.

## Verification

- `server`: `pnpm typecheck`; `pnpm exec vitest run --exclude '**/*.it.test.ts'` (new unit suites: `similarity`, `prompt`/assembly-trim, `grounding`, `risk-brief-service`); `pnpm exec vitest run .it.test` against real Postgres (new `risk-brief.it.test.ts` covering AC-1–AC-6/AC-15, plus updated `pulls.it.test.ts`/equivalent for AC-22's both-branches coverage) — no feature-specific migration to run first (WI-2), only the standard integration-test DB setup this repo already requires.
- `client`: `pnpm typecheck`; `pnpm test` (new component tests for `RiskBriefCard`, updated `PrBriefBanner.test.tsx`, `BlastRadiusCard.test.tsx`, `IntentCard.test.tsx`, `OverviewTab.test.tsx`; new hook tests for `risk-brief.ts`; new pure-function tests for `risk-brief-helpers.ts`).
- Manual/browser pass (per this codebase's established pattern for anything touching layout/scroll/accessible-name behavior, `client/INSIGHTS.md` 2026-08-05/2026-08-14 precedents): verify the Review Focus → Files-changed jump against a real PR in the local dev DB, and a real-but-cheap-model generation call (or a direct `UPDATE pr_brief SET json = '...'::jsonb` seed, mirroring the 2026-08-14 zero-cost-substitute INSIGHTS entry) to screenshot the populated card, badge, and flagged dots together.
- Confirm via `engineering-insights` skill at the end of implementation — this plan surfaced several non-obvious facts (the `intent/routes.ts`-doesn't-exist correction, the `DEFAULT_TIMEOUT` mismatch, the `RISK_SEVERITY_COLOR` promotion trigger, the `onViewInDiff`/`onJumpToDiff` naming-collision risk) that are worth a dated INSIGHTS entry once verified against the real implementation, not just this plan's inference.
