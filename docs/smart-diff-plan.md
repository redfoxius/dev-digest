# Smart Diff — classifier + route + `SmartDiffViewer`

**Status:** in progress — Phases 1-5 implemented and tested. Phase 1
(classifier) + Phase 2 (`GET /pulls/:id/smart-diff`):
`server/src/modules/smart-diff/{constants,classifier,service}.ts`, contract
change in both `brief.ts` copies, unit + `.it.test.ts` suites green, manually
verified live against two real PRs. Phase 3 (`SmartDiffViewer`):
`client/src/components/diff-viewer/SmartDiffViewer/`, additive `CodeLine`/
`FileCard` props (incl. a `headerRight` slot added during review to fix a
duplicate-file-path render the first draft shipped), 8/8 component tests,
full client suite 135/135. Phase 4 (`DiffTab` toggle wiring): `SmartDiffViewer`
is now reachable in the app; typecheck + full client suite (138/138) green,
**but the live in-browser click-through (toggle appears, groups render,
boilerplate collapsed, scroll works) has not actually been done yet** —
`claude-in-chrome`'s browser extension wasn't connected when this phase
landed. Do this manual check before considering Phase 4 fully done, not just
code-reviewed. Phase 5 (`pseudocode_summary`): `Review.file_summaries` (both
`findings.ts` vendor copies, shipped as `.nullish()` not the plan's literal
`.optional()` — a bare `.optional()` array field triggers a real
`toJsonSchema`/OpenAI `zodResponseFormat` warning that "will become an error
in a future SDK version"), all three seeded reviewer prompts
(`server/src/db/seed-prompts.ts`) instructed to emit it, new
`review_file_summaries` table + migration `0023_icy_photon.sql`,
`ReviewRepository.insertFileSummaries`/`getFileSummariesForReviews` (the
latter reusing the SAME `reviewIds` `getLatestReviewBatchFindings` already
computes, not a second "latest batch" query), wired through
`run-executor.ts` and `SmartDiffService`, and rendered in `SmartDiffViewer`/
`FileCard` (a header Chip + an open-state "What this does:" text block).
Server unit (303) + integration (70, incl. a new Phase 5 case) green,
migration applied to local dev Postgres; client typecheck + full suite
(141/141, incl. 3 new Phase 5 cases) green. Phase 6 not started.

## Context

Smart Diff sorts a PR's changed files by review risk so a reviewer sees business
logic first, not lock files or generated code. It is fully deterministic — no
new LLM call — built purely from data already available after a PR import:
`GET /pulls/:id` (`path`, `additions`, `deletions`, `patch` per file) and, once
a review has run, `GET /pulls/:id/reviews` (`file`, `line`, `severity` per
finding).

The target shape already exists end-to-end in the shared contract —
`SmartDiffRole = 'core' | 'wiring' | 'boilerplate'`, `SmartDiffGroup { role,
files[] }`, `SmartDiff { groups[], split_suggestion }`
(`server/src/vendor/shared/contracts/brief.ts:91-124`, mirrored in
`client/src/vendor/shared/contracts/brief.ts`) — but nothing produces it yet,
and a gap-analysis pass (below) found `SmartDiffFile` itself one field short
of what the mockup needs (per-line severity), so Phase 2 grows it — see
"Confirmed decisions" and Phase 2. `server/src/modules/index.ts:23` already
names `intent/smart-diff` as a Part-0 roadmap module; `intent/` shipped,
`smart-diff/` doesn't exist.

**This plan now covers six phases**, added incrementally per the user's
requests:
- **Phase 1** — the deterministic classifier: given a changed file's path +
  diff size, decide its `SmartDiffRole`, plus its constants file.
- **Phase 2** — `GET /pulls/:id/smart-diff`: a route that takes the PR's
  files and the findings of its latest review, and returns the full
  `SmartDiff` contract.
- **Phase 3** — `SmartDiffViewer`: the client component that renders the
  grouped diff — `core`/`wiring` groups open, `boilerplate` collapsed by
  default, a clickable "N findings" badge per file, and a smooth scroll to
  the clicked finding's line.
- **Phase 4** — wires `SmartDiffViewer` into `DiffTab` behind a real
  "Smart order"/"Original order" segmented control.
- **Phase 5** — `pseudocode_summary`: generated as a byproduct of the
  *existing* Run Review LLM call (no new LLM call), persisted per file,
  read by Smart Diff.
- **Phase 6** — real `split_suggestion`: deterministic clustering over
  `repo-intel`'s already-built import graph (no LLM), surfaced as a banner
  with click-to-highlight in `SmartDiffViewer`.

Nothing is deferred as "out of scope" anymore — Phases 5-6 close what were
the last two open gaps (see "Confirmed decisions" below for how each was
resolved).

**One remaining unresolved mockup detail, flagged rather than guessed:** the
mockup shows a small colored dot right after each file's path in its header
row (e.g. `src/middleware/ratelimit.ts ●`). No existing component in
`diff-viewer/` renders any such marker today, and nothing in the original
brief or this plan's sources explains what it would represent (read/unread?
has-comments? just decorative?). Left out of every phase above rather than
guessed at — worth asking about specifically if/when it turns out to matter.

**Confirmed decisions (Phase 1, asked the user directly, both recommended
options taken):**
- `package.json` **and** its lockfile count as `boilerplate`, not `wiring` —
  version bumps are mechanical; a real dependency-risk signal is a job for a
  future, separate flag, not for breaking the sort order.
- A **size-escalation threshold** exists: a file that matches a `wiring`
  pattern (e.g. `config.ts`, an `index.ts` barrel) but whose diff
  (`additions + deletions`) exceeds a threshold is promoted to `core` — a
  "config" file with a suspiciously large diff usually hides real logic.
  `boilerplate` patterns (lockfiles/dist/snapshots) are never escalated —
  they're boilerplate regardless of size.

