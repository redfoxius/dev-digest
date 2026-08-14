# INSIGHTS — client

Practical findings hit while working in this module. Append-only: correct a
stale entry with a new dated line, never edit or delete history silently.

Before writing here, check [AGENTS.md](AGENTS.md) — a finding that should
*always* apply belongs there as a standing rule; this file is for things too
specific, too contextual, or too unproven for that yet.

**Anti-vague test:** if someone who just read the code wouldn't be surprised,
don't write it. See the repo's `engineering-insights` skill for the full
workflow and quality bar.

## What Works

- 2026-08-14 — When a manual/browser verification step needs real data (here:
  Phase 3 of `docs/intent-smartdiff-improvements.md` needed a PR whose derived
  intent has populated `risks` to screenshot the redesigned `IntentCard`) but
  no such row exists yet in the local dev DB and running a real
  `POST /pulls/:id/intent/derive` would trigger a billed LLM call, a
  temporary direct `UPDATE pr_intent SET risks = '[...]'::jsonb WHERE pr_id =
  '<id>'` against the dev Postgres container (then reverted back to `'[]'`
  right after the screenshot) is a legitimate zero-cost substitute — it
  exercises the exact same render path (`GET /pulls/:id/intent` → `IntentCard`)
  without invoking the LLM at all. Confirm the row's pre-edit value first
  (`select risks from pr_intent where pr_id = ...`) so the revert restores the
  exact prior state, not just an assumed default.
  (`client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/_components/IntentCard/IntentCard.tsx`)

