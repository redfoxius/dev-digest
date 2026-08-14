# PR detail: live run-status survives tab switches + RunBus memory cleanup

**Status:** done — implemented and verified (2026-08-14). All 3 in-scope work
items shipped; typecheck + full test suites green in both packages; live
browser verification confirmed the actual reported bug is fixed (see
Verification section below for the real-run trace).

## Context

On the PR detail page, running a review agent and switching to a different
in-app tab (Overview / Files changed) before it finishes makes "the status
of the current run disappear." Investigation found this is not just a
cosmetic glitch — there's a real functional bug plus a UX gap, both rooted
in the fact that live-run tracking is entirely scoped inside the Findings
("Agent runs") tab's component subtree, which fully unmounts on tab switch
(`{tab === "findings" && <FindingsTab .../>}` in `page.tsx`).

### Root cause (confirmed by reading the actual code, not guessed)

1. **The real bug — stale review results.** `usePrReviews`
   (`client/src/lib/hooks/reviews.ts:52-58`, query key `["reviews", prId]`)
   has **no `refetchInterval`**, unlike its siblings `usePrActiveRuns`
   (`reviews.ts:29-36`) and `usePrRuns` (`reviews.ts:41-49`), which both
   self-poll every 4s while anything is active — and both live in `page.tsx`
   itself, so they keep polling regardless of which tab is selected. The
   *only* thing that ever calls `refetchReviews()` is `page.tsx`'s
   `onRunDone` callback (`page.tsx:175-179`), which is wired through
   `FindingsTab` → `RunStatus`'s local SSE `running: true → false`
   transition (`RunStatus.tsx:20-26`) — observable *only* while `RunStatus`
   is mounted, i.e. only while the Findings tab is open. **Concrete
   failure:** start a review → switch away before it finishes → it
   completes while unmounted → nothing refetches `reviews` → switch back
   and the new findings aren't there (stale up to 30s `staleTime`, with no
   other trigger to force a refresh) until a full page reload.
2. **Compounding cosmetic issue.** `RunStatus` owns `useRunEvents(runIds)`
   (`reviews.ts:196-244`) directly — a fresh `useEffect` per mount that
   opens brand-new `EventSource` connections and resets local `events`/
   `running` state to empty on every remount. The server *does* replay the
   full buffered history to a new subscriber (`RunBus.subscribe()`,
   `server/src/platform/sse.ts`), so no data is permanently lost — but the
   visible reset-then-replay reads as "it disappeared and restarted."
3. **No indicator anywhere outside the Findings tab** that a review is
   running — `PrDetailHeader`'s `Tabs` only shows a findings-count badge
   (`PrDetailHeader.tsx:117`), not a running-state cue.
4. **`RunBus`'s in-memory state is never evicted**
   (`server/src/platform/sse.ts`) — `buffers`/`seq`/`completed`/
   `cancelled` Maps grow by one entry per run for the lifetime of the
   server process, with no TTL/cleanup found anywhere.

### Logs assessment (separately requested)

- **Freshness:** correct. Live log is buffer-replay-then-live via SSE; the
  persisted `run_traces.trace.log` (`server/src/modules/reviews/
  run-executor.ts:495-528`, `traceFromBuffer()`) is captured once at
  completion, fetched by the drawer only once the run is no longer live
  (`useRunTrace(runId, !stillRunning)`) — no staleness path found.
- **Truncation:** none. `RunBus`'s buffer array and the persisted `jsonb`
  trace column are both unbounded — the *only* real "unbounded" problem is
  #4 above (Maps never evicted), which is a memory-growth risk, not a
  visible-log-truncation issue.
- **Sorting:** `LiveLogStream` (`client/src/vendor/ui/LiveLogStream.tsx`)
  has only a free-text filter (matches message or `kind` substring) — no
  sort control, no dedicated kind filter, unbounded DOM rendering. Assessed
  and reported; **not** part of this plan (see Out of scope).

## In scope for this plan

Confirmed with the user (multiSelect): the required fix, plus the tab pulse
indicator, plus RunBus memory cleanup. The SSE-lift (killing the reconnect
flash) and LiveLogStream sort/filter/virtualization improvements were
explicitly **not** selected — see Out of scope.

## Work items

### 1. Required fix — tab-independent `usePrReviews` freshness

File: `client/src/app/repos/[repoId]/pulls/[number]/page.tsx` only.

Extract the existing `onRunDone` inline body into a stable callback:

```ts
const handleRunSettled = React.useCallback(() => {
  invalidateActiveRuns();
  invalidateRunHistory();
  refetchReviews();
}, [invalidateActiveRuns, invalidateRunHistory, refetchReviews]);
```

