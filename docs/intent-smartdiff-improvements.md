# PR Brief — Risk Areas, PR Brief Banner, Intent Redesign, Findings→Diff Navigation

**Status:** done — all 4 phases implemented and verified (2026-08-14). Server
+client typecheck and full test suites green throughout; manual/browser
verification done for Phases 2-4 (Phase 1's was deliberately deferred to
avoid a second billed LLM call — see the Aggregate Verification note below).

## Context

The Intent Layer (`docs/intent-layer-plan.md`, merged to main) shipped a
real producer for Intent (`intent`, `in_scope`, `out_of_scope`,
`confidence`, `evidence_tier`, `sources`) via a cheap-model LLM call
(`server/src/modules/intent/service.ts`), persisted to `pr_intent`, and
rendered on `IntentCard.tsx`. That plan explicitly deferred "the mockup's
two-column PR BRIEF + BLAST RADIUS layout" as future work. Separately, the
just-shipped (unmerged) Smart Diff feature (PR #16) was live-tested on a
real PR, which surfaced that severity badges/auto-expand work correctly but
there's no PR-level summary telling a reviewer where the findings are or
letting them jump to them — motivating one more phase below.

This plan covers the deferred Intent-layer work, minus Blast Radius
(user: "blast radius ми зараз не робимо — це на майбутнє"), in the exact
phase order the user specified:

1. **Risk Areas** — a list of Risk items surfaced on the Overview tab.
2. **PR Brief banner** — a top-of-Overview summary: verdict, score,
   findings/blockers count, cost.
3. **Intent card redesign** — restructure `IntentCard.tsx` toward the
   mockup's "PR BRIEF" card look (Risk Areas included; Blast Radius is not).
4. **Findings → Code Changes tab navigation** (separate phase, explicitly
   requested last) — an optional in-app "view in diff" affordance on a
   finding, alongside the existing GitHub deep-link, that switches to the
   Files-changed tab and scrolls to the exact line.

The user confirmed reusing the existing `Risk`/`Risks`/`RiskSeverity`
contract (`server/src/vendor/shared/contracts/brief.ts`, currently pure
scaffolding — no producer, no consumer) rather than a new simplified type.

Research finding that reshapes Phase 1's design: `FeatureModelId`
(`server/src/vendor/shared/contracts/platform.ts:14-20`) already has a
`'risk_brief'` slot, registered but never wired to a producer — evidence the
course's original design may have intended Risks as a separate LLM
feature/call. This plan deliberately does not wire that slot — per this
session's established, repeatedly-applied principle ("piggyback on an
existing LLM call, never add a new one" — Smart Diff's `pseudocode_summary`
did exactly this riding the Run Review call), Risks are added as new fields
on the same cheap `review_intent` classifier call
(`IntentDeriverService.derive()`) that already has every input a risk
assessment needs. Flagged for confirmation since it diverges from what the
pre-registered slot's existence suggests.

Research finding that reshapes Phase 2's design: "prefer client-side
reuse over a new route" is not literally satisfiable — `usePrReviews`/
`ReviewRecord` has no `multi_agent_run_id`/batch-grouping field, so the
client can't safely replicate the "latest review batch" grouping
(`getLatestReviewBatchFindings`) that `server/INSIGHTS.md` (2026-08-05 ×3)
explicitly warns against re-deriving naively. The reuse-maximizing design
instead extends the existing `GET /pulls/:id` route (not a new one) to
populate `PrMeta`'s already-defined-but-empty `score`/`latest_run_cost_usd`/
`findings` fields plus one new `verdict` field, reusing
`getLatestReviewBatchFindings` and a new `getReviewsByIds` repo method, and
reuses the existing `VerdictBanner` component client-side.

## Mockup (confirmed 2026-08-14)

A real mockup was reviewed this session (PR #482 example). It confirms/resolves
two things this plan had left open:

- **Layout**: the mockup's "two-column" framing is **PR Brief/Intent card
  (left) vs. Blast Radius (right)** at the page level — not Intent-vs-Risks
  side by side inside one card. Risk Areas is a subsection *inside* the
  Intent card, matching what Phase 3 already assumed. Since Blast Radius is
  out of scope for this plan, the Intent card renders **full width** for now
  (no reserved/placeholder second column) — decided over reserving grid
  space, to avoid building layout scaffolding for a feature that isn't
  scheduled.
- **Risk Areas visual style**: risks render as a row of compact
  **badges/chips** — a small severity-colored icon + short title only,
  wrapped across the row (e.g. "🛡 Auth surface touched",
  "⚡ New dependency: ioredis"). Not the fuller vertical
  title+explanation+file_refs list originally sketched in Phase 1 step 8.
  `explanation`/`file_refs` are still derived and persisted (steps 1-3
  below are unchanged) — they're just not rendered inline in this first
  pass; available later for a tooltip/detail affordance if wanted.
- The PR Brief banner in the mockup (verdict, score circle, findings/blockers
  count, cost + token counts) matches Phase 2's design as already planned —
  no changes needed there.

## Scope

- **In scope:** Phase 1 (Risk Areas — LLM-piggybacked derivation +
  rendering), Phase 2 (PR Brief banner — `GET /pulls/:id` aggregate
  extension + `VerdictBanner` reuse), Phase 3 (IntentCard visual redesign,
  Risk Areas included), Phase 4 (findings → Files-changed-tab in-app
  navigation, alongside the existing GitHub deep-link).
- **Out of scope:** Blast Radius (`BlastRadius`/`ChangedSymbol`/
  `DownstreamImpact`, `RepoIntel.getBlastRadius()`) — not built, not
  stubbed, not routed, per explicit user instruction. `PrHistory` — not
  touched. The composed `PrBrief`/`pr_brief` table — not wired; this plan
  keeps growing `pr_intent` directly. Wiring the pre-registered `risk_brief`
  `FeatureModelId` slot to an actual second LLM call — rejected in favor of
  piggybacking. A persisted user preference/settings toggle for Phase 4's
  "optional" navigation (interpreted as: a second affordance alongside the
  existing external GitHub link, not settings-gated).

## Architectural Constraints

- No new port/adapter/container change anywhere in this plan — every phase
  reuses ports already wired on Container (`container.intentDeriver`,
  `container.reviewRepo`, `container.llm`).
- `modules/intent/` stays a capability module with no `repository.ts` —
  Phase 1's risks persistence goes through `container.reviewRepo.upsertIntent`/
  `getIntent`, same as confidence/evidence_tier/sources today.
- Phase 2's new aggregate logic goes through `container.reviewRepo.*` (a real
  port method), not a new inline `container.db` query in `pulls/routes.ts`.
- `Risk`/`Risks`/`RiskSeverity` (`brief.ts:59-74`) reused verbatim.
  `RiskSeverity` (`'high'|'medium'|'low'`) is a distinct enum from
  `Severity` (`'CRITICAL'|'WARNING'|'SUGGESTION'`) — do not conflate them or
  reuse `SeverityBadge`/`SEV_COLOR` for a Risk's severity; a new
  `RISK_SEVERITY_COLOR` map is needed (mirrors `EVIDENCE_TIER_COLOR`'s shape).
- `@devdigest/shared` is hand-copied into both `server/src/vendor/shared`
  and `client/src/vendor/shared` — every contract edit lands in both.
- Migrations are manual (`pnpm db:migrate`), never run on boot. Phase 1's
  migration is a pure `ADD COLUMN`.
- Phase 1's new LLM-derived fields need their own zod `.max()` bounds (same
  rule already applied to `intent`/`in_scope`/`out_of_scope`) — an untrusted
  completion 422s on a malformed/oversized response instead of persisting
  unbounded text.
- `renderIntentText()` (`reviewer-core/src/prompt.ts`) must NOT grow a
  `risks` field — Risks are a human-facing PR-brief concern, not reviewer
  prompt context; don't reflexively wire the new field into that render path.
- `OverviewTab.tsx` must stay presentational — Phase 2's banner data comes
  from `pr` (already fetched by `page.tsx`), threaded down as props, not a
  new `useQuery` inside `OverviewTab.tsx` itself.

## Relevant INSIGHTS.md Gotchas

- `server/INSIGHTS.md` (2026-08-05 ×3): any "latest X" feature reading
  reviews/agent_runs must use MIN score (worst-case gate) and SUM
  findings/cost across the latest batch — never "pick the newest row."
  Phase 2's new aggregate must follow this identically.
- `server/INSIGHTS.md` (2026-08-14, `getLatestReviewBatchFindings`): grow a
  method's return shape when a consumer needs adjacent data, don't
  re-implement the batch-key query — Phase 2's `getReviewsByIds` is a
  genuinely different read (whole rows by id), not a second batch algorithm.
- `server/INSIGHTS.md` (2026-08-09, `FEATURE_MODELS`): unwired
  `FeatureModelId` slots (`risk_brief`, `conformance`) aren't pre-validated —
  directly relevant since Phase 1 declines to wire `risk_brief`.