- 2026-08-14 — Fixed the nonce-collision gap the "What Doesn't Work" entry
  below originally left unfixed: `SmartDiffViewer`'s internal/external
  scroll-target merge remaps each source's raw nonce to a disjoint parity
  (`internalScrollTarget.nonce * 2` — always even; `externalScrollTarget.nonce
  * 2 + 1` — always odd) at the point the merged `scrollToLine` is built for
  `FileCard`. Two independent counters that both start at 1 can now never
  produce the same merged value, by construction — no shared state, no new
  effects, no mount-timing risk (an earlier design considered a shared
  `useEffect`-bumped counter, rejected because it could double-fire
  `FileCard`'s scroll on initial mount). Reusable pattern: when merging two
  independently-sourced monotonic ids into one value a child keys an effect
  on, remap each source's id into disjoint numeric partitions (parity, or
  distinct offset ranges) rather than trying to synchronize/share a single
  counter across the sources.
  (`client/src/components/diff-viewer/SmartDiffViewer/SmartDiffViewer.tsx:170-186`;
  regression test: `SmartDiffViewer.test.tsx` — "regression: internal and
  external both at raw nonce 1 (the exact collision case) still re-fires
  the scroll")

## What Doesn't Work

- 2026-08-14 — `usePrReviews` (`client/src/lib/hooks/reviews.ts:52-58`) had
  NO `refetchInterval`, unlike its siblings `usePrActiveRuns`/`usePrRuns`
  which both self-poll every 4s while anything is active. The only thing
  that ever refreshed it was `page.tsx`'s `onRunDone` callback, wired
  through `FindingsTab` → `RunStatus`'s own local SSE `running` transition
  — observable ONLY while `RunStatus` was mounted, i.e. only while the
  Findings tab was selected (it fully unmounts on tab switch, per
  `{tab === "findings" && <FindingsTab/>}`). Real, reported bug: start a
  review, switch to Overview/Files-changed before it finishes, it
  completes while unmounted, the reviews list stays stale until a full
  reload. Fixed by adding a page-level edge-triggered `useEffect` on
  `reviewRunning` (already tab-independent, since `usePrActiveRuns` lives
  in `page.tsx` which never unmounts) that calls the same handler the
  SSE path already did — two convergent paths (SSE: fast, tab-gated; poll:
  ~4s lag, tab-independent) to one `handleRunSettled`. Generalizable:
  "only refreshes via a callback wired to a component's own local state
  transition" is a bug waiting to happen the moment that component can
  unmount while the underlying condition changes — wire the refresh to
  page-level, always-mounted, server-polled state instead. Verified live
  against a real ~110s agent run (see Tool & Library Notes below).
  (`client/src/app/repos/[repoId]/pulls/[number]/page.tsx` —
  `handleRunSettled` + the `prevReviewRunningRef` effect;
  `docs/run-status-plan.md`)

- 2026-08-14 — Phase 4's `SmartDiffViewer` scroll-target merge
  (`internalScrollTarget ?? externalScrollTarget`, one per-file `nonce`
  passed through to `FileCard`) has a narrow, unfixed nonce-collision gap:
  internal (findings-Chip click) and external ("view in diff" from the
  Findings tab) each keep their OWN independent nonce counter, both
  starting at 1. If a file has never had an internal click, and an
  external target lands on it, the user's FIRST-EVER internal click on
  that same file can produce a nonce that numerically equals the external
  target's nonce — `FileCard`'s re-scroll effect is keyed only on
  `scrollToLine.nonce` (see the 2026-08-14 two-effect entry below), so it
  won't re-fire even though the winning line changed. Worst case: the user
  has to click the Chip twice. Documented inline as a code comment at the
  merge site; not fixed (would need a combined/offset nonce space across
  both sources). Flag if this area is revisited.
  (`client/src/components/diff-viewer/SmartDiffViewer/SmartDiffViewer.tsx`
  — the `scrollToLine = internalTarget ?? externalTarget` merge)
  **FIXED 2026-08-14, same day** — see the "What Works" entry below; this
  antipattern entry stays as the record of what was wrong, not deleted.

- 2026-08-14 — First `SmartDiffViewer` draft rendered a file's "N findings"
  `Chip` in a separate wrapper `<div>` stacked ABOVE `FileCard`, with its own
  copy of `file.path` next to it — but `FileCard`'s own header
  (`FileCard.tsx:95-97`, `s.filePath`) already renders that same path, so the
  path visibly appeared TWICE per file. Caught during review, not by the test
  suite — a test had actually been written asserting the duplication as
  expected (`getAllByText(path).length).toBe(2)`), which normalizes a real
  bug into "intended behavior" instead of catching it. Fixed by giving
  `FileCard` a new `headerRight?: React.ReactNode` prop (rendered inside its
  existing header row, with `stopPropagation` on its own click so it doesn't
  also toggle the card's open/close) instead of a sibling wrapper — one path,
  one row, matches "next to a file's path" the way the plan actually meant
  it. Lesson: when a new composite view re-renders a field a child component
  already owns (here, the path `FileCard` already shows), extend the child
  with a slot prop rather than duplicating that field's markup one level up
  — and don't let a test that merely describes current output substitute for
  checking whether that output is actually right.
  (`client/src/components/diff-viewer/FileCard/FileCard.tsx` — `headerRight`,
  `client/src/components/diff-viewer/SmartDiffViewer/SmartDiffViewer.tsx`)

## Codebase Patterns

- 2026-08-14 — The small-pulsing-status-dot visual (7px circle,
  `boxShadow: "0 0 0 3px var(--<color>-bg)"`, `animation: ddpulse 2s
  ease-in-out infinite` — the `ddpulse` keyframe is already global in
  `client/src/vendor/ui/styles.css:230`) is now established in TWO places:
  its original use in `AutoTriggerStatus.tsx:29-35` (auto-review on/off),
  and reused verbatim for the new "review running" pulse on the "Agent
  runs" tab label (`TabDef.pulse`, `Tabs.tsx`). Reuse this exact
  spec — don't invent a new pulsing-dot style — for the next
  "small live-status indicator" need in this codebase.
  (`client/src/vendor/ui/kit/Tabs.tsx`, `client/src/vendor/ui/kit/types.ts`
  — `TabDef.pulse`; `client/src/vendor/ui/AutoTriggerStatus.tsx:29-35`)

- 2026-08-14 — The `<span onClick={(e) => e.stopPropagation()}>` wrapper for
  a small interactive element nested inside a bigger clickable row (first
  established for `FileCard`'s `headerRight` slot, see the 2026-08-14
  entry above) is now used a second time, independently, for
  `FindingCard`'s new "View in diff" `IconBtn` — `s.metaRow` sits inside
  `s.header`'s own row-level `onClick` toggle, same shape as `FileCard`.
  Confirmed as the established idiom for this exact situation across two
  unrelated component trees — reuse it directly for the next
  small-interactive-element-inside-a-toggleable-row case rather than
  re-deriving it.
  (`client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx`
  — the view-in-diff `IconBtn` wrapper)

- 2026-08-06 — There is no shared `srOnly`/visually-hidden style utility in
  this codebase yet — a repo-wide grep for `sr-only`/`visually-hidden`/
  `clip: rect` came back empty before this date. Added the same inline
  visually-hidden `CSSProperties` object independently to THREE different
  `styles.ts` files (`SkillsListView`, `SkillsTab`, `CommunitySkillsDrawer`)
  for `aria-live="polite"` result-count announcements, rather than a shared
  export — each `<route>/_components/**/styles.ts` file is self-contained
  per this module's existing convention, and 3 near-identical ~10-line
  objects didn't yet justify a new shared `@devdigest/ui` primitive. If a
  4th consumer shows up, that's the signal to promote it instead of copying
  a 4th time. (`client/src/app/skills/_components/SkillsListView/styles.ts`,
  `client/src/app/agents/[id]/_components/AgentEditor/_components/SkillsTab/styles.ts`,
  `client/src/app/skills/_components/CommunitySkillsDrawer/styles.ts` — all
  `srOnly`)

- 2026-08-07 — A mutation-scoped optimistic-state pattern (`const [x, setX]
  = useState<T | null>(null); const value = x ?? derived;`, cleared in that
  specific mutation's `onSettled`) is NOT automatically safe against a
  SECOND overlapping call to the same handler before the first settles — the
  first mutation's `onSettled` still fires unconditionally and clears the
  shared state, wiping out the second call's still-pending optimistic value.
  Shipped this exact bug one day after introducing the pattern itself (see
  the 2026-08-06 entry below) and pr-self-review's `react-best-practices`
  skill caught it on the next review pass. Fix: a monotonic token
  (`useRef(0)`, incremented per call) captured in a local `const` at call
  time, and the `onSettled` callback only clears state `if (tokenRef.current
  === token)` — i.e. only the LATEST call's settle may clear it. Any
  "optimistic override, cleared on settle" state needs this guard the
  moment the same handler can plausibly fire twice before the first
  settles (drag-and-drop, rapid clicks, debounced-but-not-cancelled async
  work) — it's not a hypothetical, it reproduces with two ordinary drags.
  (`client/src/app/agents/[id]/_components/AgentEditor/_components/SkillsTab/SkillsTab.tsx:52-57,70-77`;
  regression test: `SkillsTab.test.tsx` — "a second overlapping drag's
  optimistic order survives the FIRST (now-stale) mutation settling first")

- 2026-08-06 — `client/src/lib/skills.ts` is now the canonical home for
  skill-domain logic shared across route trees — created after `needsVetting()`
  (untrusted-source-skill check) was found duplicated byte-for-byte in TWO
  unrelated component folders (`skills/_components/SkillsListView/helpers.ts`
  and `agents/[id]/_components/AgentEditor/_components/SkillsTab/helpers.ts`),
  both independently documenting it as "the spec's vetting gate" without
  either referencing the other. `frontend-ui-architecture`'s rule ("logic
  reused by 2+ components → promote to `lib/`") already covered this; the
  gap was that a `<route>/_components/**/helpers.ts` file LOOKS
  component-scoped even when its logic isn't. Check `lib/skills.ts` first
  before adding a skill-domain helper to a component-local `helpers.ts`.
  (`client/src/lib/skills.ts`)

- 2026-08-06 — Local optimistic UI state for a drag-reorder (or any
  local-edit-during-an-in-flight-mutation scenario) over TanStack Query data
  should be scoped to THAT mutation's lifecycle (set right before `.mutate()`,
  cleared in its own `onSettled`), not kept permanently in sync with the
  upstream `useMemo`-derived list via a `useEffect`. The effect-sync version
  re-applies the (possibly stale, pending-mutation-unaware) upstream value on
  EVERY unrelated recompute of that `useMemo` — including one triggered by a
  totally different mutation invalidating the same query keys — snapping an
  in-progress drag back to a stale order until the effect fires again. The
  fix pattern: `const [optimisticRows, setOptimisticRows] = useState<Row[] |
  null>(null); const rows = optimisticRows ?? merged;`, set only on the
  action, cleared only by that action's own `onSettled`.
  (`client/src/app/agents/[id]/_components/AgentEditor/_components/SkillsTab/SkillsTab.tsx:33-40,51-60`)

- 2026-08-06 — Relative-import depth for a `_components/<Tab>/<Name>.tsx` file
  two levels under `AgentEditor/` (e.g. `SkillsTab.tsx`) to `src/lib/hooks/*`
  is **7** `../` (up to `src`, then down into `lib/hooks`) — matches
  `ConfigTab.tsx`'s existing import. But that file's **co-located test**
  importing `client/messages/en/*.json` needs **8** `../`, one more, because
  `messages/` sits at the `client/` root, one level above `src/` — the same
  off-by-one that bit `AgentEditor.test.tsx` (6 vs 7). Rule of thumb: ups to
  `src/lib/...` = folders after `src`; ups to `client/messages/...` = folders
  after `src`, **plus one** to exit `src` itself. Check both counts
  separately in a new colocated test file — copying one file's import depth
  for the other target is the easy mistake.
  (`src/app/agents/[id]/_components/AgentEditor/_components/SkillsTab/SkillsTab.test.tsx:6`)

- 2026-08-05 — `Dropdown` (`src/vendor/ui/kit/Dropdown.tsx`) now supports two
  mutually-exclusive content modes behind one component: the original
  `items: DropdownItemDef[]` list, or a free-form `children` render (used by
  the findings click-popover). `items` became optional and `children ?? items?.map(...)`
  picks whichever was passed; a new `onOpenChange` callback exposes open state
  without changing the 6 existing `items`-only call sites. Worth reusing this
  "optional items + optional children" shape for the next shared `kit`
  component that needs one consumer to render arbitrary rich content while
  every other consumer keeps using the simple declarative list.
  (`src/vendor/ui/kit/Dropdown.tsx:62-100`)

- 2026-07-27 — `src/vendor/shared` here is a **trimmed subset** of the
  server's `@devdigest/shared`, hand-copied — not just a mirror. It's missing
  `AgentManifest`, the OpenRouter `sessionId` field, and the `'openrouter'`
  provider id that exist server-side. Before assuming a contract is "not
  built yet," check whether it simply wasn't copied over.
  (`client/src/vendor/shared/contracts/eval-ci.ts` and
  `client/src/vendor/shared/adapters.ts` vs
  `server/src/vendor/shared/contracts/eval-ci.ts:144-172`,
  `server/src/vendor/shared/adapters.ts:64-69,83`)

- 2026-08-07 — A global "active repo" mechanism already exists
  (`lib/repo-context.tsx`'s `useActiveRepo()`/`useRepoNotFound()`, priority
  URL `:repoId` > localStorage > first repo from the API) and `nav.ts`'s
  `NavItemDef.href` already documents `:repoId` templating — don't assume a
  repo-scoped nav entry needs new "repo switcher" plumbing; it doesn't, just
  add `{ href: "/repos/:repoId/..." }` like the existing `pulls` entry.
  `src/vendor/ui/shell/RepoSwitcher.tsx` even already exists as a component
  (not currently wired into the Sidebar, but the underlying state is real).
  (`client/src/lib/repo-context.tsx:58-72`, `client/src/vendor/ui/nav.ts:72-75`)

- 2026-08-07 — `messages/en/<feature>.json` files are auto-discovered by
  filename (`i18n/request.ts`'s `loadMessages()` reads every `.json` in the
  locale dir, keyed by filename minus extension) — a feature can ship with a
  pre-written, currently-unused namespace file (e.g. `conventions.json`
  existed with `page.*`/`card.*` keys before the Conventions Extractor page
  was built) and it's already live, no registration step needed. Worth
  grepping `messages/en/` for a matching namespace before writing new copy
  from scratch — it may already be there, written for exactly this feature.
  (`client/src/i18n/request.ts:16-25`, `client/messages/en/conventions.json`)

- 2026-08-08 — Before assuming a missing feature needs new API/hook work,
  check whether it already exists just unwired: `useDeleteSkill`
  (`client/src/lib/hooks/skills.ts:93-102`) and its backend
  (`DELETE /skills/:id`, `server/src/modules/skills/routes.ts:184-189`) were
  both fully implemented with zero callers anywhere in `src/app/skills/**` —
  the entire gap was a missing UI button. `grep -rn useDeleteSkill
  client/src/app` before building anything new.

- 2026-08-08 — Deleting a skill needs no client-side "used by N agents"
  warning: `agent_skills.skillId` and `skill_versions.skillId` both declare
  `onDelete: 'cascade'` (`server/src/db/schema/agents.ts:57-59`,
  `server/src/db/schema/skills.ts:26-28`), so the DB detaches/cleans up
  automatically on skill delete. A plain `window.confirm` is sufficient,
  matching `AgentCard.tsx`'s existing delete-button pattern.

- 2026-08-09 — `OverviewTab.tsx` (PR detail page) has NO `next-intl` usage at
  all — unlike almost every sibling `_components/` folder on the same page
  (`FindingCard`, `VerdictBanner`, `RunReviewDropdown`, `RunHistory`,
  `RunStatus` all call `useTranslations('prReview')`). The new `IntentCard`
  (`OverviewTab/_components/IntentCard/`) deliberately followed
  `OverviewTab`'s own local convention (hardcoded English strings) rather
  than the page-wide i18n convention, for consistency with the file it's
  colocated under — don't assume every `_components/` folder under the same
  route is i18n'd just because most are; check the direct parent first.
  Worth revisiting together if the Overview tab as a whole ever gets i18n'd.
  (`client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx`,
  `.../_components/IntentCard/IntentCard.tsx`)

- 2026-08-14 — `FileCard`'s new `scrollToLine` prop (Smart Diff's "click a
  finding badge, scroll to it") needs TWO separate `useEffect`s, not one —
  unlike `ReviewRunAccordion`'s existing `targetRunId`/`targetNonce` precedent
  (`ReviewRunAccordion.tsx:48-54`), which calls `setOpen(true)` then
  `rootRef.current?.scrollIntoView(...)` in the SAME effect and works fine,
  because `rootRef` there points at the header/container that's ALWAYS
  mounted regardless of `open`. `FileCard`'s target line only exists in the
  DOM once `open` is already `true` (its lines render behind `{open && (...)}`,
  `FileCard.tsx:111`), so calling `containerRef.current?.querySelector(...)`
  in the same tick as `setOpen(true)` queries a DOM that hasn't re-rendered
  yet and silently finds nothing. Fix: one effect keyed on `scrollToLine.nonce`
  that only calls `setOpen(true)`, a second effect keyed on
  `[scrollToLine.nonce, open]` that does the actual querySelector +
  `scrollIntoView` — the second effect's `open` dependency is what guarantees
  it re-runs AFTER the DOM commit that made the line visible. Generalizable:
  before copying a "force open + scroll into view" effect pattern to a new
  component, check whether the scroll target is inside content that's
  conditionally rendered on the same open flag being forced — if so, one
  effect isn't enough.
  (`client/src/components/diff-viewer/FileCard/FileCard.tsx:59-73`)

- 2026-08-14 — `messages/en/prReview.json`'s `smartDiff.largeTitle`/
  `smartDiff.largeBody` keys ("This PR is large ({lines} changed lines)" /
  "Consider splitting it into smaller, focused PRs for easier review:")
  already existed, unused, before Phase 6 of `docs/smart-diff-plan.md` wrote
  its `split_suggestion` banner — pre-authored in an earlier phase for
  exactly this banner and sitting dead until now. Confirms the 2026-08-07
  entry below ("grep `messages/en/` for a matching namespace before writing
  new copy") generalizes past whole-namespace files to individual pre-written
  keys within an already-used namespace too.
  (`client/messages/en/prReview.json:60-61`,
  `client/src/components/diff-viewer/SmartDiffViewer/SmartDiffViewer.tsx`)

- 2026-08-14 — `FileCard`'s new `dimmed?: boolean` prop (Phase 6's
  split-suggestion highlight) followed the same additive/no-op-when-omitted
  shape as every other Smart-Diff prop added to this component across Phases
  3/5 (`defaultOpen`, `scrollToLine`, `findingSeverityByLine`, `headerRight`,
  `pseudocodeSummary`) — reduced opacity via an inline style plus a
  `data-dimmed="true"` attribute (omitted entirely when `false`) so RTL tests
  can assert it via `toHaveAttribute` without a real layout engine, the same
  attribute-for-testability convention already used by `data-line`/`data-file`
  elsewhere in this component tree. Worth reusing this exact "no-op prop +
  presence/absence data-attribute" shape for the next additive visual-state
  prop on a shared diff-viewer component.
  (`client/src/components/diff-viewer/FileCard/FileCard.tsx:66,109,112`)

## Tool & Library Notes

- 2026-08-14 — A real agent review run (not mocked) on a TINY PR (86
  changed lines, 3 files, single enabled agent) took ~110-165s end to end
  across two live runs, dominated by two sequential real LLM calls: PR
  intent derivation (a free-tier model, ~31s alone in one run) then the
  actual review call (deepseek-v4-flash via OpenRouter, ~2min). Don't
  assume a "quick" live-run manual/browser verification will finish in
  under a minute — budget several minutes of real wall-clock wait (or poll
  `GET /pulls/:id/runs/active`/`GET /runs/:id/events` directly rather than
  guessing a fixed `waitForTimeout`) for any check that needs a real run to
  actually complete.
  (`docs/run-status-plan.md` — live verification section)

- 2026-08-14 — Playwright is not a direct dependency of `client/` or the
  repo root — `npx playwright --version` resolves fine (via a global/npx
  cache), but `require('playwright')`/`import "playwright"` from a script
  run inside `client/` fails with `MODULE_NOT_FOUND`, since it isn't on
  any `node_modules` resolution path from there. For an ad hoc one-off
  browser check outside `e2e/`'s own `agent-browser` harness (e.g.
  verifying Phase 4's "view in diff" round trip against real dev data),
  the working approach was a throwaway scratch project: `npm init -y &&
  npm install playwright --no-save` in a scratch dir, then run the
  script from there. `e2e/` itself uses Vercel `agent-browser` (CDP), a
  different tool — see `e2e/agent-browser.json` — for its real
  deterministic specs; this is only for a quick manual verification pass.

- 2026-08-14 — `SectionLabel`'s (`src/vendor/ui/primitives/SectionLabel.tsx`)
  visible text sits in a `<span>` that is a DIRECT CHILD of SectionLabel's
  own top-level flex-row `<div>` — not of whatever wrapper the caller puts
  SectionLabel inside. So when a caller wraps a second, nested `SectionLabel`
  in its own divider wrapper (Phase 3's `<div style={s.subsection}><SectionLabel
  icon="Shield">...</SectionLabel>...</div>`), an RTL test that needs the
  actual divider wrapper element (not SectionLabel's own internal row div)
  must call `.closest("div")` (reaches SectionLabel's own row) THEN
  `.parentElement` (reaches the caller's wrapper) — a single `closest("div")`
  stops one level too shallow. Same two-hop pattern would apply to `Badge`'s
  span if a test ever needs Badge's own parent wrapper rather than the badge
  itself (`Badge`'s text is a direct child of its own `<span>`, one hop
  fewer, since Badge has no internal wrapper div).
  (`client/src/vendor/ui/primitives/SectionLabel.tsx`,
  `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/_components/IntentCard/IntentCard.test.tsx`
  — "wraps the evidence badge and the Risk Areas heading in their own,
  separate subsection wrappers")

- 2026-08-14 — `SeverityBadge`'s `compact` variant renders icon-only, no text
  and no `aria-label` (`Badge.tsx:80` — `compact ? null : s.label`, nothing
  else) — RTL has no accessible-name query that can distinguish CRITICAL vs
  WARNING vs SUGGESTION badges rendered this way. Lucide icons DO carry a
  stable `class="lucide lucide-<icon-name>"` (e.g. `lucide-triangle-alert`
  for `AlertTriangle`/WARNING, `lucide-octagon-alert` for
  `AlertOctagon`/CRITICAL), confirmed by rendering the icons directly via
  `renderToStaticMarkup` — the only workable way to assert "this specific
  line shows WARNING vs CRITICAL" in a test is
  `container.querySelector('[data-line="N"] svg.lucide-<icon-class>')`, a
  deliberate exception to "avoid `container.querySelector`" for lack of any
  accessible alternative. Worth reusing this exact query shape for any future
  per-line/per-cell compact-badge assertion.
  (`client/src/vendor/ui/primitives/Badge.tsx:52-88`; exercised in
  `client/src/components/diff-viewer/SmartDiffViewer/SmartDiffViewer.test.tsx`)

- 2026-08-14 — `next-intl`'s `NextIntlClientProvider` throws `MISSING_MESSAGE`
  for a namespace as soon as ANY descendant calls
  `useTranslations("thatNamespace")`, even if the component under test never
  actually renders the specific key that namespace would resolve — `FileCard`
  unconditionally calls `useTranslations("shell")` (for its `noDiffText`
  fallback, `FileCard.tsx:52`) even when every rendered file has real diff
  content, so a test provider that only supplied `{ prReview: ... }` failed
  before any assertion ran. When a new test wraps a component tree that
  transitively includes `FileCard` (or anything else with its own
  `useTranslations` call), pass EVERY namespace those descendants use, not
  just the one directly under test — check each rendered child file, not
  just the component being tested.
  (`client/src/components/diff-viewer/FileCard/FileCard.tsx:52`,
  `client/src/components/diff-viewer/SmartDiffViewer/SmartDiffViewer.test.tsx`)

- 2026-08-14 — Smart Diff Phase 5 added a SECOND unconditional
  `useTranslations` call to `FileCard` (`useTranslations("prReview")`, for the
  "What this does:" label) alongside its pre-existing `useTranslations("shell")`
  — confirming the 2026-08-14 entry above generalizes to "every namespace a
  descendant unconditionally calls," not just one. This one broke a
  pre-existing test that predates `FileCard` even having a `prReview`
  dependency: `src/test/smoke.test.tsx`'s `DiffViewer` smoke test only
  supplied `{ shell: ... }` and had been passing fine for months, but started
  logging (not throwing — `next-intl`'s dev-mode `IntlError` for a MISSING
  namespace is a console.error, not a thrown exception, so the test still
  went green) a `MISSING_MESSAGE: Could not resolve 'prReview'` on every run.
  A green test suite is not proof a `useTranslations` addition to a shared
  component is namespace-complete — grep `stderr` in Vitest's own output
  (not just the pass/fail count) after adding a new `useTranslations` call to
  a component with existing consumers.
  (`client/src/components/diff-viewer/FileCard/FileCard.tsx` — `tPrReview`,
  `client/src/test/smoke.test.tsx`)

- 2026-08-14 — RTL's `getByText` is SAFE to use with a regex against one half
  of a "Label: value" string split across sibling nodes (e.g. `<div><strong>
  What this does:</strong> {summary}</div>`), with NO ambiguous double-match,
  because RTL's default `getNodeText` only concatenates a node's OWN DIRECT
  text-node children — NOT full `node.textContent` (which would include the
  `<strong>`'s nested text too). Verified empirically: `getByText(/What this
  does:/)` matches only the `<strong>`, and `getByText(/Recomputes the
  invoice/)` matches only the parent `<div>` (its own direct text nodes,
  excluding the `<strong>` child) — no "multiple elements found" error either
  way. Reusable pattern for any future "label prefix + dynamic value" render
  that needs two independently-queryable assertions without a `data-testid`.
  (`client/src/components/diff-viewer/FileCard/FileCard.tsx` —
  `pseudocodeSummary` block; exercised in
  `client/src/components/diff-viewer/SmartDiffViewer/SmartDiffViewer.test.tsx`
  — "pseudocode_summary (Phase 5)")

- 2026-08-06 — `Checkbox` (`src/vendor/ui/kit/Checkbox.tsx`) renders as a real
  `<button role="checkbox" aria-checked>` , not an `<input type="checkbox">` —
  in RTL, toggle it with `fireEvent.click(checkbox)` (or userEvent's `.click`),
  never `fireEvent.change`, which is a no-op on a `<button>` and will leave a
  test silently asserting against the pre-toggle state.
  (`src/vendor/ui/kit/Checkbox.tsx:25-30`; exercised in
  `src/app/agents/[id]/_components/AgentEditor/_components/SkillsTab/SkillsTab.test.tsx`)

- 2026-08-04 — A real review run against the live OpenRouter API (deepseek-v4-flash,
  a small diff) cost exactly `$0.000272979` — i.e. a normal, non-degenerate
  review can legitimately land under $0.001. `formatCost`'s `<$0.001` branch
  isn't a theoretical edge case for a broken/free model; it's the realistic
  common case for a cheap model on a small PR, so don't assume it's rare.
  (`client/src/lib/format.ts:10`)

- 2026-08-09 — `Donut` (`src/vendor/ui/charts/Donut.tsx:49-51`) unconditionally
  formats each segment's value via `.toFixed(2)`, regardless of `valuePrefix`.
  It was built for money (`$4.20`); passing `valuePrefix=""` for an integer
  metric (e.g. a findings-by-category count) still renders `"3.00"`, not
  `"3"` — there's no integer/decimals prop. Building `SkillStatsTab`'s
  findings-by-category donut hit this; accepted as a known cosmetic quirk
  per the course-scope "reuse as-is" call rather than touching the shared
  chart primitive for one caller. Worth fixing (an optional `decimals` prop)
  if a second integer-metric donut shows up.
  (`client/src/vendor/ui/charts/Donut.tsx:49-51`,
  `client/src/app/skills/_components/SkillDetail/_components/SkillStatsTab/SkillStatsTab.tsx`)

## Recurring Errors & Fixes

- 2026-08-06 — `SkillsTab.tsx` destructured only `data`/`isLoading` from its
  two `useQuery` hooks (`useSkills`, `useAgentSkills`), dropping `isError`
  entirely — on a query failure, `loading` goes `false` and the filtered
  list is `[]`, so it fell into the SAME branch as "your filter matched
  nothing" and rendered that copy instead of an error. Every OTHER component
  touched in the same PR (`SkillsListView`, `CommunitySkillsDrawer`,
  `VersionsTab`) already destructures `isError`/`refetch` and renders
  `ErrorState` — this was the one place that didn't. When adding a new
  `useQuery`-backed list view, copy an existing sibling's FULL destructure
  (`data, isLoading, isError, refetch`), not just the two fields the happy
  path needs — a missing `isError` doesn't error at compile time, it just
  silently degrades to the empty-state copy.
  (`client/src/app/agents/[id]/_components/AgentEditor/_components/SkillsTab/SkillsTab.tsx:23-32`)

- 2026-08-06 — Testing a per-test-overridable `useQuery` mock (e.g. to
  simulate one specific test's `isError: true` while every other test in the
  file gets the default success shape) needs the mock to be a HOISTED
  `vi.fn()` with a module-level default `mockImplementation(...)`, not a
  static object literal returned directly from the `vi.mock(...)` factory —
  a static literal can't be overridden per-test via `mockReturnValueOnce`.
  Pattern: `vi.hoisted(() => ({ useXMock: vi.fn() }))`, `vi.mock(path, () =>
  ({ useX: useXMock }))`, then `useXMock.mockImplementation(() => ({
  ...defaultSuccessShape }))` at module scope for the common case, and
  `useXMock.mockReturnValueOnce({ ...errorShape })` inside the one test that
  needs it.
  (`client/src/app/agents/[id]/_components/AgentEditor/_components/SkillsTab/SkillsTab.test.tsx:10-32`)

- 2026-08-06 — Adding a zod `.default(...)` field to a shared contract (here:
  `Agent.skills_count: z.number().int().default(0)`) breaks `pnpm typecheck`
  on every EXISTING `const x: Agent = {...}` object literal that predates the
  field — `z.infer`'s output type treats a `.default()` field as required,
  not optional, because the default only auto-fills during `.parse()`, which
  literal test fixtures never call. `AgentCard.test.tsx` and
  `AgentEditor.test.tsx` both had this exact break the same day the field was
  added (fixed by adding `skills_count: 0` to each fixture). Generalizable:
  after adding a `.default()` field to any `contracts/*.ts` schema, `grep` for
  every hand-built literal typed as that contract (test fixtures especially)
  — `pnpm typecheck` will list them, but only if you actually run it against
  the whole package, not just the file(s) you touched.
  (`client/src/vendor/shared/contracts/knowledge.ts` — `Agent.skills_count`;
  `client/src/app/agents/_components/AgentCard/AgentCard.test.tsx:23`,
  `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.test.tsx:31`)

- 2026-08-05 — The PR list's `tableCard` container had `overflow: "hidden"`
  (for its rounded corners), which silently clipped the FINDINGS column's
  new click-popover — an absolutely-positioned `Dropdown` child — whenever it
  opened on a row near the bottom of the table. `pnpm typecheck` and the full
  Vitest/RTL suite (53 tests) stayed green through this the whole time:
  JSDOM has no real layout engine, so `overflow: hidden` clipping is
  invisible to RTL assertions — it only surfaces as a real, rendered
  screenshot. Only caught during the manual browser verification pass, not
  by any automated check. Fix: `tableCard.overflow: "visible"` (safe here
  because rows' default background is transparent, so no square corners
  show through the parent's rounded ones). Generalizable lesson: any
  absolutely-positioned popover added inside an existing `overflow: hidden`
  card needs a manual screenshot check near the container's edges — tests
  passing is not evidence the popover is visible.
  (`src/app/repos/[repoId]/pulls/styles.ts:91-99`)

- 2026-08-05 — `PRRow`'s findings popover confidently rendered "No findings"
  for a PR that DID have a fresh finding, reported live by the user with a
  screenshot (found on `~/Desktop`, not attached to the chat message — see
  memory). Root cause: `usePrReviews(prId, enabled)` shares its
  `["reviews", prId]` cache key with every other consumer (notably the PR
  detail page, which fetches it with `enabled: true` by default) and the
  global `QueryClient` default is `staleTime: 30_000`
  (`src/lib/providers.tsx:28`). Visiting the PR detail page (which is how a
  user actually triggers "Run all agents" — the button lives there, not on
  the list) caches an EARLY, pre-completion snapshot of that query key. Back
  on the list, opening the FINDINGS popover within that 30s window reuses
  the stale cached array — and critically, `reviewsQuery.isLoading` reads
  `false` the whole time (TanStack's `isLoading` is about "no cached data
  at all", not "is this data current"), so the popover never shows a
  loading state, it just confidently renders the stale (findings-less)
  snapshot. Fix: derive a `missingExpectedReviews` flag by checking whether
  every id in `pr.latest_review_ids` (from the list fetch, always
  server-fresh) is actually present in `reviewsQuery.data`; if not, treat
  it as loading AND explicitly call `reviewsQuery.refetch()` — don't rely
  on `isLoading`/`enabled`-toggle refetch semantics alone for a resource
  that changes in the background outside this component's knowledge.
  (`src/app/repos/[repoId]/pulls/_components/PRRow/PRRow.tsx` — the
  `missingExpectedReviews`/refetch effect)

## Open Questions

- 2026-08-06 — `ConfigTab`'s stale-local-form bug (typed edits computed from
  `useState` copies of `skill`, resynced only on `skill?.id` change via a
  now-removed `useEffect`) was fixed by remounting the whole component on
  `key={skill.id}` at the call site instead. This satisfies the CRITICAL
  react-best-practices rule ("never `useState`+`useEffect` to sync a computed
  value") but does NOT fully close the specific race the finding described —
  the underlying `skill` object's CONTENT changing while its `id` stays the
  SAME (e.g. a background refetch from another tab's edit) still leaves
  whatever the user has already typed unreconciled against the newer server
  data; keying only resets state on an `id` change, same as the removed
  effect did. A real fix needs optimistic-concurrency (e.g. compare the
  `version` the form was opened with against the current one at save time,
  and warn/block on mismatch) — not attempted here; scope was the react rule
  violation, not the underlying conflict-resolution gap.
  (`client/src/app/skills/_components/SkillDetail/_components/ConfigTab/ConfigTab.tsx:29-33`,
  `client/src/app/skills/_components/SkillDetail/SkillDetail.tsx:45`)

- 2026-08-08 — `AgentCard.tsx`'s delete-button pattern (inline trash icon +
  `window.confirm` + mutate) has zero test coverage — `AgentCard.test.tsx`
  has no delete/confirm test at all — despite being the established
  precedent copied for `SkillsListView`'s new delete button
  (`SkillsListView.test.tsx` gained two tests: confirm-accepted,
  confirm-dismissed). Worth backfilling `AgentCard.test.tsx` with the
  equivalent pair next time that file is touched.
  (`client/src/app/agents/_components/AgentCard/AgentCard.tsx:41-59`,
  `client/src/app/agents/_components/AgentCard/AgentCard.test.tsx`)

## Session Notes

- 2026-08-14 — Implemented `docs/run-status-plan.md` end to end: fixed a
  real reported bug (live run status "disappearing" on tab switch — really
  `usePrReviews` going stale, see What Doesn't Work above), added a pulse
  indicator on the "Agent runs" tab, and (server-side) `RunBus` eviction.
  `pnpm typecheck` + full test suites (330 server, 180 client) green in
  both packages. Verified live against a real, unmocked ~110s agent review
  run via Playwright — confirmed the pulse dot's full lifecycle and,
  critically, that the new review appears on the Findings tab with no page
  reload after being away during completion (the actual reported bug).

- 2026-08-14 — Implemented Phase 4 (final phase) of
  `docs/intent-smartdiff-improvements.md` — Findings → Code Changes tab
  navigation. `FileCard` needed zero changes (its `scrollToLine` contract
  already covered everything); the work was entirely prop-threading a new
  `ScrollTarget` type down two chains (`DiffTab` → `SmartDiffViewer`/
  `DiffViewer` → `FileCard`; `page.tsx` → `FindingsTab` → `ReviewRunAccordion`
  → `FindingsPanel` → `FindingCard`) plus the merge logic in
  `SmartDiffViewer`. 23 new/changed tests across 5 files, all green;
  `pnpm typecheck` clean. Verified the real round trip against PR #5 in the
  local dev DB (6 real findings, already reviewed — no new LLM call) via a
  scratch Playwright script: click → tab switch → correct FileCard
  force-opened → correct line scrolled into viewport (confirmed via
  `getBoundingClientRect`, not just RTL) → existing GitHub deep-link
  unchanged. This session picked up mid-Phase-4 after a prior implementer
  subagent hit an account-level API session limit partway through (had
  already finished the `ScrollTarget` type + `DiffViewer.tsx` — steps 1-2 of
  6 in the plan); the rest was completed directly rather than via a new
  subagent, to avoid the same limit.

- 2026-08-05 — Implemented `docs/findings-by-severity-plan.md` end-to-end
  (all 22 steps): server-side live per-severity findings aggregation on the
  PR list, click-popovers on both the PR list and the Agent-runs timeline,
  and the `Dropdown`/`SeverityCounts`/`FindingsPopoverList` primitives behind
  them. Verified via `pnpm typecheck` + full test suites (server unit +
  integration, client) in both packages, then a manual browser pass against
  seeded data — which is what caught the `overflow: hidden` clipping bug
  above; the plan itself didn't anticipate it.

- 2026-08-04 — `engineering-insights` did not auto-invoke during the whole
  `feat/review-cost` session (a multi-file feature with real findings — see
  above) despite matching its own "end of a non-trivial coding session"
  trigger in its `SKILL.md` description. It only ran because the user
  explicitly asked whether it had fired. Confirms the skill's own
  "Course arc" note in `references.md`: a description/manual trigger alone
  is not reliable enough without a `Stop` hook forcing it.