Pass `handleRunSettled` as `FindingsTab`'s `onRunDone` prop (replaces the
inline arrow at `page.tsx:175-179` — no behavior change to the existing
SSE-driven fast path).

Add a page-level edge-triggered effect on `reviewRunning` (already
tab-independent — `usePrActiveRuns` lives here and polls every 4s
regardless of active tab):

```ts
const prevReviewRunningRef = React.useRef(false);
React.useEffect(() => {
  if (prevReviewRunningRef.current && !reviewRunning) handleRunSettled();
  prevReviewRunningRef.current = reviewRunning;
}, [reviewRunning, handleRunSettled]);
```

This gives two convergent paths to the same handler: the existing
SSE-driven one (near-instant, only while Findings tab is mounted) and this
new poll-driven one (≤4s lag, works regardless of tab). Harmless overlap
when both fire for the same completion (Findings tab open) — one redundant
`refetchReviews()` call, not worth deduping. `usePrReviews`'s public
contract is untouched, so `PRRow.tsx` (its other consumer) is unaffected.

**Why not just add `refetchInterval` to `usePrReviews` itself:** unlike
`usePrRuns`, whose own polled payload has a `status` field that can
self-gate polling, `ReviewRecord[]` has no "is a run active" concept —
gating it would require threading `activeRuns`/`prRuns` state *into* the
hook anyway, at which point the orchestration has just moved, not
simplified. Keeping it at the `page.tsx` call site (which already computes
`reviewRunning`) is more consistent with `usePrReviews`'s two genuinely
different consumers (`page.tsx` wants poll-fallback; `PRRow.tsx`'s
popover-triggered lazy fetch should never auto-poll).

### 2. Pulse indicator on the "Agent runs" tab

Files:
- `client/src/vendor/ui/kit/types.ts` — extend the object variant of
  `TabDef` with an optional `pulse?: boolean`.
- `client/src/vendor/ui/kit/Tabs.tsx` — render a small pulsing dot next to
  the label when `t.pulse` is true. Reuse the exact existing pattern from
  `client/src/vendor/ui/AutoTriggerStatus.tsx:29-35` (7px circle,
  `background: var(--ok)`/`var(--warn)`, `animation: ddpulse 2s ease-in-out
  infinite` — the `ddpulse` keyframe already exists globally in
  `client/src/vendor/ui/styles.css:230`), not a new animation.
- `client/src/app/repos/[repoId]/pulls/[number]/_components/PrDetailHeader/PrDetailHeader.tsx`
  — add a `reviewRunning: boolean` prop; set `pulse: reviewRunning` on the
  `"findings"` tab entry (`PrDetailHeader.tsx:117`).
- `client/src/app/repos/[repoId]/pulls/[number]/page.tsx` — pass
  `reviewRunning={reviewRunning}` into `<PrDetailHeader>`.

`@devdigest/ui` resolves entirely to `client/src/vendor/ui` in this repo
(not a hand-copied/synced subset the way `vendor/shared` is) — editing
`vendor/ui/kit/Tabs.tsx` directly is this repo's actual source, safe to
edit.

### 3. `RunBus` eviction so old runs' in-memory state doesn't accumulate forever

File: `server/src/platform/sse.ts` only.

- Add `const EVICT_AFTER_MS = 15 * 60 * 1000;` (15 min — generous for any
  realistic late-reconnect/replay, short enough to actually bound memory).
- Add `private evictTimers = new Map<string, NodeJS.Timeout>();` on
  `RunBus`.
- In `complete(runId)`, after the existing `emitters.delete(runId)`: clear
  any existing evict timer for this `runId` first (defensive, in case
  `complete()` is ever called twice), then schedule one that deletes the
  `buffers`/`seq`/`completed` entries for `runId` after `EVICT_AFTER_MS`,
  and removes itself from `evictTimers`.