- `server/INSIGHTS.md` (2026-08-14, Smart Diff Phase 5): any new
  array/optional zod field destined for `completeStructured()` must be
  `.nullish()`, never bare `.optional()` — OpenAI's `zodResponseFormat`
  warns/errors otherwise. Applies to Phase 1's `IntentDerivation.risks`.
- `client/INSIGHTS.md` (2026-08-06): a `.default()` on a shared zod contract
  breaks pre-existing hand-built literals — `Intent.risks` should be
  required, no `.default()`, matching `in_scope`/`out_of_scope`'s style.
- `client/INSIGHTS.md` (2026-08-07): `client/messages/en/brief.json` already
  has unused `block.risks: "Risks"` and `noRisks: "No notable risks flagged."`
  keys — reuse verbatim in Phase 1/3, don't write new copy.
- `client/INSIGHTS.md` (2026-08-14, FileCard's `scrollToLine`): the
  two-`useEffect` pattern (force-open, then scroll once mounted) is required
  because lines only exist in the DOM once `open` is true — reuse as-is for
  Phase 4, don't collapse into one effect.
- `client/INSIGHTS.md` (2026-08-14): every Smart-Diff-era `FileCard` prop is
  additive/no-op-when-omitted — Phase 4's `scrollTarget` wiring through
  `DiffViewer` must follow the same shape.

## Phase 1 — Risk Areas (piggyback on the existing Intent LLM call)

**In scope:** deriving `Risk[]` as new fields on the classifier's existing
structured-output call, persisting on `pr_intent`, rendering on `IntentCard`.
**Out of scope:** any second LLM call; wiring `risk_brief`; Blast Radius.

1. **Schema growth** (`server/src/modules/intent/service.ts`): extend the
   local `IntentDerivation` zod schema with a bounded
   `risks: z.array(RiskDerivation).max(8).nullish()`, where
   `RiskDerivation = { kind: z.string().max(60), title: z.string().max(120),
   explanation: z.string().max(400), severity: RiskSeverity,
   file_refs: z.array(z.string()).max(10) }`.
2. **Prompt**: extend `buildMessages()`'s system instructions to identify up
   to ~5 notable risk areas from the same already-assembled inputs
   (description, linked issue/spec, file list, diff stats, branch, commits)
   — security-sensitive paths, missing-test signals, breaking-API shapes,
   oversized config diffs. Explicit instruction: empty list if nothing
   stands out, never invent a risk to fill space.
3. **Post-LLM validation**: filter each risk's `file_refs` down to paths
   that actually appear in the diff's file list; drop a risk only if its
   `file_refs` becomes empty AND the risk is inherently file-specific — a
   risk with no file refs at all (e.g. "no tests added") stays valid.
   Mirrors this session's established distrust of raw model output (Smart
   Diff's `finding_lines` worst-severity-wins rule, `filterByScope`'s
   softening rule) — never keep a hallucinated path.
4. **Contract growth** (both `brief.ts` vendor copies):
   `Intent.risks: z.array(Risk)` — required, no `.default()`, matching
   `in_scope`/`out_of_scope`'s style. `PrIntentRecord` inherits it via its
   existing `.extend()`.
5. **Persistence** (`server/src/db/schema/reviews.ts`): `pr_intent` gains
   `risks: jsonb('risks').$type<Risk[]>().notNull().default(sql`[]`::jsonb)`,
   mirroring `inScope`/`outScope`'s column style. New migration (next
   number after `0023_icy_photon.sql`) — pure `ADD COLUMN`.
6. **Repository** (`pull.repo.ts`): `upsertIntent`/`getIntent` carry `risks`
   through, same pattern as confidence/evidence_tier/sources.
7. **Service**: `IntentDeriverService.derive()` builds `Intent.risks` from
   the validated LLM output before calling `upsertIntent`; `[]` when null.