**Confirmed decisions (gap-analysis pass, asked the user directly):**
- **Per-line severity is a real contract change, not just a client concern.**
  The mockup shows a colored severity badge next to each affected line, but
  `SmartDiffFile.finding_lines` was a bare `number[]` — not enough to render
  that. The contract itself grows (see Phase 2 + Phase 3 below), covering
  each finding's full `start_line..end_line` range, not just its first line.
- **Classifier patterns cover Go/Python/Rust now**, not JS/TS-only, reusing
  `repo-intel`'s existing `EXCLUDED_DIRS`/language awareness as the source of
  truth for directory-level boilerplate instead of hand-rolling a second,
  JS-centric list (see Phase 1 below).
- **`accepted_at` findings still count** in `finding_lines`/badges — accepted
  ≠ resolved, it's still a real, reviewer-confirmed finding worth surfacing.
  Only `dismissed_at`-set findings are excluded (Phase 2's filter already did
  this; now stated explicitly since it was ambiguous).
- **An all-`boilerplate` PR needs no special empty state.** If `core`/
  `wiring` are both absent (e.g. a pure lockfile-bump PR), a collapsed
  `boilerplate` section is an acceptable result on its own — no "nothing to
  review here" banner needed.
- **The order toggle is a real two-button segmented control** ("Smart order"
  / "Original order" as two pill buttons, reusing `Chip`'s `active` state),
  not the boolean-switch simplification first proposed — see the revised
  Phase 4 below. This matches the mockup's *toggle style*; it does **not**
  reproduce the mockup's full two-row header (a separate "REVIEWER-ORDERED
  DIFF" caption row above the file-count row) — the toggle is folded into
  `DiffTab`'s single existing `SectionLabel` row instead of adding a second
  header row, a deliberate reuse-over-pixel-fidelity call, not an oversight.
- **`pseudocode_summary` rides the existing Run Review LLM call** (Phase 5)
  — no new/second LLM call, no new cost line item. The reviewer that's
  already invoked by "Run Review" is asked to also emit one line per changed
  file; Smart Diff only ever *reads* what that call already produced,
  exactly like it already does for findings.
- **`split_suggestion` is computed from `repo-intel`'s existing import graph**
  (Phase 6) — no LLM call here either. Weakly-connected components among a
  PR's changed `core` files (using the already-persisted `file_edges` table)
  become the proposed splits; the UI is a banner with click-to-highlight,
  not an automatic PR-splitting action.

## Phase 1 — classifier

New module `server/src/modules/smart-diff/`, following this repo's existing
module-anatomy convention (`server/AGENTS.md`, and the `intent/` module
precedent at `server/src/modules/intent/types.ts` — a capability module with
no `repository.ts` because it owns no persisted resource of its own).

- **`server/src/modules/smart-diff/constants.ts`** — every pattern list and
  the size threshold, phase-tagged like `repo-intel/constants.ts:1-3`'s
  `[T1]`/`[T2]` convention (here: `[Phase1]` used now):
  - `WIRING_BASENAME_PATTERNS`: exact basenames, now spanning every language
    `repo-intel` already indexes, not just JS/TS — `index.ts`/`.tsx`/`.js`/`.jsx`,
    `server.ts`/`.js`, `app.ts`/`.js`, `main.ts`/`.js`, `config.ts`/`.js`,
    `container.ts`, `di.ts` (JS/TS); `main.go` (Go); `main.rs`, `mod.rs`
    (Rust); `__init__.py`, `manage.py`, `wsgi.py`, `asgi.py`, `settings.py`
    (Python — Django/WSGI/ASGI entrypoints, same "bootstrap, not business
    logic" reasoning as `server.ts`/`app.ts`).
  - `WIRING_SUBSTRING_PATTERNS`: `'.config.'` (catches `webpack.config.js`,
    `vite.config.ts`, `tailwind.config.js`, etc. — the generic "*.config.*"
    shape a basename list can't enumerate).
  - `BOILERPLATE_BASENAME_PATTERNS`: `package.json`, `package-lock.json`,
    `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`,
    `Cargo.lock`, `Gemfile.lock`, `poetry.lock`, `Pipfile.lock`,
    `composer.lock`, `go.sum`.
  - `BOILERPLATE_SUBSTRING_PATTERNS` — **reuses `EXCLUDED_DIRS` from
    `server/src/modules/repo-intel/constants.ts:18-27`**
    (`node_modules`, `dist`, `build`, `coverage`, `.next`, `out`, `vendor`,
    `.git`, each wrapped `/x/` for path-segment matching) as the base list,
    imported rather than re-typed by hand — `vendor/` in particular is
    exactly Go's own boilerplate-dependency-snapshot directory, so this
    reuse buys Go coverage for free instead of guessing a second time. On
    top of that base, `smart-diff`-only additions `EXCLUDED_DIRS` doesn't
    carry: `/target/` (Rust build output), `/__pycache__/`, `/.venv/`,
    `/venv/`, `.egg-info/` (Python), plus the language-agnostic
    file-level patterns `.min.js`, `.min.css`, `.map`, `.snap`,
    `__snapshots__/`, `.generated.`, `.pb.go` (generated Go protobuf).
  - `WIRING_ESCALATION_LINE_THRESHOLD = 50` (additions + deletions) — the
    "large diff in a wiring-shaped file" promotion rule. **This number is
    an untested starting guess, not a user-confirmed figure** — only the
    *mechanism* (escalate past some threshold) was confirmed; 50 is
    Claude's pick and should be treated as easy to retune once real PRs are
    seen, same as `SPLIT_SUGGESTION_TOO_BIG_LINE_THRESHOLD` (Phase 2 point
    4, also an unconfirmed suggested default).

- **`server/src/modules/smart-diff/classifier.ts`** — the pure function:

  ```ts
  export function classifyFile(file: Pick<PrFile, 'path' | 'additions' | 'deletions'>): SmartDiffRole
  ```

  Reuses the existing `PrFile` type from `@devdigest/shared`
  (`server/src/vendor/shared/contracts/platform.ts:202-208`) instead of
  declaring a new input type, and returns the existing `SmartDiffRole`
  (`brief.ts:92`). Logic, mirroring the substring-match style already used by
  `isJunkPath`/`JUNK_PATH_PATTERNS` in
  `server/src/modules/repo-intel/service.ts:776-804` (lowercase, deterministic
  substring/basename checks, no regex needed):
  1. `boilerplate` if the basename or path matches any boilerplate pattern —
     checked first, never escalated.
  2. Else `wiring` if the basename or path matches any wiring pattern, unless
     `additions + deletions > WIRING_ESCALATION_LINE_THRESHOLD`, in which
     case `core`.
  3. Else `core` (the default — anything not clearly config/index or
     mechanical/generated is business logic worth a close read).

  A small local `basename(path)` helper (split on `/`, take the last segment)
  is all that's needed — no new dependency.

## Phase 2 — `GET /pulls/:id/smart-diff`

Adds the route to `server/src/modules/reviews/routes.ts`, not to a new
`smart-diff/routes.ts` — this mirrors the existing precedent for PR-scoped,
computed (non-CRUD) GET endpoints that aren't literally about review
authoring: `/pulls/:id/runs/active`, `/pulls/:id/reviews`, and
`/pulls/:id/intent` all already live in that same file even though `intent`
has its own `modules/intent/` directory for its service logic. Smart Diff's
own `service.ts` follows that split: computation lives in
`smart-diff/service.ts`, the HTTP entry point lives in `reviews/routes.ts`.

**`server/src/modules/smart-diff/service.ts`** — new `SmartDiffService`,
constructed with `Container` (same shape as `ReviewService`/`IntentDeriverService`).
`getSmartDiff(workspaceId, prId): Promise<SmartDiff>` composes:

1. **Files** — `container.reviewRepo.getPrFiles(prId)` (already exists,
   `server/src/modules/reviews/repository.ts:38-39` /
   `repository/pull.repo.ts:29` — a direct `pr_files` read, no git clone
   involved, exactly the `{path, additions, deletions, patch}` shape needed).
   Reused as-is; no new query.
2. **Latest review's findings** — the PR's most recent review *batch* (one
   `POST /pulls/:id/review` action may fan out to several agents sharing
   `multi_agent_run_id`), not just the single newest review row. This exact
   batch-key algorithm (`batchKey = review.runId → agentRuns.multiAgentRunId
   ?? review.id`; rows ordered newest-first; the first batch key seen per PR
   pins "the latest batch") already exists, inlined, in
   `server/src/modules/pulls/routes.ts:150-225` — and that file's own
   comments flag *why* naively picking "the single latest row" is wrong (a
   clean agent finishing last in a batch would mask another agent's real
   findings from the same batch). Phase 2 re-derives the same rule scoped to
   one `prId` (a `WHERE reviews.pr_id = :prId AND reviews.kind = 'review'`
   query joined to `agent_runs`, ordered by `created_at DESC`, same
   first-seen-pins-batch logic) rather than reusing the multi-PR list
   version verbatim — the query shapes differ enough (bulk-by-many-PRs vs.
   one PR) that duplicating the ~15-line rule is clearer than forcing a
   shared abstraction across both call sites for now. Findings are filtered
   to **`dismissed_at IS NULL` only** (matching `pulls/routes.ts`'s existing
   filter) — an `accepted_at`-set finding is still included; accepted ≠
   resolved, only a dismissed finding is treated as "not real." Findings are
   grouped by `file` path. If no review has run yet, this list is empty —
   Smart Diff still works (ordering with no finding badges yet), matching
   the "works before Run Review" requirement.
3. **Classify + group** — run `classifyFile()` (Phase 1) over every file,
   bucket into `SmartDiffGroup[]` in a fixed presentation order (`core`,
   `wiring`, `boilerplate` — matches the mockup), preserving each group's
   original `pr_files` order within it, **omitting any role with zero files**
   (a PR with no config/index changes simply has no `wiring` entry in
   `groups[]` — no empty section for the client to special-case).
   `pseudocode_summary` stays `null` — it's an LLM-authored field
   (`.nullish()` in the contract) and generating it is explicitly out of
   scope for this deterministic route.

   **Contract change** (`vendor/shared/contracts/brief.ts`, both the
   `server/` and `client/` copies, edited together per root `CLAUDE.md`'s
   "Non-default conventions"): `SmartDiffFile.finding_lines` changes from
   `z.array(z.number().int())` to
   `z.array(z.object({ line: z.number().int(), severity: Severity }))`
   (`Severity` imported from `./findings.js`, already `z.enum(['CRITICAL',
   'WARNING', 'SUGGESTION'])` at `findings.ts:11-12` — reused, not
   redeclared). A new sibling field is also added:
   `findings_count: z.number().int()` — the count of **distinct** findings
   touching the file. These two fields serve different, easily-confused
   purposes and both are needed: `finding_lines` (one entry per
   *highlighted line*) can have more entries than there are findings once a
   single finding's `start_line..end_line` range is expanded, while
   `findings_count` (one per *finding*) is what the "N findings" badge in
   Phase 3 must show — using `finding_lines.length` for that badge would
   over-count any multi-line finding.

   `finding_lines` is built by: for every non-dismissed finding on the file,
   expand `start_line..end_line` into individual line numbers; group by
   line; where two findings overlap on the same line, keep the **worse**
   severity (`CRITICAL` > `WARNING` > `SUGGESTION`, a small local
   `SEVERITY_RANK` map — no existing rank constant to reuse, this list is
   short enough to own locally); **sort the result ascending by `line`**
   before returning — Phase 3's "click the findings badge" step scrolls to
   `finding_lines[0]`, so an unsorted array would jump to an arbitrary
   finding instead of the topmost one. `findings_count` is simply the
   file's non-dismissed finding count from step 2, unexpanded.
4. **`split_suggestion`** — computed but intentionally minimal this phase:
   `total_lines` = sum of `additions + deletions` across all files;
   `too_big` = `total_lines > SPLIT_SUGGESTION_TOO_BIG_LINE_THRESHOLD` (new
   `[Phase2]` constant in `smart-diff/constants.ts`, suggested default
   `500`); `proposed_splits` is always `[]` — the contract's array type
   allows an honest "no suggestion yet" without breaking the response shape.
   Actually proposing *how* to split a PR is a separate, meatier heuristic
   (or LLM call) deferred to a later phase; flagged here so it isn't mistaken
   for a bug.

**Route** (`reviews/routes.ts`):
```
GET /pulls/:id/smart-diff → SmartDiff
```
Zod `params: IdParams` (same as every other `/pulls/:id/*` route in that
file), `getContext(container, req)` for the workspace check + `NotFoundError`
on a missing/foreign PR (same pattern as `getIntent`), then
`service.getSmartDiff(workspaceId, req.params.id)`.

## Phase 3 — `SmartDiffViewer` (client)

A new component, sibling to the existing flat `DiffViewer` (not a
replacement — `DiffTab`'s later "Original order" toggle state still needs
the plain one), reusing that same folder's existing pieces rather than
duplicating them: `FileCard` for a single file's collapsible patch view,
`comments.ts` for comment-thread anchoring (untouched), `parsePatch()`/`Line`
from `helpers.ts` (untouched). Two small, backward-compatible additions to
existing files make the new behavior possible:

- **`CodeLine.tsx`** — two additive changes:
  - a `data-line={ln.newNo}` attribute on the rendered row (currently
    exposes no line-addressable DOM hook at all, per Phase 3 research) —
    `newNo` is the same "new-side" line number `finding_lines` now reports.
  - a new optional `findingSeverity?: Severity` prop: when present, render
    the existing `SeverityBadge` (compact variant — the same component
    `FindingCard.tsx:58` already uses, `vendor/ui/primitives/Badge.tsx:52-88`)
    inline at the end of the row, matching the mockup's per-line badge
    position. This is the actual "line highlighting" the original brief
    asked for — no new badge component, just a new call site for the
    existing severity-colored one, using this app's own `Critical
    `/`Warning`/`Suggestion` labels (`tokens.ts:10-12`), never the mockup's
    fictional "blocker" wording.
- **`FileCard.tsx`** — today it always self-computes its open state from
  `AUTO_EXPAND_MAX_LINES` (`FileCard.tsx:35-37`) with no way for a caller to
  override it. Add three new optional props, all no-ops for every existing
  caller (flat `DiffViewer` keeps working unchanged):
  - `defaultOpen?: boolean` — when provided, replaces the internal
    size-based calculation.
  - `scrollToLine?: { line: number; nonce: number }` — when this object
    changes (comparing by `nonce`, exactly the pattern already used by
    `ReviewRunAccordion.tsx:46-54` for its `targetRunId`/`targetNonce`, so
    clicking the same target twice still re-fires the scroll), force `open`
    to `true` and, in a `useEffect`, do
    `containerRef.current?.querySelector(\`[data-line="${line}"]\`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })`.
  - `findingSeverityByLine?: Map<number, Severity>` — looked up per rendered
    `Line` (by `ln.newNo`) and passed straight through as each `CodeLine`'s
    new `findingSeverity` prop.

**`client/src/lib/hooks/smart-diff.ts`** — new hook file (one per API domain,
per `client/AGENTS.md`), `usePrSmartDiff(prId)` mirroring `usePrIntent`
verbatim (`client/src/lib/hooks/reviews.ts:62-68`): `useQuery({ queryKey:
["pr-smart-diff", prId], queryFn: () => api.get<SmartDiff>(`/pulls/${prId}/smart-diff`), enabled: !!prId })`.

**`client/src/components/diff-viewer/SmartDiffViewer/SmartDiffViewer.tsx`** —
new component, `{ smartDiff: SmartDiff; files: PrFile[]; commenting?:
DiffCommentApi }` props (`files` is still needed because `SmartDiffFile`
carries no `patch` — the component builds a `Map<path, PrFile>` once to hand
each classified file's full row to `FileCard`). Behavior:

1. One collapsible section per `SmartDiff.groups[]` entry, rendered in the
   order the API already returns (`core`, `wiring`, `boilerplate`), each
   labeled via `next-intl` (role → title + one-line description, matching
   the mockup: "Core logic — review closely" / "Wiring — hooks the core into
   the app" / "Boilerplate — generated/mechanical, skim") plus its file
   count **and a small colored square before the title** (the mockup marks
   each section with a role color — blue/orange/gray). No existing
   role-color token exists anywhere in this codebase (only severity's `SEV`
   map, `tokens.ts:6-13`) — a new, small local `ROLE_COLORS: Record<SmartDiffRole,
   string>` is added next to `SmartDiffViewer` for this one purpose. Section
   collapse state: local `useState<Record<SmartDiffRole, boolean>>`,
   defaulting `core`/`wiring` to open and **`boilerplate` to closed** — the
   group-level override this message asks for, independent of any individual
   file's size or findings.
2. Per-file default-open (only matters once its section is open): passed to
   `FileCard` via the new `defaultOpen` prop as `role !== 'boilerplate' &&
   (findings_count > 0 || additions + deletions <= AUTO_EXPAND_MAX_LINES)` —
   preserves today's size-based auto-expand *and* the original brief's
   "auto-expand files with findings," while `boilerplate` files always start
   collapsed regardless of either.
3. "N findings" badge: the existing clickable `Chip` primitive
   (`vendor/ui/primitives/Chip.tsx` — already supports `count` + `onClick`,
   no new component needed), rendered next to a file's path whenever
   `findings_count > 0`, showing `findings_count` (not `finding_lines.length`
   — a multi-line finding must not inflate this number). Click sets local
   `scrollTarget = { path, line: file.finding_lines[0].line, nonce:
   scrollTarget.nonce + 1 }` (scrolls to the file's first highlighted line;
   the nonce always increments so a second click on the same badge still
   re-scrolls).
4. `scrollTarget` is passed down only to the one `FileCard` whose `path`
   matches, as its new `scrollToLine` prop — every other file's `FileCard`
   gets `undefined` (unchanged behavior). Every file also gets its
   `findingSeverityByLine` built once from its own `finding_lines` (a plain
   `Map(file.finding_lines.map(f => [f.line, f.severity]))`), regardless of
   whether it's the scroll target — the per-line badges from point 1 render
   for any open file, not just the clicked one.

Explicitly not in this phase: rendering `pseudocode_summary` (server always
returns `null` for it until Phase 5) and any `split_suggestion` UI (Phase 6).

## Phase 4 — wire `SmartDiffViewer` into `DiffTab` behind a toggle

Makes `SmartDiffViewer` reachable in the running app. Only
`DiffTab.tsx` changes (`client/src/app/repos/[repoId]/pulls/[number]/
_components/DiffTab/DiffTab.tsx:1-65`, read in full for this plan) — no
change to `SmartDiffViewer`, `DiffViewer`, or the route.

- Add `const { data: smartDiff } = usePrSmartDiff(prId);` alongside the
  existing `usePrComments(prId)` call (`DiffTab.tsx:19`).
- `const canUseSmartOrder = !!smartDiff?.groups.some((g) => g.files.length > 0);`
  — while the query is loading, erroring, or the PR genuinely has zero
  files, there's nothing to group, so the toggle doesn't render at all and
  `DiffTab` silently falls back to today's flat `DiffViewer`. This mirrors
  the same "never let a derived/enrichment call break the base view"
  principle already used server-side (e.g. GitHub sync failures in
  `pulls/routes.ts` degrade to serving persisted data, never a 5xx) — a
  broken or slow `/smart-diff` call must not take down the Files-changed
  tab's core function of showing the diff.
- `const [smartOrder, setSmartOrder] = React.useState(true);` — a new local
  toggle, plain `useState` exactly like the existing `showComments` state
  right above it (`DiffTab.tsx:22`) — no URL persistence, consistent with
  that sibling toggle's existing behavior (resets on reload, not deep-linked).
- **Revised per explicit request ("зроби як на мокапі"): a real two-button
  segmented control, not a boolean switch.** The mockup shows two separate
  pill buttons ("Smart order" filled/active, "Original order" ghost), which
  is exactly the existing `Chip` primitive's shape
  (`vendor/ui/primitives/Chip.tsx` — already supports `active` +
  `onClick`, no new component needed): a filled/accent border+background
  when `active`, ghost otherwise. Two adjacent `Chip`s, rendered only when
  `canUseSmartOrder`:
  ```tsx
  <Chip active={smartOrder} onClick={() => setSmartOrder(true)}>Smart order</Chip>
  <Chip active={!smartOrder} onClick={() => setSmartOrder(false)}>Original order</Chip>
  ```
  `DiffTab.tsx` doesn't use `next-intl` today (its existing "Files changed ·
  N files" / "Show comments" strings are plain literals) — the new labels
  follow that same local convention, no i18n namespace added here.
- `SectionLabel`'s `right` slot (`DiffTab.tsx:47-58`) currently holds only
  the comments-visibility `Button`. Both the new toggle and that button now
  share the slot inside one flex row (`SectionLabel` itself already applies
  `marginLeft: auto` to whatever `right` receives —
  `vendor/ui/primitives/SectionLabel.tsx:16-27` — so no layout change needed
  beyond wrapping the two in a `<div style={{ display: 'flex', gap: 12,
  alignItems: 'center' }}>`).
- Body: `showSmart = smartOrder && canUseSmartOrder` picks
  `<SmartDiffViewer smartDiff={smartDiff!} files={files} commenting={commenting} />`
  vs. the existing `<DiffViewer files={files} commenting={commenting} />` —
  the `commenting` object built earlier in the function
  (`DiffTab.tsx:26-41`) is unchanged and reused by both.

## Phase 5 — `pseudocode_summary` (piggybacks on Run Review, no new LLM call)

The existing `POST /pulls/:id/review` LLM call gains a new output field;
Smart Diff itself still never calls a model — it only reads what that call
already produced, the same relationship it already has with `findings`.

1. **Structured-output schema** — `Review` in
   `server/src/vendor/shared/contracts/findings.ts:74-88` (and the client
   copy) gains `file_summaries: z.array(z.object({ file: z.string(),
   summary: z.string().max(200) })).optional()`, alongside the existing
   `verdict`/`summary`/`score`/`findings`. Capped length keeps it a
   one-liner, matching the mockup's "What this does:" style, not a
   paragraph.
2. **Prompt** — the seeded agent system prompt
   (`server/src/db/seed-prompts.ts:59-80`) currently only teaches
   findings-only mode ("if you find nothing significant, return an EMPTY
   findings list"); it gains one new instruction: describe *every* changed
   file in one sentence, independent of whether it has findings — otherwise
   the model would naturally only describe files it flagged, leaving
   boilerplate/wiring files with no summary (acceptable — nobody needs a
   summary of `package-lock.json` — but every `core`/`wiring` file should
   get one).
3. **Persistence** — a new table, mirroring the existing per-file grain of
   `findings` (`server/src/db/schema/reviews.ts:37-66`) but far simpler —
   `review_file_summaries { id, review_id → reviews.id (cascade), file,
   summary }`, new migration (next number after `0021_lame_solo.sql`, i.e.
   `0022_*`). A new `insertFileSummaries(db, reviewId, summaries)` next to
   the existing `insertFindings` (`review.repo.ts:31-60`), called from
   `run-executor.ts:288-303` right where `keptFindings` is already
   extracted and persisted — `outcome.review.file_summaries` threads
   through the exact same call site.
4. **Read side** — `SmartDiffService.getSmartDiff` (Phase 2) gains a new
   repository read, `getFileSummariesForReviews(reviewIds)`, scoped to the
   *same* latest-batch review-id set already computed for findings — no
   second "latest batch" computation, the ids are already in hand from step
   2 of Phase 2. Maps by `file` path into each `SmartDiffFile.pseudocode_summary`.
5. **Rendering — two distinct spots, not one.** A second look at the mockup
   shows `pseudocode_summary` surfaces in two places, not just the expanded
   body text: a small **"summary" indicator `Chip`** on the file's header
   row (visible even while the `FileCard` is collapsed — same row as the
   +/- stat, next to the findings `Chip` from Phase 3), rendered whenever
   `pseudocode_summary != null`; and the actual **"What this does: …" text
   block**, rendered only once the card is open, right below the header.
   This was missed in Phase 3's original pass (which only planned the
   findings badge) and is corrected here now that the field has a real
   producer.

**Not attempted here:** guaranteeing 100% file coverage from the model is a
prompt-quality concern, not a correctness one — a file the model skipped
just keeps `pseudocode_summary: null` (already a valid, already-handled
state per the existing `.nullish()` contract field).

## Phase 6 — real `split_suggestion` (import-graph clustering, no LLM)

**Backend** — new pure function, `server/src/modules/smart-diff/split.ts`,
consumed by `SmartDiffService`'s existing `split_suggestion` step (Phase 2
point 4):

1. Reuse `container.repoIntel`'s already-persisted import graph —
   `getEdges(repoId)` (`repo-intel/repository.ts:436-441`, reading the
   `file_edges` table, `repo-intel/schema.ts:64-77`) — the exact same data
   `getCriticalPaths`/PageRank already consume, no new indexing work.
2. Filter edges to those where **both** endpoints are in the PR's changed
   `core` file set (`wiring`/`boilerplate` files are excluded from
   clustering — they're not what a reviewer is being asked to split).
3. Compute weakly-connected components over that induced subgraph. Neither
   `graphology` nor `graphology-metrics` (already dependencies) ships a
   components algorithm — confirmed nothing else in this codebase uses one
   yet, only PageRank (`repo-intel/pipeline/rank.ts:41`). A small hand-rolled
   BFS/union-find over the (already tiny — one PR's changed files) node set
   is enough; adding the `graphology-components` package is the alternative
   if the implementer prefers a library, but isn't required for a graph
   this size.
4. Each component → one `ProposedSplit { name, files }`. `name` is derived
   deterministically from the files' common path prefix (e.g.
   `src/api/public`), falling back to `"Split 1"`/`"Split 2"`/… when no
   common prefix exists — no LLM naming.
5. A changed `core` file with no edges to any other changed `core` file
   still becomes its own single-file component — no special-casing to merge
   singletons into a catch-all bucket; keeping the rule uniform is simpler
   than deciding a merge threshold, and an accurate "these N files are
   unrelated to anything else changed" signal is itself useful information.
6. If `container.repoIntel` is unavailable or the repo isn't indexed
   (`REPO_INTEL_ENABLED` off, or a fresh/unindexed repo — the exact
   already-known degradation case in root `CLAUDE.md`'s Gotchas), this step
   returns `proposed_splits: []` and leaves `too_big`/`total_lines`
   (Phase 2, already computed without repo-intel) untouched — the same
   "never let an enrichment source break the base response" rule Phase 4
   already applies to the client side.

**Frontend** — a new small section in `SmartDiffViewer`, above the group
list, rendered only when `split_suggestion.too_big`: a banner ("This PR is
large — `total_lines` lines. Consider splitting:") with one clickable `Chip`
per `ProposedSplit` (same primitive reused for the order control in Phase
4), showing `name` + a file count. Clicking a split's `Chip` sets local
`highlightedSplit: string[] | null` (that split's file paths); every
rendered `FileCard` whose `path` is *not* in `highlightedSplit` gets dimmed
(reduced opacity via a new `dimmed?: boolean` `FileCard` prop — additive,
same no-op-for-existing-callers pattern as Phase 3's other new props), not
hidden — clicking the same `Chip` again (or a small "clear" affordance)
resets `highlightedSplit` to `null`. No PR is actually created or split by
this UI; it's a suggestion surface only.

## Files touched

- `server/src/modules/smart-diff/constants.ts` (new, Phase 1 + Phase 2 additions)
- `server/src/modules/smart-diff/classifier.ts` (new, Phase 1)
- `server/src/modules/smart-diff/service.ts` (new, Phase 2)
- `server/src/modules/reviews/routes.ts` (Phase 2: new route + `SmartDiffService` wiring)
- `server/src/vendor/shared/contracts/brief.ts` **and**
  `client/src/vendor/shared/contracts/brief.ts` (Phase 2: `finding_lines` →
  `{line, severity}[]`, new `findings_count` field — both copies, same change)
- `server/test/contracts.test.ts:9,117-127` (Phase 2) — this file already has
  a hand-built `SmartDiff`/`SmartDiffFile` fixture with the old shape; it will
  fail to typecheck/assert once the contract changes and must be updated in
  the same commit, not discovered later (the same "growing a shared contract
  breaks its own fixture test" gotcha recorded for `Intent`/`Finding` in
  `docs/intent-layer-plan.md`'s INSIGHTS notes).
- `server/test/smart-diff-classifier.test.ts` (new, Phase 1) — plain unit
  test, no DB, following the existing flat `server/test/*.test.ts` convention
  (e.g. `server/test/reviews-helpers.test.ts:1-2`'s import style). Cover: a
  lockfile and `package.json` → `boilerplate`; an `index.ts` barrel and a
  `*.config.*` file with a small diff → `wiring`; the same wiring-shaped path
  with a diff over the threshold → escalated to `core`; an ordinary
  `src/**/*.ts` business file → `core`; a `dist/`/`.snap` path →
  `boilerplate` regardless of diff size; `main.go` and a `/vendor/`-path Go
  file (`wiring`/`boilerplate` respectively); `__init__.py` and a
  `/__pycache__/`-path Python file; `mod.rs` and a `/target/`-path Rust file.
- `server/test/smart-diff-service.it.test.ts` (new, Phase 2) — DB-backed
  (real Postgres via testcontainers, per `server/AGENTS.md`'s unit/integration
  split): seed a PR with `pr_files` + two reviews sharing one
  `multi_agent_run_id` (plus one older, separate review) with findings on
  some files, assert `getSmartDiff` groups files correctly (and omits
  empty-role groups), only counts the latest batch's findings in
  `finding_lines`/`findings_count` (accepted included, dismissed excluded),
  expands a multi-line finding's full `start_line..end_line` range with the
  worse severity winning an overlapping line, returns `finding_lines` sorted
  ascending by `line`, and returns empty `finding_lines`/`findings_count: 0`
  before any review exists.

- `client/src/lib/hooks/smart-diff.ts` (new, Phase 3) — `usePrSmartDiff`.
- `client/src/components/diff-viewer/SmartDiffViewer/SmartDiffViewer.tsx` (new, Phase 3)
- `client/src/components/diff-viewer/SmartDiffViewer/SmartDiffViewer.test.tsx` (new, Phase 3, extended in Phase 5/6) — mocks `fetch` per `client/AGENTS.md`; covers: `boilerplate` group starts collapsed while `core`/`wiring` start open; each group header renders its `ROLE_COLORS` dot; a file with `findings_count > 0` defaults open even past the size threshold; a `boilerplate` file with findings still starts collapsed (the explicit override); the "N findings" `Chip` shows `findings_count`, not the (possibly larger) `finding_lines.length`; a multi-line finding renders a severity badge on every line in its range, not just the first; two overlapping findings on one line render the worse severity; clicking the `Chip` calls `scrollIntoView` on the right `data-line` node and forces that `FileCard` open; clicking it twice re-fires the scroll (nonce); a file with a non-null `pseudocode_summary` shows the "summary" indicator `Chip` on its (even collapsed) header and the "What this does:" text once opened; the split-suggestion banner appears only when `too_big`, and clicking a split's `Chip` dims non-matching `FileCard`s.
- `client/src/components/diff-viewer/CodeLine/CodeLine.tsx` (Phase 3: `data-line` attribute — additive, no existing behavior changes)
- `client/src/components/diff-viewer/FileCard/FileCard.tsx` (Phase 3: `defaultOpen`/`scrollToLine` optional props — additive, existing callers unaffected)
- `client/src/components/diff-viewer/index.ts` (Phase 3: export `SmartDiffViewer`)
- `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx` (Phase 4: `usePrSmartDiff` + toggle + conditional render)
- `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.test.tsx` (new, Phase 4 — no test file exists for this component today) — covers: toggle absent while `smartDiff` is loading/errored/empty (falls back to flat `DiffViewer`); toggle present and defaulting to "Smart order" once `smartDiff` has at least one non-empty group; flipping it to "Original order" swaps to the flat `DiffViewer` without losing `commenting` behavior.

- `server/src/vendor/shared/contracts/findings.ts` **and** the client copy
  (Phase 5: `Review.file_summaries` new optional field)
- `server/src/db/seed-prompts.ts:59-80` (Phase 5: instruct the model to summarize every changed file, not just flagged ones)
- `server/src/db/schema/reviews.ts` (Phase 5: new `reviewFileSummaries` table) + new migration `0022_*` + `meta/` snapshot
- `server/src/modules/reviews/repository/review.repo.ts` + `repository.ts` (Phase 5: `insertFileSummaries`, `getFileSummariesForReviews`)
- `server/src/modules/reviews/run-executor.ts:288-303` (Phase 5: thread `outcome.review.file_summaries` into the new insert call)
- `server/src/modules/smart-diff/service.ts` (Phase 5: populate `pseudocode_summary`; Phase 6: call the new clustering function for `split_suggestion`)
- `server/src/modules/smart-diff/split.ts` (new, Phase 6) — pure weakly-connected-components function over changed `core` files + `file_edges`
- `server/test/smart-diff-split.test.ts` (new, Phase 6) — plain unit test: a small hand-built edge list + changed-file set asserts correct components, common-prefix naming, `"Split N"` fallback with no common prefix, singleton files each becoming their own split, and `[]` when repo-intel has no data for the repo.
- `server/test/prompt-structured.test.ts` (Phase 5) — likely needs its structured-output fixture updated for the new `file_summaries` field (found during Phase 3 research to already assert the `Review` schema's shape).
- `client/src/components/diff-viewer/SmartDiffViewer/SmartDiffViewer.tsx` (Phase 5: render `pseudocode_summary`; Phase 6: split-suggestion banner + highlight state)
- `client/src/components/diff-viewer/FileCard/FileCard.tsx` (Phase 6: new optional `dimmed?: boolean` prop — additive)

Not touched: `server/src/modules/index.ts` (no new Fastify plugin registered
— the route lives in the existing `reviews` plugin), `SmartDiffViewer`/
`DiffViewer` internals (Phase 4 only changes their caller).

## Verification

- `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' smart-diff` — Phase 1 unit tests pass.
- `cd server && pnpm exec vitest run contracts` — updated `SmartDiff` fixture in `contracts.test.ts` still passes after the shape change.
- `cd server && pnpm exec vitest run smart-diff-service.it` — Phase 2 integration test passes against real Postgres.
- `cd server && pnpm typecheck`.
- Manual: `curl localhost:3001/pulls/<id>/smart-diff` against a seeded PR,
  before and after running a review, to confirm `finding_lines`/`findings_count`
  populate only after a review and only from its latest batch.
- `cd server && pnpm exec vitest run smart-diff-split` — Phase 6 clustering unit tests pass.
- `cd server && pnpm exec vitest run prompt-structured` — Phase 5's structured-output fixture still passes with `file_summaries` added.
- **No-new-model-call assertion** (acceptance criterion, not just an
  implementation detail): `MockLLMProvider.calls` (`server/src/adapters/mocks.ts:61-62`)
  already records every `completeStructured`/`complete` invocation by
  method name — reused, not a new mechanism. Two concrete assertions belong
  in `smart-diff-service.it.test.ts`: (1) after a normal Run Review with
  Phase 5's `file_summaries` request folded into the same prompt, `calls.filter(c
  => c.method === 'completeStructured').length` is still **exactly 1** per
  review (not 2 — proves Phase 5 didn't sneak in a second call); (2) calling
  `GET /pulls/:id/smart-diff` itself, on a container wired with a
  `MockLLMProvider`, leaves `calls` **completely untouched** — the route
  never reaches `container.llm` at all.
- `pnpm db:migrate` (Phase 5's new migration applies cleanly) — per root `CLAUDE.md`, migrations are manual, never run on boot.
- `cd client && pnpm test SmartDiffViewer` — Phase 3 + Phase 5 + Phase 6 component tests pass (grouping/badges/scroll, pseudocode_summary rendering, split banner + highlight).
- `cd client && pnpm test DiffTab` — Phase 4 toggle/fallback tests pass.
- `cd client && pnpm typecheck`.
- Manual/browser (per root `CLAUDE.md`, required for UI changes before
  calling this done): `pnpm dev` (or `./scripts/dev.sh`), open a PR that
  already has files + a completed review, confirm the toggle defaults to
  "Smart order" with `core`/`wiring` open and `boilerplate` collapsed, click
  a findings badge and confirm the diff scrolls to that line, confirm each
  open file shows its one-line `pseudocode_summary`, flip to "Original
  order" and confirm the flat view still works (comments still toggle/post
  correctly); then open a PR with no review yet run and confirm the toggle
  still renders (groups exist, no finding badges, no summaries yet) with no
  broken state; then open a large PR spanning an indexed repo and confirm
  the split-suggestion banner appears with correctly-clustered splits, and
  that clicking a split dims the rest without hiding anything.

## Acceptance criteria

Traced one-by-one against this plan — two of the six are deliverable/process
steps that weren't covered by any phase above (implementation code can't
satisfy them by itself); both are called out explicitly rather than silently
assumed done.

1. **"Демо-відео Smart Diff на великому PR: core зверху, lock-файл
   згорнутий, після Run Review з'являються бейджі, а клік веде до рядка."**
   **Explicitly out of scope for this plan/implementation pass — the user
   records this themselves.** Not tracked as a phase deliverable, not a
   verification step here, no tooling call-out needed. Left in this list
   only so the criterion itself isn't silently dropped from the rubric —
   its *content* (core-on-top, lock-file collapsed, badges after Run
   Review, click-to-line) is exactly what Phases 1-4's own verification
   already exercises, so the recording has nothing left to newly prove once
   those pass; it's a capture of already-verified behavior, not a
   dependency this plan needs to produce.
2. **"Відкрито PR із чітким описом реалізації та перевірок."** Root
   `CLAUDE.md`'s session protocol already mandates `pr-self-review` after
   `gh pr create`, but that's a *code-quality* gate, not a description-
   content one — this plan hadn't previously stated what the PR description
   itself must contain. Made explicit now: the PR description must name
   which phases it covers, link back to `docs/smart-diff-plan.md`, and list
   what was verified (the specific commands from "Verification" above, not
   just "tests pass") — matching this repo's own precedent
   (`docs/intent-layer-plan.md`'s "Implementation & Review" section is the
   template to follow).
3. **"Lock-файл завжди класифікується як boilerplate і спочатку
   згорнутий."** Covered twice over: classification —
   `BOILERPLATE_BASENAME_PATTERNS` (Phase 1, includes every common lockfile,
   never escalated); collapsed-by-default — Phase 3 point 1's group-level
   `boilerplate: closed` state, independent of size/findings, reconfirmed by
   the user's own "просто згорнута секція — ок" decision. Both have direct
   unit-test coverage (`smart-diff-classifier.test.ts`,
   `SmartDiffViewer.test.tsx`).
4. **"Бейджі знахідок клікабельні й ведуть до відповідного місця в diff."**
   Covered: the `findings_count` `Chip` (Phase 3) is clickable, sets
   `scrollTarget`, and `FileCard`'s `scrollToLine` prop (Phase 3) forces the
   file open and scrolls to the exact `data-line` node — plus, since the
   gap-analysis pass, the *inline per-line* severity badges (Phase 3/5) are
   the literal "місце в diff" the mockup shows, not just a file-level jump.
5. **"У логах перегляду Smart Diff немає нового виклику моделі."** Now has
   a concrete, checkable test (added to "Verification" above, this pass):
   `MockLLMProvider.calls` count stays at exactly one `completeStructured`
   call per review even with Phase 5's `file_summaries` folded in, and
   `GET /pulls/:id/smart-diff` itself never touches `container.llm` at all.
   Previously this was only true "by design" in prose — it wasn't backed by
   an actual assertion until now.
6. **"Пороги й патерни винесені в константи."** Covered —
   `smart-diff/constants.ts` (Phase 1: classifier patterns/threshold; Phase
   2: `SPLIT_SUGGESTION_TOO_BIG_LINE_THRESHOLD`) is the single file for all
   of it, matching `repo-intel/constants.ts`'s existing convention. Flagged
   in the last pass: the specific numbers (50, 500) are unconfirmed starting
   guesses, not settled — the criterion is about *where* they live, which is
   satisfied regardless of their exact values.

## Follow-up (not yet planned)

- Per root `CLAUDE.md`: run `engineering-insights` after each phase lands,
  and run `pr-self-review` right after `gh pr create`/any push to its branch.
