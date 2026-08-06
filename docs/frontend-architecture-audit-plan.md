# Frontend architecture audit — backlog

**Status:** not started — report only, no fixes applied yet (deferred by
explicit choice; revisit this doc to decide what to act on).

## Context

Audit of `client/` (the Next.js frontend) against three Claude skills to
find refactor/optimization opportunities:

- [`frontend-ui-architecture`](../.claude/skills/frontend-ui-architecture/SKILL.md) — folder structure, component-folder anatomy, constants/utils/services boundaries, barrel-file policy.
- [`react-best-practices`](../.claude/skills/react-best-practices/SKILL.md) + [`next-best-practices`](../.claude/skills/next-best-practices/SKILL.md) — component behavior anti-patterns, accessibility, RSC boundaries, Suspense, bundling.
- [`react-testing-library`](../.claude/skills/react-testing-library/SKILL.md) — test coverage and testing-style anti-patterns, plus a TypeScript type-safety pass.

Three read-only passes over the live code produced the raw findings below;
a fourth pass deduplicated and tiered them by risk/effort. A handful of the
highest-stakes claims were spot-verified directly against source
(`ConfigTab.tsx`'s state-sync effect, `Modal.tsx`'s missing focus trap, the
`FindingsSection`/`FindingCard` severity-color drift, `page-shell/index.ts`'s
wildcard barrel) — all confirmed accurate.

## Tier A — Quick wins (low risk, small diffs)