8. **UI** (`IntentCard.tsx`): new section below the evidence-tier Badge,
   gated by `intent.risks.length > 0`; empty case reuses the pre-existing
   unused `t("noRisks")` key, section title reuses `t("block.risks")`. Per
   the real mockup (confirmed 2026-08-14), each risk renders as a compact
   badge/chip in a wrapped row — a small severity-colored icon (new
   `RISK_SEVERITY_COLOR` map) + title only, no `explanation`/`file_refs`
   shown inline (those fields are still derived/persisted per steps 1-3,
   just not rendered in this first pass — available for a future
   tooltip/detail affordance, not built now). Implemented as a local,
   non-exported helper component inside `IntentCard.tsx` (mirrors the
   file's existing `ScopeList` pattern), not a new nested folder — one
   caller only.

**Files touched:** `server/src/modules/intent/service.ts`;
`server/src/modules/reviews/repository/pull.repo.ts` + `repository.ts`;
`server/src/db/schema/reviews.ts` + new migration `0024_*` + meta snapshot;
both `brief.ts` vendor copies; `server/test/contracts.test.ts` (existing
Intent/PrIntentRecord fixtures need `risks: []`);
`client/.../IntentCard/{IntentCard.tsx,constants.ts,styles.ts,IntentCard.test.tsx}`;
new `server/test/intent-risks.test.ts` (file_refs-validation guard).

**Verification:** `pnpm exec vitest run intent + contracts` (server);
`pnpm typecheck` (both packages); `pnpm db:migrate`; `pnpm test IntentCard`
(client); assert exactly one `completeStructured` call still happens (no new
LLM call, via `MockLLMProvider.calls`); manual derive-intent on a real PR,
confirm risks populate and render.

### Phase 1 — Detailed Development Plan

**Order of operations (hard dependency chain)** — land in this exact order,
`pnpm typecheck` (both packages) after every step, not just at the end:

1. Contract growth (both `brief.ts` vendor copies) — first, everything else imports `Risk`/`RiskSeverity` from it.
2. Persistence (`server/src/db/schema/reviews.ts` + migration) — needs `Risk` importable from step 1.
3. Repository (`pull.repo.ts`) — needs the schema column from step 2.
4. Service schema growth + prompt + post-LLM filter + wiring (`intent/service.ts`) — needs steps 1 & 3.
5. Server tests (`contracts.test.ts` fixture fix, new `intent-risks.test.ts`, new `reviews.it.test.ts` case) — needs step 4.
6. Client UI (`IntentCard.tsx` + `constants.ts` + `styles.ts` + new `IntentCard.test.tsx`) — needs step 1 (client `brief.ts`).

#### Step 1 — Schema growth (`server/src/modules/intent/service.ts`)

No `risks` concept exists in this file today (`service.ts:53-59`). Insert
after the existing `MAX_SCOPE_ITEM_CHARS` constant block (`service.ts:43-45`):

```ts
const MAX_RISKS = 8;
const MAX_RISK_KIND_CHARS = 60;
const MAX_RISK_TITLE_CHARS = 120;
const MAX_RISK_EXPLANATION_CHARS = 400;
const MAX_RISK_FILE_REFS = 10;
```

Extend the import at `service.ts:2` to also pull `Risk, RiskSeverity` from
`@devdigest/shared`. New local schema, inserted right before the existing
`IntentDerivation` (`service.ts:53`):

```ts
const RiskDerivation = z.object({
  kind: z.string().min(1).max(MAX_RISK_KIND_CHARS),
  title: z.string().min(1).max(MAX_RISK_TITLE_CHARS),
  explanation: z.string().min(1).max(MAX_RISK_EXPLANATION_CHARS),
  severity: RiskSeverity,
  file_refs: z.array(z.string().min(1)).max(MAX_RISK_FILE_REFS),
});
type RiskDerivation = z.infer<typeof RiskDerivation>;
```

Extend `IntentDerivation` (`service.ts:53-58`) with `risks:
z.array(RiskDerivation).max(MAX_RISKS).nullish()`, added last.

**Binding gotcha:** `.nullish()`, never `.optional()` —
`server/INSIGHTS.md` (2026-08-14, Smart Diff Phase 5 entry) documents a
reproduced OpenAI `zodResponseFormat` warning/error on a bare `.optional()`
array field used with `completeStructured()`. `pnpm typecheck` will NOT
catch this — only running vitest and reading its stderr will.

Export `RiskDerivation` (the type) so the unit test in step 5 can build
typed fixtures.

#### Step 2 — Prompt (`buildMessages()`, `service.ts:254-319`)

Extend the `system` array with one new bullet, inserted after the existing
"If a linked spec/ticket URL..." bullet and **before** the "SECURITY:"
bullet (SECURITY must stay last — it's the prompt-injection guard):

> Additionally, identify up to 5 notable RISK AREAS for a human reviewer to
> pay extra attention to — drawn only from the same inputs above
> (title/description, linked issue/spec, changed file paths, diff stats,
> branch name, commit messages). Look for signals like: security-sensitive
> paths (auth, secrets, payment, admin), a new third-party dependency,
> missing-test signals (source files changed with no matching test file
> touched), breaking-API shapes (removed/renamed exported functions,
> changed function signatures), and unusually large config/infra diffs.
> Return `risks`: an array of `{kind, title, explanation, severity,
> file_refs}` — `kind` a short machine-ish label, `title` a short
> human-readable label (≤120 chars, shown as a compact chip — no
> punctuation-heavy prose), `explanation` 1-2 sentences, `severity` one of
> "high"/"medium"/"low", `file_refs` the exact changed-file paths this risk
> concerns, or an empty array if not file-specific. Return an EMPTY
> `risks` array if nothing genuinely stands out — never invent a risk.

No new input sections needed — `buildMessages()` already receives
everything the risk assessment needs (this is exactly why Phase 1
piggybacks rather than adding a new LLM call).

#### Step 3 — Post-LLM validation (new pure function)

Exported, pure function — no `this`, no `Container`, no I/O — mirroring
`server/INSIGHTS.md` (2026-08-09)'s "split the algorithm into a pure
function... hermetically unit-testable without a repository stub or
Postgres" idiom. Add near the bottom of `service.ts`:

```ts
/** Filters each risk's file_refs down to paths that actually appear in the
 * diff's file list — never trust a raw model-cited path. A risk with no
 * file_refs to begin with (e.g. "no tests added") always stays valid. A
 * risk is dropped only when it HAD file_refs and every one failed to
 * match a real diff file. */
export function filterRiskFileRefs(
  risks: RiskDerivation[] | null | undefined,
  filePaths: string[],
): Risk[] {
  if (!risks) return [];
  const validPaths = new Set(filePaths);
  const kept: Risk[] = [];
  for (const r of risks) {
    if (r.file_refs.length === 0) {
      kept.push({ ...r, file_refs: [] });
      continue;
    }
    const matched = r.file_refs.filter((f) => validPaths.has(f));
    if (matched.length === 0) continue;
    kept.push({ ...r, file_refs: matched });
  }
  return kept;
}
```

#### Step 4 — Contract growth (both `brief.ts` vendor copies)

`server/src/vendor/shared/contracts/brief.ts:15-26` and the identical
client copy (currently byte-identical) both need:

```ts
export const Intent = z.object({
  intent: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  evidence_tier: EvidenceTier,
  sources: z.array(z.string()),
  risks: z.array(Risk),
});
```

Required, no `.default()` — per `client/INSIGHTS.md` (2026-08-06): a
`.default()` field breaks every pre-existing hand-built `Intent`-typed
literal at `pnpm typecheck` time. `Risk` is already in module scope
(declared just above `Intent` in this file) — no new import. `PrIntentRecord`
needs zero edits — it inherits `risks` via its existing `.extend()`.

#### Step 5 — Persistence (`server/src/db/schema/reviews.ts`)

New column on `prIntent` (`reviews.ts:95-132`), inserted after `sources`
(`reviews.ts:123`):

```ts
risks: jsonb('risks').$type<Risk[]>().notNull().default(sql`'[]'::jsonb`),
```

Exactly mirrors `sources`'s existing pattern — note the literal is
`` sql`'[]'::jsonb` `` (single-quoted `'[]'` cast to jsonb). Add `import
type { Risk } from '@devdigest/shared';` at the top of `reviews.ts` — this
is the first schema column typed against a shared contract type, legal per
onion-architecture's "Contracts as the Cross-Ring Language" rule.

Run `pnpm db:generate` — expect a clean new `0024_<slug>.sql`:
```sql
ALTER TABLE "pr_intent" ADD COLUMN "risks" jsonb DEFAULT '[]'::jsonb NOT NULL;
```
Per `server/INSIGHTS.md` (2026-08-07/2026-08-09), a pure `ADD COLUMN`
generates with no interactive prompt — don't hand-write the
migration/snapshot unless it unexpectedly prompts. Re-run `pnpm db:generate`
afterward to confirm "No schema changes." Then `pnpm db:migrate`.

#### Step 6 — Repository (`server/src/modules/reviews/repository/pull.repo.ts`)

`upsertIntent`/`getIntent` (`pull.repo.ts:56-82`) both thread `risks`
through, same shape as every other field (`values.risks = intent.risks` /
`risks: row.risks` on the return object). No change needed in
`repository.ts`'s facade or `service.ts`'s `getIntent`/`deriveIntent`
(both already spread `{...intent}`).

#### Step 7 — Service wiring (`derive()`, `service.ts:204-213`)

Insert right before building the `intent` object literal:

```ts
const filePaths = fileList.map((f) => f.path); // reuse the already-built fileList (service.ts:107)
const risks = filterRiskFileRefs(result.data.risks, filePaths);
```

Then add `risks` to the `Intent` object literal. `[]` when the model
returned null is already handled by `filterRiskFileRefs`'s own guard.

**Explicitly do NOT touch** `reviewer-core/src/prompt.ts`'s
`renderIntentText()` — grep confirms no `risks` reference before/after.

#### Step 8 — UI (`IntentCard.tsx` + `constants.ts` + `styles.ts`, new `IntentCard.test.tsx`)

No test file exists for this component today — `IntentCard.test.tsx` is a
brand-new file.

`constants.ts` — add (note: needs `icon`, not just `{color, bg}` like
`EVIDENCE_TIER_COLOR`, since `Badge` accepts an `icon` prop and the chip
style needs one per the confirmed mockup):

```ts
export const RISK_SEVERITY_COLOR: Record<RiskSeverity, { color: string; bg: string; icon: "AlertOctagon" | "AlertTriangle" | "Info" }> = {
  high: { color: "var(--crit)", bg: "var(--crit-bg)", icon: "AlertOctagon" },
  medium: { color: "var(--warn)", bg: "var(--warn-bg)", icon: "AlertTriangle" },
  low: { color: "var(--text-muted)", bg: "var(--bg-hover)", icon: "Info" },
};
```

`IntentCard.tsx` — local, non-exported `RiskChips` helper (mirrors the
file's existing `ScopeList` pattern, one caller only):

```tsx
function RiskChips({ risks }: { risks: Risk[] }) {
  return (
    <div style={s.riskRow}>
      {risks.map((risk, i) => (
        <Badge key={`${risk.kind}-${i}`} {...RISK_SEVERITY_COLOR[risk.severity]}>
          {risk.title}
        </Badge>
      ))}
    </div>
  );
}
```

Wired in below the evidence-tier Badge, gated on `intent.risks.length > 0`;
empty case renders `t("noRisks")`; section label reuses `t("block.risks")`
— both keys already exist, unused, in `client/messages/en/brief.json`.

**Correction to a stale INSIGHTS entry:** `client/INSIGHTS.md` (2026-08-09)
claims `IntentCard`/`OverviewTab` hardcode English with no `next-intl` —
stale; `IntentCard.tsx:27` already calls `useTranslations("brief")`. Use
`t(...)` for the new copy; flag the correction during `engineering-insights`.

`styles.ts` — add `riskRow: { display: "flex", flexWrap: "wrap", gap: 8,
marginTop: 4 } satisfies CSSProperties`.

**New `IntentCard.test.tsx`** — mock `@/lib/hooks/reviews` via `vi.mock`
(never MSW, per `client/AGENTS.md`), wrap in `NextIntlClientProvider` with
`brief.json` messages (mirror `DiffTab.test.tsx`'s hoisted-mock convention
and `VerdictBanner.test.tsx`'s provider wrapping). Minimum cases: (1) risks
render as chips with correct title/icon; (2) empty risks → `noRisks` copy,
no chip row. Do not assert wrap/layout behavior — jsdom has no layout
engine (`client/INSIGHTS.md`, 2026-08-05).

#### Server test suite — correction to the doc's original sketch

**Finding (load-bearing):** `IntentDeriverService.derive()` calls
`this.container.reviewRepo.getPrCommits(...)`/`upsertIntent(...)`, but
`ContainerOverrides` (`container.ts:47-64`) has **no `reviewRepo` override
field** — it's always the real `ReviewRepository` backed by the real `Db`.
No test anywhere in this repo has ever exercised `derive()` for real; the
one existing Intent-Layer integration test deliberately overrides
`intentDeriver: new MockIntentDeriver()`, bypassing `derive()` entirely
(its own comment calls this a "mock-fidelity gap"). So Phase 1 is the
first time this method gets tested at all.

Split into two files, not one:

1. **`server/test/intent-risks.test.ts`** — plain unit test (no DB), tests
   only the pure `filterRiskFileRefs`: full-match kept unchanged;
   no-match dropped entirely; partial-match kept with only matching paths;
   `file_refs: []` always kept; `null`/`undefined` input → `[]`.
2. **New `it()` case in the existing `server/test/reviews.it.test.ts`**
   (not a new file) — the only way to get a real Postgres round trip. Use
   `llm: { openai: new MockLLMProvider('openai', { structured: <fixture> }) }`
   (**not** `MockIntentDeriver`) so the real `derive()` runs. Call `POST
   /pulls/:id/intent/derive` then `GET /pulls/:id/intent`; assert `risks`
   reflects the fixture filtered by `filterRiskFileRefs` against the
   existing `DIFF` fixture's file list, and `mockLlm.calls.length === 1`
   (no second LLM call).

Do not name the DB-touching file `intent-risks.test.ts` — per
`server/AGENTS.md`, a DB-backed file MUST end in `*.it.test.ts` or the
unit/integration split silently miscounts it.

`server/test/contracts.test.ts`'s existing `Intent.parse({...})` fixture
needs `risks: []` added (required field, no default). Grep `server/test/**`
for any other hand-built `Intent` literal before considering this step
done — `server/tsconfig.json`'s `include` does not cover `server/test/**`,
so a missed fixture fails silently at typecheck and only surfaces as a
real vitest parse error.

#### Work Items / Acceptance Criteria checklist

- [ ] Both `brief.ts` vendor copies gain `Intent.risks: z.array(Risk)`, required, no `.default()`.
- [ ] `prIntent.risks` jsonb column added; `pnpm db:generate` produces a clean single `ADD COLUMN` migration; `pnpm db:migrate` applies it.
- [ ] `pull.repo.ts` `upsertIntent`/`getIntent` thread `risks`.
- [ ] `RiskDerivation` schema (`.nullish()`, not `.optional()`), prompt bullet, `filterRiskFileRefs`, and `derive()` wiring all added to `intent/service.ts`.
- [ ] `renderIntentText()` unchanged — grep-confirmed.
- [ ] `server/test/intent-risks.test.ts` (new, plain unit) covers all 5 `filterRiskFileRefs` cases.
- [ ] `server/test/reviews.it.test.ts` gains one new `it()` proving a real `derive()` → persist → `GET` round trip with exactly one LLM call.
- [ ] `server/test/contracts.test.ts`'s `Intent` fixture updated; no other hand-built `Intent` literal missed.
- [ ] `IntentCard/constants.ts` gains `RISK_SEVERITY_COLOR` (with `icon`); `styles.ts` gains `s.riskRow`; `IntentCard.tsx` gains the `RiskChips` helper wired in below the evidence badge.
- [ ] New `IntentCard.test.tsx` covers risks-render and empty-state cases; `client/AGENTS.md`'s `vi.mock`-not-MSW convention followed.
- [ ] `pnpm typecheck` green in both packages after every step.
- [ ] `pnpm exec vitest run --exclude '**/*.it.test.ts'` (server unit) and `pnpm exec vitest run .it.test` (server integration, real Postgres) both green.
- [ ] `pnpm test IntentCard` (client) green.
- [ ] Manual/browser: derive intent on a real PR with a genuine risk signal; confirm chips render correctly; confirm a no-risk PR shows `noRisks` copy.
- [ ] `engineering-insights` run at session end — record the `reviewRepo`-not-overridable finding and the stale `client/INSIGHTS.md` i18n correction.

## Phase 2 — PR Brief banner

**In scope:** extending `GET /pulls/:id` with a latest-batch aggregate
(verdict/score/findings/latest_run_cost_usd), rendering via a reused
`VerdictBanner` at the top of Overview.
**Out of scope:** a new/parallel route; a client-side batch-grouping
algorithm; changing `VerdictBanner`'s existing per-run caller behavior
beyond one new optional prop.

1. **Contract**: `PrMeta` gains `verdict: Verdict.nullish()` in both
   `platform.ts` vendor copies (`score`/`latest_run_cost_usd`/`findings`
   already exist, just unpopulated on this route today).
2. **Repository**: new `getReviewsByIds(reviewIds)` on `review.repo.ts` +
   `repository.ts` — plain select + `inArray`, no batch-key logic (already
   resolved by the `reviewIds` passed in).
3. **Route** (`GET /pulls/:id`, both the live-refresh and offline-fallback
   branches — easy to miss one): fetch `{reviewIds, findings}` via
   `getLatestReviewBatchFindings`, fetch review rows via `getReviewsByIds`,
   compute `score` = MIN across non-null scores, `latest_run_cost_usd` =
   SUM, `findings` via the existing `rollupSeverities` (already imported in
   this file), `verdict` via a new `worstVerdict()` helper.
4. **New helper** (`server/src/modules/pulls/status.ts`, colocated with
   `rollupSeverities`): `worstVerdict(verdicts): Verdict | null` — priority
   `request_changes > comment > approve`, null for empty input.
5. **Client**: `VerdictBanner.tsx` gets new optional `costUsd?: number | null`
   prop (additive, rendered only when provided; reuses `formatCost`).
   New `OverviewTab/_components/PrBriefBanner/` renders `VerdictBanner` when
   `verdict != null`, else a small empty state (new i18n key — none of the
   existing unused keys matched this case). `OverviewTab.tsx` gains props
   threaded from `page.tsx`'s already-fetched `pr` object, renders
   `<PrBriefBanner>` above `<IntentCard>`, stays presentational.

**Files touched:** both `platform.ts` vendor copies; `review.repo.ts` +
`repository.ts`; `pulls/routes.ts`; `pulls/status.ts`;
`server/test/pulls.it.test.ts` (new multi-agent-batch verdict/score/cost
case, mirroring the existing list-route regression test);
`VerdictBanner/{VerdictBanner.tsx,VerdictBanner.test.tsx}`;
`OverviewTab/{OverviewTab.tsx,_components/PrBriefBanner/}`; `page.tsx`;
`client/messages/en/prReview.json`.

**Verification:** `pnpm exec vitest run pulls` (unit + new `.it.test.ts`
case, real Postgres); `pnpm typecheck` (both); `pnpm test VerdictBanner
PrBriefBanner OverviewTab`; manual/browser — a PR with a mixed-verdict
multi-agent batch shows worst-of verdict/MIN score/summed findings+cost; a
PR with zero reviews shows the empty state, not a crash.

### Phase 2 — Detailed Development Plan

**Read order** (later fixtures depend on earlier shapes): contract
(`platform.ts` × 2) → repository (`review.repo.ts` + `repository.ts`) →
`pulls/status.ts` (`worstVerdict`) → `pulls/routes.ts` (both branches) →
`VerdictBanner.tsx` → new `PrBriefBanner` + `OverviewTab.tsx` + `page.tsx`
→ `prReview.json` → tests.

#### 1. Contract — `PrMeta.verdict`

Both `server/src/vendor/shared/contracts/platform.ts:157-200` and the
identical client copy: add `import { Verdict } from './findings.js';`
(already exported there in both copies) and one new field on `PrMeta`,
placed after the existing `findings` field:

```ts
verdict: Verdict.nullish(),
```

`PrDetail = PrMeta.extend({...})` inherits it automatically. Do **not**
add `cost_usd`/`latest_review_ids` population to this route — those stay
list-endpoint-only per their existing comments. `Verdict.nullish()`
matches every other optional `PrMeta` field's style (`score`, `cost_usd`
are all `.nullish()`, never `.optional()`/`.default()`).

**Test:** `server/test/contracts.test.ts` — extend the existing `'Repo +
PrDetail'` case with a `PrDetail.parse({...verdict: 'request_changes'...})`
assertion; the existing fixture without `verdict` must keep passing
(nullish).

#### 2. Repository — `getReviewsByIds`

New function in `review.repo.ts`, placed after `getFileSummariesForReviews`
— mirror its exact empty-array-guard shape (no batch-key logic, the
`reviewIds` are already resolved by the caller):

```ts
export async function getReviewsByIds(db: Db, reviewIds: string[]): Promise<ReviewRow[]> {
  if (reviewIds.length === 0) return [];
  return db.select().from(t.reviews).where(inArray(t.reviews.id, reviewIds));
}
```

`inArray` already imported in this file. Add the matching passthrough in
`repository.ts` next to `getFileSummariesForReviews`. Per `server/INSIGHTS.md`
(2026-08-14, `getLatestReviewBatchFindings` entry) this is exactly the
"grow a method vs. a second batch algorithm" case that entry documents —
confirmed a genuinely different read, not a re-implementation risk. No new
workspace-scoping needed — same trust boundary as its sibling method
(`reviewIds` only ever reachable via an already workspace-scoped `prId`).

No dedicated unit test needed (no existing unit coverage of this file's
plain-select siblings either) — exercised end-to-end by the new
`pulls.it.test.ts` below.

#### 3. Helper — `worstVerdict()`

`server/src/modules/pulls/status.ts`, colocated with `rollupSeverities`:

```ts
const VERDICT_PRIORITY: Record<Verdict, number> = {
  request_changes: 0,
  comment: 1,
  approve: 2,
};

/** Worst verdict across a PR's latest review batch. Non-Verdict garbage
 * strings (reviews.verdict has no DB CHECK constraint) are silently
 * ignored, not thrown on. Empty/all-invalid input → null. */
export function worstVerdict(verdicts: (string | null)[]): Verdict | null {
  let best: Verdict | null = null;
  let bestPriority = Infinity;
  for (const v of verdicts) {
    if (v !== 'request_changes' && v !== 'comment' && v !== 'approve') continue;
    const priority = VERDICT_PRIORITY[v];
    if (priority < bestPriority) { bestPriority = priority; best = v; }
  }
  return best;
}
```

Priority mirrors the same "worst-case gate" reasoning as MIN score
(`server/INSIGHTS.md`, 2026-08-05 ×3) — one blocking agent must not be
masked by a clean one in the same batch.

**Test:** add a `describe('worstVerdict', ...)` block to the existing
`server/test/pulls-status.test.ts` (already covers `rollupSeverities`/
`deriveReviewStatus` — don't create a new file). Cases: `[]`→null;
`[null,null]`→null; all-approve→approve; mixed with one
request_changes→request_changes (position-independent); approve+comment→
comment; garbage string mixed in → ignored, doesn't crash.

#### 4. Route — `GET /pulls/:id` aggregate wiring

Compute the aggregate **once**, right after `pr`/`repo` are resolved and
**before** the `try {...} catch {...}` block, then spread the same object
into both return sites — removes the "easy to miss one branch" risk by
construction instead of hand-syncing two blocks:

```ts
const { reviewIds, findings: latestFindings } = await container.reviewRepo.getLatestReviewBatchFindings(pr.id);
const batchReviews = await container.reviewRepo.getReviewsByIds(reviewIds);
const scores = batchReviews.map((r) => r.score).filter((s): s is number => s != null);
const costs = batchReviews.map((r) => r.costUsd).filter((c): c is number => c != null);
const prBrief = {
  score: scores.length > 0 ? Math.min(...scores) : null,
  latest_run_cost_usd: costs.length > 0 ? costs.reduce((a, b) => a + b, 0) : null,
  findings: reviewIds.length > 0 ? rollupSeverities(latestFindings) : null,
  verdict: worstVerdict(batchReviews.map((r) => r.verdict)),
};
```

Live-refresh branch: `return { ...detail, id: pr.id, ...prBrief };`.
Offline-fallback branch: add `...prBrief,` to the existing object literal.
Import `worstVerdict` alongside the existing `deriveReviewStatus,
rollupSeverities` import from `./status.js`. No container wiring needed —
`container.reviewRepo` is already a getter.

**Gotcha (`server/INSIGHTS.md`, 2026-08-05 ×3):** this aggregate reuses
`getLatestReviewBatchFindings`'s already-correct batch-key resolution
rather than re-deriving anything — the "pick the newest row" bug class
these entries document doesn't recur here by construction, but it's the
single easiest thing to regress in review.

#### 5. Server test — new `server/test/pulls.it.test.ts`

No such file exists today, and no existing integration test exercises
`GET /pulls/:id` at all (only `GET /repos/:id/pulls`) — this closes a real
pre-existing test gap, not just Phase 2 coverage. Mirror the harness
pattern from `reviews.it.test.ts` (`PerAgentMockLLM`, `setupRepoAndPr` —
these are file-local, duplicated per `*.it.test.ts` file in this repo by
convention; write a local copy, don't try to import the private class).

**Gotcha:** the offline-fallback branch is not safely reachable by merely
omitting `overrides.github` — `container.github()` falls back to the real
`LocalSecretsProvider` reading `~/.devdigest/secrets.json` unless
`overrides.secrets` is set (same risk class as `server/INSIGHTS.md`
2026-08-09's `OPENROUTER_API_KEY` entry). The offline test must pass
`overrides: { secrets: new MockSecretsProvider({}) }` explicitly (already
exists at `server/src/adapters/mocks.ts`) — never rely on the dev
machine's real secrets file lacking a token.

Three cases: (1) live-refresh, mixed-verdict multi-agent batch → asserts
worst verdict / MIN score / summed cost+findings; (2) offline-fallback
branch with `MockSecretsProvider({})` forcing the catch path → same
aggregate shape, proving `prBrief` is genuinely shared not duplicated; (3)
zero-reviews PR → all four fields `null`, `200` not a crash.

#### 6. Client — `VerdictBanner` additive `costUsd` prop

New optional prop, additive/no-op when omitted (matches the established
convention, `client/INSIGHTS.md` 2026-08-14):

```ts
costUsd?: number | null;
```

Import `formatCost` from `@/lib/format` (already used the same way by
`ReviewRunAccordion.tsx`). Render inside the existing `titleRow`, right
after the findings/blockers Badge, guarded by `costUsd != null`, reusing
`ReviewRunAccordion`'s own bare-mono-span cost style (not a colorful
Badge):

```tsx
{costUsd != null && (
  <span className="mono" style={s.costText}>{formatCost(costUsd)}</span>
)}
```

`styles.ts`: `costText: { fontSize: 12, color: "var(--text-muted)" }
satisfies CSSProperties`, alongside the existing `scoreLabel` entry. Zero
behavior change for the existing caller (`ReviewRunAccordion` doesn't pass
`costUsd` today and stays that way — out of scope).

**Test:** add one case to `VerdictBanner.test.tsx` — render with
`costUsd={0.041}`, assert `"$0.041"` renders; the existing no-`costUsd`
case must keep passing unchanged.

#### 7. Client — new `PrBriefBanner` + `OverviewTab.tsx` + `page.tsx`

New folder `OverviewTab/_components/PrBriefBanner/` (mirrors `IntentCard`'s
sibling precedent): `PrBriefBanner.tsx`, `PrBriefBanner.test.tsx`,
`index.ts`, `styles.ts` (only if needed).

```tsx
"use client";
import { useTranslations } from "next-intl";
import type { Verdict } from "@devdigest/shared";
import { VerdictBanner } from "../../../VerdictBanner";
import { s } from "./styles";

interface PrBriefBannerProps {
  verdict: Verdict | null | undefined;
  score: number | null | undefined;
  findings: { critical: number; warning: number; suggestion: number } | null | undefined;
  costUsd?: number | null;
}

export function PrBriefBanner({ verdict, score, findings, costUsd }: PrBriefBannerProps) {
  const t = useTranslations("prReview");
  if (verdict == null) {
    return <div style={s.emptyWrap}>{t("prBrief.empty")}</div>;
  }
  const findingsCount = (findings?.critical ?? 0) + (findings?.warning ?? 0) + (findings?.suggestion ?? 0);
  const blockers = findings?.critical ?? 0;
  return (
    <VerdictBanner
      verdict={verdict}
      summary={null}
      score={score ?? null}
      findingsCount={findingsCount}
      blockers={blockers}
      costUsd={costUsd}
    />
  );
}
```

Design notes worth stating: `summary` is always `null` (a multi-agent
batch has no single review-level summary — `VerdictBanner` already
supports `summary == null`); `agentName` is omitted for the same reason;
`blockers = findings.critical` matches `ReviewRunAccordion`'s own
definition (dismissed findings already excluded at the DB layer by
`getLatestReviewBatchFindings`, no extra client filtering needed).

**Import-path gotcha (`client/INSIGHTS.md` 2026-08-06, off-by-one
precedent):** `VerdictBanner` lives at the top-level `_components/
VerdictBanner/`, a *sibling of* `OverviewTab`, not nested under it. From
`PrBriefBanner.tsx` the correct import is `../../../VerdictBanner` (three
levels up), not `../../VerdictBanner` — verify with `pnpm typecheck`
rather than trusting the count alone.

`OverviewTab.tsx` gains `verdict`/`score`/`findings`/`latestRunCostUsd`
props, renders `<PrBriefBanner>` above `<IntentCard>`, stays i18n-free
itself (matches its own established convention — only `PrBriefBanner`
calls `useTranslations`, since it directly composes the already-i18n'd
`VerdictBanner`). `page.tsx` threads `pr.verdict`/`pr.score`/`pr.findings`/
`pr.latest_run_cost_usd` in — `pr` is already the fetched `PrDetail`
object, no new `useQuery` (keeps `OverviewTab.tsx` presentational).

#### 8. i18n — one new key

Grepped first, confirmed no existing key fits. Add to
`client/messages/en/prReview.json`, after `"verdict"`:

```json
"prBrief": {
  "empty": "Run a review to see the PR Brief — verdict, score, and findings will appear here."
}
```

Single key, not the heavier `EmptyState` primitive (that's a full-page-scale
component with icon box/CTA button — wrong weight for a compact top-of-tab
banner). Reuse `VerdictBanner`'s own card-look wrapper style for visual
consistency instead.

#### 9. Client tests

`PrBriefBanner.test.tsx` (new): verdict-present renders `VerdictBanner`
with correct score/cost; verdict null/undefined renders the empty-state
copy, no `VerdictBanner` content; findings breakdown derives
`findingsCount`/`blockers` correctly.

`OverviewTab.test.tsx` (new — none exists today): mock `./_components/
IntentCard` entirely so this test only exercises composition/prop-
threading, not `IntentCard`'s own data-fetching; wrap in
`NextIntlClientProvider` with `{ prReview: messages }` (transitively needed
by `PrBriefBanner`/`VerdictBanner`). Assert `PrBriefBanner` renders above
`IntentCard`, above Description; assert verdict/score/findings/
latestRunCostUsd thread through unchanged (mock `PrBriefBanner` itself and
assert the props object it received).

#### Work Items / Acceptance Criteria

- [ ] `PrMeta.verdict: Verdict.nullish()` in both `platform.ts` vendor copies; `PrDetail.parse` round-trip test added.
- [ ] `getReviewsByIds` added to `review.repo.ts` + `repository.ts` passthrough; no new workspace-scoping.
- [ ] `worstVerdict()` added to `pulls/status.ts`; 6 cases added to `pulls-status.test.ts`.
- [ ] `GET /pulls/:id` computes `prBrief` once before the try/catch, spreads into both return branches.
- [ ] New `server/test/pulls.it.test.ts` — 3 cases (live-refresh, offline-fallback with `MockSecretsProvider({})`, zero-reviews).
- [ ] `VerdictBanner.tsx` gets additive `costUsd` prop + `styles.ts`'s `costText`; existing caller/test unchanged; one new cost-present test case.
- [ ] New `PrBriefBanner` component folder with 3 test cases.
- [ ] `OverviewTab.tsx` grows 4 new props, renders `PrBriefBanner` above `IntentCard`, stays presentational; new `OverviewTab.test.tsx` with 4+ cases.
- [ ] `page.tsx` threads `pr.verdict`/`pr.score`/`pr.findings`/`pr.latest_run_cost_usd` into `OverviewTab`.
- [ ] `prReview.json` gains `prBrief.empty` (confirmed no pre-existing key fit).
- [ ] `pnpm exec vitest run pulls` (unit + new `.it.test.ts`, real Postgres) green.
- [ ] `pnpm typecheck` green in both packages.
- [ ] `pnpm test VerdictBanner PrBriefBanner OverviewTab` (client) green.
- [ ] Manual/browser: mixed-verdict batch shows worst-of/MIN/summed correctly; zero-review PR shows empty state; existing per-run `VerdictBanner` inside `ReviewRunAccordion` visually unchanged.
- [ ] `engineering-insights` run at session end.

## Phase 3 — Intent card redesign ("PR BRIEF" look)

**In scope:** visual restructuring of `IntentCard.tsx` (Intent + Risk Areas
together) toward the mockup's card style, reusing existing primitives.
**Out of scope:** new data/fetching (Phase 1 already wired risks); Blast
Radius/PR History sections; renaming the component/folder.

Per the confirmed mockup (see "Mockup" section above): the Intent card
renders full width (no reserved Blast Radius column). What's specified:
`IntentCard.tsx` already has a real 2-column grid for in_scope/out_of_scope
(`styles.ts`'s `s.columns`) — reuse/extend this building block rather than
inventing a new layout system. Reorganize into labeled subsections inside
the one Card: intent summary → existing scope grid → evidence-tier badge →
Phase 1's Risk Areas chip row, with clear visual separation (a divider or
`SectionLabel`-style sub-header using the reused `block.risks` key).

**Files touched:**
`IntentCard/{IntentCard.tsx,styles.ts,constants.ts,IntentCard.test.tsx}`.

**Verification:** `pnpm test IntentCard` (structural assertions only —
jsdom has no layout engine, a passing suite isn't proof of visual
correctness); `pnpm typecheck`; manual/browser screenshot comparison
against the actual mockup — required before calling this phase done.

### Phase 3 — Detailed Development Plan

**Hard precondition:** this plan assumes Phase 1 has already shipped
(`Intent.risks`, `RISK_SEVERITY_COLOR`, the `RiskChips` helper, and a real
`IntentCard.test.tsx`) before Phase 3 starts — since this repo implements
phases in order, that's satisfied by construction here. If Phase 3 is ever
picked up out of order, stop and confirm rather than inventing Phase 1's
data/rendering logic inline.

**Divider/sub-header primitive — what already exists (grepped):** no
dedicated `Divider`/`<hr>` component exists anywhere in
`client/src/vendor/ui`. The established idiom in this codebase is a
`borderTop: "1px solid var(--border)"` rule applied directly to a
section's own wrapper `<div>` (precedent: `FindingCard/styles.ts`'s
`body` entry, `RunTraceDrawer/styles.ts`'s `sectionBody` entry) — not a
separate rule element. The sub-header idiom is `SectionLabel`
(`client/src/vendor/ui/primitives/SectionLabel.tsx` — icon + small
uppercase bold label + optional right slot), already used once in this
file for the card's own title (`icon="Target"`, with the derive button as
`right`). Phase 3 reuses it a **second time**, nested, for the Risk Areas
subheading only (`icon="Shield"` — confirmed present in
`client/src/vendor/ui/icons.tsx`, distinct from the `AlertTriangle`/
`AlertOctagon` icons `SeverityBadge` already uses for finding severities,
avoiding visual overload with an existing severity icon). `Card` itself
takes no divider/section prop and `SectionLabel` takes no `style` prop —
all separation is built from plain `<div>` + new `styles.ts` entries
inside the Card's children, not a shared-primitive API change.

#### Exact new section structure (inside the one `Card`)

For the `intent &&` success branch, top to bottom, unchanged parts kept
verbatim:

1. **Intent summary** — `<p style={s.intentText}>{intent.intent}</p>`
   (unchanged, no divider above — first element under the card's own title).
2. **Scope grid** — `<div style={s.columns}>...</div>` (unchanged content
   and sub-labels). No new divider above (existing `s.intentText`
   margin already provides spacing).
3. **Evidence-tier badge** — wrapped in a new `<div style={s.subsection}>`
   containing the existing `<Badge>` unchanged; the wrapper supplies the
   divider-above separation from the scope grid.
4. **Risk Areas** (Phase 1's `RiskChips`, consumed not re-derived) —
   wrapped in a second `<div style={s.subsection}>` containing a new,
   second `<SectionLabel icon="Shield">{t("block.risks")}</SectionLabel>`
   followed by Phase 1's existing chip-row/empty-state rendering,
   unmodified.

Illustrative shape:
```tsx
{!isLoading && !isError && intent && (
  <>
    <p style={s.intentText}>{intent.intent}</p>
    <div style={s.columns}>{/* unchanged ScopeList blocks */}</div>
    <div style={s.subsection}>
      <Badge {...EVIDENCE_TIER_COLOR[intent.evidence_tier]}>
        {t(`intentCard.evidence.${intent.evidence_tier}`)}
      </Badge>
    </div>
    <div style={s.subsection}>
      <SectionLabel icon="Shield">{t("block.risks")}</SectionLabel>
      {/* Phase 1's existing RiskChips / noRisks rendering, unmodified */}
    </div>
  </>
)}
```

#### Exact `styles.ts` addition

One new key, reused twice (evidence wrapper, Risk Areas wrapper) — no
duplicate style object:

```ts
subsection: {
  marginTop: 14,
  paddingTop: 14,
  borderTop: "1px solid var(--border)",
} satisfies CSSProperties,
```

No changes to `s.intentText`, `s.columns`, `s.columnLabel`, `s.bulletList`,
`s.bulletItem`, `s.emptyBullet`, or `s.riskRow` — all reused verbatim.
`constants.ts` gets no changes in this phase.

#### Exact `IntentCard.test.tsx` additions

Additive only, on top of Phase 1's existing coverage:
1. **Section order** — one test asserting DOM order (intent summary →
   scope grid → evidence badge → "Risk Areas" heading) for a fixture with
   populated `risks`.
2. **New Risk Areas sub-header renders once, distinct from the card's own
   top-level title** — guards against ever duplicating the top
   `SectionLabel`.
3. **Wrapper structure, not visual correctness** — assert the evidence
   badge and the Risk Areas heading each sit inside their own wrapper
   (`closest()`/`parentElement` checks), not asserting pixel/CSS values —
   jsdom has no layout engine (`client/INSIGHTS.md`, 2026-08-05); a
   passing suite isn't proof of visual correctness.
4. Re-run (unchanged) Phase 1's loading/error/empty/risk-chip tests —
   confirm they still pass with the new wrapper markup.
5. No new data-fetching assertions — Phase 3 touches zero query/mutation
   logic.

#### Explicit non-goals (confirmation)

No new data fetching (`usePrIntent`/`useDeriveIntent` untouched — Phase 1
already wires `risks`). No Blast Radius/PR History — no reserved/
placeholder second column; per the confirmed mockup the card is simply
full-width. No component/folder/route rename.

#### Work Items / Acceptance Criteria checklist

- [ ] Phase 1 precondition confirmed present in the working tree before starting.
- [ ] `IntentCard/styles.ts` gains exactly one new key (`s.subsection`); no other key modified.
- [ ] `IntentCard/constants.ts` unchanged in this phase.
- [ ] `IntentCard.tsx`'s success branch renders, in order: intent summary → scope grid (unchanged) → evidence badge (in a `subsection` wrapper) → "Risk Areas" `SectionLabel` + Phase 1's chip row (in a second `subsection` wrapper).
- [ ] No new data fetching, hook, query, mutation, or API call.
- [ ] No Blast Radius/PR History code, imports, or reserved layout space.
- [ ] No component/folder rename; `index.ts` re-export untouched.
- [ ] All new label text goes through `t(...)` against the `brief` namespace.
- [ ] `IntentCard.test.tsx` updated with order/duplicate-heading/wrapper-structure assertions; all pre-existing Phase 1 tests still pass unmodified.
- [ ] `pnpm test IntentCard` green.
- [ ] `pnpm typecheck` (client) clean.
- [ ] Manual/browser screenshot comparison against the confirmed mockup completed and matches (section order, full-width, divider placement).

## Phase 4 — Findings → Code Changes tab navigation (separate phase)

**In scope:** an optional in-app "view in diff" affordance on a finding that
switches to Files-changed and scrolls to the exact file:line, alongside
(not replacing) the existing GitHub deep-link.
**Out of scope:** a persisted settings toggle; wiring into `RunTraceDrawer`
or other finding surfaces beyond `FindingCard`.

1. `DiffViewer.tsx` currently forwards zero extra props to `FileCard` —
   add optional `scrollTarget: {path, line, nonce} | null`, forwarded only
   to the one `FileCard` whose `file.path` matches (mirrors how
   `SmartDiffViewer` already scopes its own internal scroll target).
2. `SmartDiffViewer.tsx`: add an external `scrollTarget` prop alongside
   its existing internal click-driven one (rename internal param to
   disambiguate); compute each file's effective target as
   internal-if-matches ?? external-if-matches. On external nonce change,
   also force-open the containing group's section (same `setOpenSections`
   mechanism the split-highlight fix just added for core).
3. `DiffTab.tsx`: new `scrollTarget` prop, forwarded to whichever viewer
   (`SmartDiffViewer`/`DiffViewer`) is currently active.
4. `page.tsx`: new `diffScrollTarget` state, `handleViewInDiff(file, line)`
   bumps the nonce and calls the existing `setTab("diff")` (reuse the
   established `?tab=` mechanism). Threaded into `DiffTab` and down through
   `FindingsTab`.
5. `FindingsTab` → `ReviewRunAccordion` → `FindingsPanel` →
   `FindingCard`: thread optional `onViewInDiff?: (file, line) => void`
   down the existing prop chain (mirrors how `repoFullName`/`headSha` are
   already threaded for the GitHub link). `FindingCard` renders a small icon
   button next to the existing file:line link, calling `onViewInDiff`, only
   when the prop is provided (additive/no-op elsewhere).
6. Missing-file degrade: if the target file isn't among currently-loaded
   files, the tab still switches but nothing scrolls — no crash. Cover
   with a test.

**Files touched:** `DiffViewer.tsx`; `SmartDiffViewer.tsx`; `DiffTab.tsx`;
`FindingCard`/`FindingsPanel`/`ReviewRunAccordion`/`FindingsTab` `.tsx` files;
`page.tsx`; corresponding `*.test.tsx` for each.

**Verification:** `pnpm test DiffViewer SmartDiffViewer DiffTab FindingCard
FindingsPanel ReviewRunAccordion FindingsTab`; `pnpm typecheck`;
manual/browser — click "View in diff" on a finding from the Findings tab,
confirm the Files-changed tab opens, the right file expands, and it scrolls
to the right line; confirm the existing GitHub link still works unchanged.

### Phase 4 — Detailed Development Plan

Phase 4 is structurally independent of Phases 1-3 (entirely different
files: diff-viewer tree + Findings-tab tree vs. `IntentCard`/`OverviewTab`).
Two separate prop chains meet only at `page.tsx` (`FindingsTab`/`DiffTab`
are mutually-exclusive conditionally-rendered siblings, never mounted
together):
- **Downward-into-diff chain**: `page.tsx` → `DiffTab.tsx` →
  `SmartDiffViewer.tsx`/`DiffViewer.tsx` → `FileCard.tsx`.
- **Upward-from-finding chain**: `page.tsx` → `FindingsTab.tsx` →
  `ReviewRunAccordion.tsx` → `FindingsPanel.tsx` → `FindingCard.tsx`.

**Key finding that simplifies scope:** `FileCard.tsx` already has the
exact `scrollToLine?: { line: number; nonce: number }` prop and its
two-effect force-open-then-scroll pattern (`client/INSIGHTS.md`,
2026-08-14), built for `SmartDiffViewer`'s internal findings-Chip click
flow. **`FileCard.tsx` needs zero changes for Phase 4** — every layer
above it just needs to compute the right `{line, nonce}` and forward it to
the one `FileCard` whose `file.path` matches.

#### 1. `ScrollTarget` type (new, shared)

Currently a locally-defined, unexported `interface ScrollTarget` inside
`SmartDiffViewer.tsx` used only there. Since Phase 4 needs the identical
shape in `DiffViewer.tsx`, `DiffTab.tsx`, and `page.tsx` too, promote it to
`client/src/components/diff-viewer/helpers.ts` (which already exports the
folder's other cross-file type, `Line`) and re-export from `index.ts` —
per the `frontend-ui-architecture` skill's "type used by 2+ components
must live centrally" rule:

```ts
/** An external request to scroll a specific diff file's line into view.
 * nonce must be bumped on every new request so a re-click of the same
 * {path, line} still re-fires the scroll (feeds FileCard's own two-effect
 * scrollToLine pattern). */
export interface ScrollTarget {
  path: string;
  line: number;
  nonce: number;
}
```

Delete the now-duplicate local interface in `SmartDiffViewer.tsx`; import
it instead.

#### 2. `DiffViewer.tsx` — forward to the matching `FileCard`

```ts
export function DiffViewer({ files, commenting, scrollTarget }: {
  files: PrFile[];
  commenting?: DiffCommentApi;
  scrollTarget?: ScrollTarget | null;
}) {
  ...
  {files.map((f, i) => (
    <FileCard
      key={i}
      file={f}
      commenting={commenting}
      scrollToLine={
        scrollTarget && scrollTarget.path === f.path
          ? { line: scrollTarget.line, nonce: scrollTarget.nonce }
          : undefined
      }
    />
  ))}
```

A non-matching path yields `scrollToLine={undefined}` for every `FileCard`
— the missing-file degrade, for free, no extra `if` branch needed.

#### 3. `SmartDiffViewer.tsx` — rename internal, add external, merge

Rename the existing internal click-driven state:
`scrollTarget`/`setScrollTarget` → `internalScrollTarget`/
`setInternalScrollTarget`; update its two use sites. Destructure the new
prop aliased as `externalScrollTarget` (public prop name stays
`scrollTarget`, matching `DiffViewer`/`DiffTab`).

Build a path→role lookup, memoized off `smartDiff`:
```ts
const roleByPath = React.useMemo(() => {
  const m = new Map<string, SmartDiffRole>();
  for (const g of smartDiff.groups) for (const f of g.files) m.set(f.path, g.role);
  return m;
}, [smartDiff]);
```

New effect — force-open the containing section on an external nonce bump
(mirrors the existing `splitScrollNonce` effect and reuses the exact
`setOpenSections` call the split-highlight Chip's `onClick` already uses):
```ts
React.useEffect(() => {
  if (!externalScrollTarget) return;
  const role = roleByPath.get(externalScrollTarget.path);
  if (!role) return; // missing-file degrade: no section to open, no-op
  setOpenSections((prev) => (prev[role] ? prev : { ...prev, [role]: true }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [externalScrollTarget?.nonce]);
```

Merge rule — **internal wins when both target the same file** (if the
user is mid-interacting with this file's own findings Chip, an external
navigation landing on the same file shouldn't clobber that in-page
target):
```ts
const internalTarget = internalScrollTarget && internalScrollTarget.path === file.path
  ? { line: internalScrollTarget.line, nonce: internalScrollTarget.nonce } : undefined;
const externalTarget = externalScrollTarget && externalScrollTarget.path === file.path
  ? { line: externalScrollTarget.line, nonce: externalScrollTarget.nonce } : undefined;
const scrollToLine = internalTarget ?? externalTarget;
```

**Known asymmetry to document, not fix:** if the external target's path
exists in `files` but is absent from every `smartDiff.groups[].files`
(partial/stale smart-diff classification), Smart order silently can't
scroll to it (the grouped render loop iterates `smartDiff.groups[].files`,
not raw `files`) — flipping to "Original order" (`DiffViewer`) always can.
Cover as an explicit test case, not a code fix in this phase.

#### 4. `DiffTab.tsx` — thread through to whichever viewer is active

```ts
interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  canComment?: boolean;
  scrollTarget?: ScrollTarget | null;
}
```
Forward to whichever of `SmartDiffViewer`/`DiffViewer` is currently
rendered. Import `ScrollTarget` from the `@/components/diff-viewer` barrel.

#### 5. `page.tsx` — state + handler + both threads

```ts
const [diffScrollTarget, setDiffScrollTarget] = React.useState<ScrollTarget | null>(null);

function handleViewInDiff(file: string, line: number) {
  setDiffScrollTarget((prev) => ({ path: file, line, nonce: (prev?.nonce ?? 0) + 1 }));
  setTab("diff");
}
```
Plain function, not `useCallback` — no memoized child consumes it
(`react-best-practices`: "most `useCallback` calls are unnecessary").
Thread into both `<FindingsTab onViewInDiff={handleViewInDiff} />` and
`<DiffTab scrollTarget={diffScrollTarget} .../>`. `diffScrollTarget`
deliberately does not reset on tab change — page-level state, so a
second click after navigating away and back still bumps the nonce.

**Note on nonce, given full unmount/remount:** `DiffTab` fully unmounts
when on `FindingsTab` (the only place `onViewInDiff` fires from) and
remounts on `setTab("diff")` — React re-runs effects on every fresh mount
regardless of whether a dependency numerically repeats, so the nonce
isn't strictly load-bearing for correctness on *this* call path today.
Still wire it exactly as specified: it's `FileCard`'s/`SmartDiffViewer`'s
already-established prop contract, and it future-proofs against `DiffTab`
ever becoming keep-alive instead of unmounted, or `onViewInDiff` being
wired into a second always-mounted surface later (e.g. `RunTraceDrawer`,
explicitly out of scope now).

#### 6. Findings-chain prop threading (uniform signature, no per-node binding)

Per the parent plan's wording ("mirrors how `repoFullName`/`headSha` are
already threaded") — the same function reference passes through unchanged
at every layer; only `FindingCard` binds it to a specific file/line at the
point of use (`file`/`line` are static per finding, unlike `onAction`'s
per-click-varying kind argument — no closure needed at `FindingsPanel`).

- **`FindingsTab.tsx`**: add `onViewInDiff?: (file: string, line: number) => void`; forward verbatim to `ReviewRunAccordion` — no wrapper (unlike existing wrapped passthroughs, a brand-new prop doesn't need one).
- **`ReviewRunAccordion.tsx`**: same prop, forward to `FindingsPanel`.
- **`FindingsPanel.tsx`**: same prop, forward the same reference to every `FindingCard` in the `.map()`.
- **`FindingCard.tsx`**: same prop; render a small icon button in `s.metaRow`, next to the existing `MonoLink`:
```tsx
<div style={s.metaRow}>
  <MonoLink href={fileHref}>{f.file}:{lineLabel(f)}</MonoLink>
  {onViewInDiff && (
    <span onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex" }}>
      <IconBtn icon="Code" label={t("finding.viewInDiff")} size={20} onClick={() => onViewInDiff(f.file, f.start_line)} />
    </span>
  )}
  <ConfidenceNum value={f.confidence} />
</div>
```
The `stopPropagation` wrapper is required — `s.metaRow` sits inside
`s.header`'s own `onClick={() => setExpanded(...)}` div; without it,
clicking the icon would also toggle the card's expanded state (reuses
`FileCard.tsx`'s exact established `headerRight` idiom, `client/INSIGHTS.md`
2026-08-14). `IconBtn` (from `@devdigest/ui`) already sets `aria-label`
from `label`, satisfying accessibility for an icon-only control.
Add `IconBtn` to `FindingCard.tsx`'s existing `@devdigest/ui` named import.
Add `"viewInDiff": "View in diff"` to `prReview.json`'s existing `finding`
block (grepped, no pre-existing unused key fits here).

#### 7. Missing-file degrade — exact behavior

Two distinct failure modes, both must degrade gracefully (tab switches,
nothing crashes, nothing scrolls): (a) file absent from `pr.files`
entirely — no `FileCard` produces a match in either viewer; (b) file
present in `pr.files` but absent from `smartDiff.groups[].files` — Smart
order can't render/scroll to it, Original order can (the "known asymmetry"
above). `page.tsx`'s `handleViewInDiff` does **not** pre-validate file
existence — it unconditionally switches tabs; the graceful no-op is
entirely the downstream viewers' path-match-guard responsibility.

#### Tests

- New `DiffViewer.test.tsx` (doesn't exist today): `scrollTarget` matching
  a rendered file force-opens + scrolls it (stub `scrollIntoView`,
  established convention); non-matching path — renders normally, no
  scroll, no crash. Must supply both `shell` and `prReview` `next-intl`
  namespaces (`client/INSIGHTS.md`, 2026-08-14).
- `SmartDiffViewer.test.tsx` — add: external `scrollTarget` force-opens a
  collapsed section and scrolls the right `FileCard`; internal-vs-external
  collision on the same file — internal wins; external path matching
  `files` but absent from every group's `files` — no crash, no scroll (the
  known asymmetry case).
- `DiffTab.test.tsx` — add: `scrollTarget` reaches the right `FileCard` in
  both Smart-order and Original-order modes; non-matching path is a no-op
  in both.
- `FindingCard.test.tsx` — add: icon button absent when `onViewInDiff`
  omitted; present and fires `onViewInDiff(f.file, f.start_line)` when
  provided, without toggling `expanded`.
- New `FindingsTab.test.tsx` (doesn't exist today) — **one** integration
  test: render with a real finding, click "view in diff", assert
  `onViewInDiff` fires with `(finding.file, finding.start_line)`. This is
  deliberately the only new coverage for `ReviewRunAccordion`'s/
  `FindingsPanel`'s forwarding — both are pure passthroughs with no new
  branching, so per-layer duplicate tests would be redundant.
- No new `page.tsx` test file — matches this route's existing convention;
  wiring is exercised transitively by the above plus the manual pass.
- Use `fireEvent` (not `userEvent`) and `vi.mock` for hooks throughout,
  matching every existing test in this tree — this repo's established
  convention overrides the generic `react-testing-library` skill default.

#### Work Items / Acceptance Criteria

- [ ] `ScrollTarget` lives once in `helpers.ts`, re-exported via `index.ts`; no duplicate local interface remains in `SmartDiffViewer.tsx`.
- [ ] `DiffViewer.tsx` accepts optional `scrollTarget`, forwards only to the path-matching `FileCard`; omitted prop is a no-op.
- [ ] `SmartDiffViewer.tsx`'s internal state renamed `internalScrollTarget`/`setInternalScrollTarget`, all pre-existing Phase 5/6 tests still pass unmodified.
- [ ] `SmartDiffViewer.tsx` accepts optional external `scrollTarget`, force-opens the containing role section on nonce change, merges internal-if-matches ?? external-if-matches.
- [ ] `DiffTab.tsx` accepts optional `scrollTarget`, forwards to whichever viewer is active.
- [ ] `page.tsx` holds `diffScrollTarget` state, `handleViewInDiff` bumps nonce + switches tabs, threaded into both `FindingsTab.onViewInDiff` and `DiffTab.scrollTarget`.
- [ ] `onViewInDiff` threaded unchanged through `FindingsTab` → `ReviewRunAccordion` → `FindingsPanel` → `FindingCard`.
- [ ] `FindingCard.tsx` renders a `stopPropagation`-wrapped `IconBtn` next to `MonoLink`, only when `onViewInDiff` provided; doesn't toggle expanded state.
- [ ] New `finding.viewInDiff` i18n key added and used (not hardcoded).
- [ ] Missing-file degrade verified in both failure modes, no crash, no scroll.
- [ ] New/updated tests per the list above all green; no `MISSING_MESSAGE` in Vitest stderr.
- [ ] `pnpm typecheck` clean in `client/`.
- [ ] Manual/browser round-trip: click works, tab switches, correct file/line scrolls, works again after leaving and returning to the tab; existing GitHub deep-link unchanged.
- [ ] `pr-self-review` run after PR creation/push; `engineering-insights` at session end.

## Aggregate Verification (all phases)

- Server: full unit + integration suites green, `pnpm typecheck`.
- Client: full test suite green, `pnpm typecheck`.
- `pnpm db:migrate` applies Phase 1's migration cleanly.
- Manual/browser pass: PR Brief banner + redesigned Intent/Risk Areas card
  render above Description; Findings→diff round-trip works; no regression
  to the GitHub deep-link, Smart Diff toggle, or per-run VerdictBanner.
- `pr-self-review` immediately after `gh pr create` and after every push.
- `engineering-insights` at the end of the session (or per phase).

**Verification status (2026-08-14):** server unit (320 tests) + integration
(75 tests, real Postgres) and client (175 tests) all green; `pnpm typecheck`
clean in both packages; `pnpm db:migrate` applied migration `0024` cleanly.
Manual/browser passes done for Phase 2 (PR Brief banner, mixed-verdict
batch), Phase 3 (Intent/Risk Areas redesign, screenshot matched the
mockup), and Phase 4 (Findings→diff round trip against a real PR with 6
findings, verified via Playwright DOM inspection — GitHub deep-link
confirmed unchanged). Phase 1's own manual "derive intent on a real PR"
step was deliberately **not** run — a real, billed OpenRouter call was
already made once by accident while debugging Phase 1's integration test
(see `server/INSIGHTS.md`, 2026-08-14), and every later phase's manual
checks intentionally reused already-reviewed data instead of triggering a
fresh derive/review to avoid a second charge. `pr-self-review` has not yet
been run — no PR has been opened for this branch yet.

## Note on this session

This plan was researched and drafted in the same session that just shipped
Smart Diff (PR #16, unmerged) and fixed two live-verified UX bugs in its
split-suggestion banner (generic "Split N" chip names, no scroll-on-highlight
— see `docs/smart-diff-plan.md` and PR #16's commit history). The user asked
to save this plan to disk and continue implementation in a separate
session. The mockup review and layout/risk-style decisions above were made
in that follow-up session (2026-08-14), before implementation started.

**Status:** done — all 4 phases implemented and verified (2026-08-14). Server
+client typecheck and full test suites green throughout; manual/browser
verification done for Phases 2-4 (Phase 1's was deliberately deferred to
avoid a second billed LLM call — see the Aggregate Verification note below).
