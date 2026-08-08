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

## What Doesn't Work

## Codebase Patterns

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

## Tool & Library Notes

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