1. **Dedupe `SEVERITY_ORDER`** — duplicated in `src/components/findings-popover/helpers.ts` (local, unexported) and `.../pulls/[number]/_components/FindingsPanel/constants.ts` (exported, has extra `INFO: 3`). Promote one canonical version to `lib/`, import from both.
2. **Dedupe `SEV_COLOR` and fix a real color bug** — `FindingCard/constants.ts` has `SUGGESTION: "var(--sugg)"`; `RunTraceDrawer/_components/FindingsSection/FindingsSection.tsx` inlines its own copy with `SUGGESTION: "var(--accent)"`. Same severity renders two different colors in different parts of the app. Delete the inline copy, import the canonical one (or promote both to `lib/` alongside #1 since they key off the same domain). *Behavior-visible: the trace drawer's SUGGESTION badge color changes.*
3. **Fix `Showcase`/`Gallery` naming mismatch** — `src/components/showcase/Showcase.tsx` exports `Gallery`, not `Showcase`; the folder's public name doesn't match its own export. Pick one canonical name, update `index.ts` and import sites. At 259 lines with an inline `Group` subcomponent, also a candidate for splitting into `_components/`.
4. **Fix or document 3 undocumented wildcard barrels** — `components/app-shell/index.ts`, `components/page-shell/index.ts` (re-exports *two* named exports, `PageContainer` + `FeaturePlaceholder`), `components/showcase/index.ts` all use `export * from` instead of the single-named-export shape the rest of the repo uses (40+ instances). The only sanctioned wildcard exception is `lib/hooks/index.ts`, documented inline. Either add the same kind of doc-comment, or convert to explicit named re-exports (trivial for `page-shell`).
5. **Centralize duplicated unsafe casts** — `f.severity as Severity` / `f.category as Category` appear unvalidated in both `FindingCard.tsx` and `FindingsPopoverList.tsx`; `e.kind as LogLine["k"]` appears independently in `RunTraceDrawer/helpers.ts` (×2) and `RunStatus.tsx`. Extract one shared type-guard/mapper per cast family so validation (or a fallback) is a one-file fix later.
6. **Dedupe `PrSize` union type** — `pulls/constants.ts` exports `PrSize` (`"S"|"M"|"L"`); `lib/types.ts`'s `PrRowView` re-inlines the same literal union instead of importing it. Import instead of duplicating.

## Tier B — Medium refactors (touch shared UI primitives, moderate risk)

1. **Add focus-trap + Escape handling to `Modal`/`Drawer`** (`vendor/ui/kit/Modal.tsx`, `Drawer.tsx`) — both have `role="dialog"` / `aria-modal="true"` and a visible close button but no actual focus containment and no Escape listener; `aria-modal` is currently misleading. Fix cascades to every consumer (`CreateAgentModal`, `RunTraceDrawer`, any future modal) since it's a shared primitive. *Behavior-visible: Escape will close every modal/drawer app-wide; Tab will cycle only within the dialog — check no consumer has a competing key handler before merging.*
2. **Wire `FormField`/`TextInput` label-to-input association** — `<label>` has no `htmlFor`, inputs never get/forward an `id`, so `aria-describedby`/`aria-invalid` wiring is *impossible* anywhere in the app today. `AddRepoView.tsx`'s inline error `div` is an unlinked sibling, not a wired error message — it's just the visible symptom of the shared primitive's gap.
3. **Fix `ConfigTab.tsx`'s prop-sync anti-pattern** — 9 `useState` fields mirror `agent.*` and are re-synced by a `useEffect` keyed on `agent.id` (lines ~18-39). Replace with `key={agent.id}` on the parent to force a clean remount, or collapse into a `useReducer` with an explicit reset action. Verify neither approach changes today's "unsaved edits are discarded on agent switch" behavior.
4. **Move `PRRow.tsx`'s stale-cache/refetch logic into `usePrReviews`** (`lib/hooks/reviews.ts`) — `missingExpectedReviews` computation and the refetch-triggering effect currently live in the component body instead of the hook layer that's supposed to own this per `frontend-ui-architecture`.
5. **Drop no-payoff `useCallback` wrapping** — `PrDetailHeader.tsx` and `FindingsTab.tsx` wrap pass-through handlers in `useCallback` for children that are never `React.memo`'d (zero usage of `React.memo` anywhere in the codebase). Optional/cosmetic — could also just be left as-is.
6. **Scope `Suspense` boundaries away from the root layout** — `app/layout.tsx` has one root `<Suspense fallback={null}>` wrapping the entire app instead of local boundaries around the three actual `useSearchParams` consumers (`pulls/page.tsx`, `pulls/[number]/page.tsx`, `agents/[id]/page.tsx`). No new skeleton UI needed — `fallback={null}` stays the same, it just moves to a smaller blast radius. *Behavior-visible: a suspension on one page no longer blanks the whole app.*

## Tier C — Bigger, deferred (needs its own scoping session)

- **Test coverage gaps** on components with real interactive logic and zero `*.test.tsx`: `InlineComposer` (swallows submit errors in an empty `catch {}` — no test verifies the caller-side toast actually fires), `DiffViewer`, `CommentThreadView`, `FileCard`, `CodeLine`, `OutdatedComments`, `CommentCard`, `AddRepoView.tsx` (full form flow), `SettingsApiKeys.tsx`/`SettingsModels.tsx`, `CreateAgentModal.tsx`+`ConfigTab.tsx` (only indirectly smoke-tested via `AgentEditor.test.tsx`), `AgentsListView`, `FilterBar`, `PrDetailHeader`, `FindingsTab`.
- **Testing anti-patterns to fix opportunistically**: `AgentEditor.test.tsx` mocks `useUpdateAgent().mutate` but never asserts it was called — can't catch a broken save flow. `RunHistory.test.tsx` (9 near-identical `it()` blocks) and `FindingCard.test.tsx` (theme-loop duplication) should become table-driven tests instead of enumerated cases.
- **Repo-wide `fireEvent` → `userEvent` migration** — every existing test uses `fireEvent`, a uniform deviation from the RTL skill's stated preference. Large, mechanical, its own PR.
- **Runtime validation at the API/SSE boundary** — `lib/api.ts`'s `apiFetch<T>` does `(await res.json()) as T` with zero shape validation; `lib/hooks/reviews.ts`'s SSE handler does `JSON.parse(ev.data) as RunEvent` the same way. Adopting zod validation here is a design decision (touches every hook in `lib/hooks/*`), not a mechanical fix — needs discussion before scoping.

## Not an action item (FYI only)

Every `page.tsx` is `'use client'` with no Server Component data-fetching —
this is intentional per `client/AGENTS.md` (local-first SPA over the
`server/` REST API), not a gap. Noted for awareness only.