- This makes the existing comment at `sse.ts:81` ("Keep the buffer briefly
  available for late subscribers") accurate — right now nothing ever
  evicts, so "briefly" is currently a lie.

**Accepted edge case (not fixed here):** a client that opens
`/runs/:id/events` for a run finished >15 min ago will, post-eviction, get
a *fresh* empty buffer (via `emitterFor`'s lazy-create) and `completed`
will no longer contain that `runId`, so the SSE stream won't auto-end via
`onDone` — it will hang open instead of replaying-then-closing. This is an
edge case (only hit by something explicitly re-opening a live-log stream
for a long-finished run) and is accepted as out of scope for this pass;
revisit only if it's ever actually observed (e.g. by having the route
check `agent_runs.status` in the DB before subscribing and short-circuit
if already done — not built now).

## Out of scope (explicitly deferred, not built in this pass)

- **SSE-lift to kill the reconnect-and-replay flash** (moving
  `useRunEvents` from `RunStatus` up to `page.tsx`, passing `events`/
  `running` down as props). Not selected by the user — it's a real
  architectural shift (`RunStatus` goes from self-subscribing to purely
  props-driven, `page.tsx`/`FindingsTab` pick up more prop surface) for a
  purely cosmetic improvement, given Item 1 above already fixes the actual
  functional bug on its own.
- **Deduping `RunTraceDrawer`'s independent SSE subscription** against
  `RunStatus`'s — only makes sense as a follow-up to the SSE-lift above
  (which wasn't selected); the server already handles multiple independent
  subscribers correctly via buffer replay, so this is a minor efficiency
  concern with no reported symptom, not a correctness issue.
- **`LiveLogStream` sort/kind-filter controls + render cap/virtualization**
  — not selected by the user. Assessed and reported (no sort control today,
  free-text filter only, unbounded DOM rendering) but left as a separate,
  independently-schedulable follow-up.
- **The SSE `onerror`-treats-any-transient-error-as-terminal reliability
  gap** in `useRunEvents` (`reviews.ts:228-232`) — a real latent issue
  (surfaced during investigation) but out of scope here; it's part of why
  Item 1's poll-based fix must be the authoritative source of truth
  regardless, not merely a stopgap for the tab-unmount case specifically.

## Files touched

- `client/src/app/repos/[repoId]/pulls/[number]/page.tsx`
- `client/src/vendor/ui/kit/types.ts`
- `client/src/vendor/ui/kit/Tabs.tsx`
- `client/src/app/repos/[repoId]/pulls/[number]/_components/PrDetailHeader/PrDetailHeader.tsx`
- `server/src/platform/sse.ts`

## Verification

- `pnpm typecheck` (client + server).
- `pnpm test` (client) — existing `RunStatus`/`PrDetailHeader`/`Tabs`
  suites (if any) stay green; add a small test if a natural spot exists
  for the pulse-dot prop and for the page-level `handleRunSettled`
  edge-trigger effect (may need a lightweight `page.tsx`-level test or can
  be verified structurally at the `PrDetailHeader`/`Tabs` level only, given
  `page.tsx` has no existing test file per this route's convention — note
  this explicitly rather than silently skipping coverage).
- Manual/browser: start a review on a real PR, immediately switch to
  Overview or Files-changed, wait for the run to finish (watch the "Agent
  runs" tab label for the new pulse dot while away), switch back to
  Findings — confirm the new results are already there (no reload needed).
  Also confirm the pulse dot appears/disappears correctly across a run's
  lifecycle, and that a normal "watch it complete from the Findings tab"
  flow is unchanged (no double-toast, no visible regression).
- Backend: no direct way to observe `RunBus` eviction other than code
  review + (optionally) a manual/log-based check that the timer fires; not
  worth a dedicated automated test for a 15-minute timer — note this as an
  accepted verification gap rather than skipping silently.
- `pr-self-review` after pushing, per this repo's session convention.
- `engineering-insights` at the end of the implementation session.

## Verification results (2026-08-14)

- `pnpm typecheck` — clean in both `server/` and `client/`.
- Server: 330 unit tests green (32→33 files, includes new
  `server/test/sse.test.ts` — 6 cases covering replay, immediate `onDone`
  for an already-completed run, and eviction timing via `vi.useFakeTimers`
  — kept-before-window / evicted-after-15min / no-duplicate-timer-on-
  double-`complete()` / never-evicted-if-never-completed).
- Client: 180 tests green (33→34 files, includes new
  `client/src/vendor/ui/kit/Tabs.test.tsx` — 4 cases covering the new
  `pulse` prop, coexistence with the existing `count` badge, no regression
  to `onChange`, and string-shaped tab entries).
- **Live browser verification (real review run, no mocks)** against a real
  PR (`redfoxius/dev-digest#6`) via a scratch Playwright script: triggered
  a real "General Reviewer" (deepseek-v4-flash via OpenRouter) run,
  immediately switched to the Overview tab before it finished — confirmed
  the pulse dot appeared on "Agent runs" (`PULSE_DOT_COUNT_WHILE_ON_OVERVIEW:
  1`), polled `GET /pulls/:id/runs/active` directly until the run genuinely
  completed (~108s — real LLM latency, not a bug), confirmed the pulse dot
  cleared (`PULSE_DOT_COUNT_AFTER_DONE: 0`), then switched to the Findings
  tab **without reloading the page** and confirmed the new review's
  accordion was already there (`REVIEW_RUN_ACCORDIONS_VISIBLE_NO_RELOAD: 2`
  — the pre-existing run plus the new one) — the exact scenario that was
  broken before this fix. Zero console errors throughout.
