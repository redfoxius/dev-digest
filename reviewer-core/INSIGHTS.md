# INSIGHTS — reviewer-core

Practical findings hit while working in this module. Append-only: correct a
stale entry with a new dated line, never edit or delete history silently.

Before writing here, check [AGENTS.md](AGENTS.md) — a finding that should
*always* apply belongs there as a standing rule; this file is for things too
specific, too contextual, or too unproven for that yet.

**Anti-vague test:** if someone who just read the code wouldn't be surprised,
don't write it. See the repo's `engineering-insights` skill for the full
workflow and quality bar.

## What Works

- 2026-08-13 — Diagnosing "a review/derive call silently produced nothing"
  is best done from persisted ground truth, not by re-reading code:
  `docker exec devdigest-postgres psql -U devdigest -d devdigest` against
  `agent_runs.status`/`error` + `run_traces.trace->'log'` (a jsonb array of
  `{t, msg, kind}` step entries with real timestamps) shows exactly what
  happened in a run — more reliably than inferring from `reviews.score`/
  `verdict` alone (a 0-score/approve row looks identical whether the model
  genuinely found nothing or a downstream step silently degraded). Also:
  before treating old "empty" rows as evidence of a CURRENT bug, compare the
  running server process's start time (`ps -o lstart`) and the DB rows'
  `created_at` against the relevant feature's own git commit dates — data
  produced by a process/commit that predates a feature isn't evidence about
  that feature (caught here: 2026-08-08 "Intent Layer does nothing" reports
  turned out to predate Intent Layer's first commit by two days).

## What Doesn't Work

## Codebase Patterns

- 2026-08-09 — `filterByScope`'s (`review/reduce.ts`) "preserve the
  highest-severity out-of-scope finding, ties broken by confidence then
  first-seen" rule gets "first-seen" for free by relying on
  `Array.prototype.sort` being a STABLE sort (guaranteed by spec since
  ES2019 / Node ≥12) — no explicit index is carried through the sort to
  break ties manually. Don't "fix" this by adding a manual stable-sort
  wrapper or an index tie-break; the built-in `sort()` is already stable in
  every runtime this package targets, and adding one would be unnecessary
  complexity for a non-bug. (`reviewer-core/src/review/reduce.ts` —
  `filterByScope`)

## Tool & Library Notes

- 2026-08-05 — `OpenRouterProvider`'s constructor passes `timeout: 90_000` to
  the `openai` SDK client, and the class's own docstring claims "request
  timeouts" live in this one place — but that constructor-level `timeout`
  turned out NOT reliably enforced in practice: a real review against a real
  ~30-file PR hung 8+ minutes with zero error, well past the documented
  90s×maxRetries(2) worst case (~4.5 min). Root cause unconfirmed (SDK/fetch
  edge case, not reproduced in a hermetic test — the hang only showed up
  against the real network). Fix: pass an explicit `{ signal:
  AbortSignal.timeout(timeoutMs) }` as the 2nd arg to
  `chat.completions.create()`, per-attempt — a standard, independently
  enforced abort mechanism, not dependent on whatever the SDK does
  internally with its own `timeout` option.
  (`src/llm/openrouter.ts:68-92`)

- 2026-08-13 — ~~The 90_000ms picked for `OpenRouterProvider`'s per-attempt
  `AbortSignal.timeout()` (2026-08-05 entry above)~~ turned out too
  aggressive — confirmed LIVE (not just read from code): both the automatic
  per-batch intent derivation (`server/.../run-executor.ts`) and a full
  agent review run both failed with the identical error "The user aborted a
  request." at ~90000ms/90276ms, against ordinary (not hung) OpenRouter
  calls. Root cause of the reproduction: this workspace's `review_intent`
  FeatureModel is configured to a free-tier model
  (`nvidia/nemotron-3-ultra-550b-a55b:free`), which measured 30s-220s+ real
  response times — well past 90s. Worse, the abort applies PER ATTEMPT
  (`completeStructured`'s `for (attempt = 1; attempt <= maxRetries + 1;
  ...)` loop, line 70) — a consistently-slow-but-eventually-successful model
  exhausts every retry against the same 90s wall instead of one attempt
  succeeding; retries don't help a genuinely slow (not flaky) provider at
  all. Fix: bumped the default to 300_000 (5 min). Re-verified live
  afterward: a manual intent derive that took 3:38 (218s — would have
  aborted under the old 90s ceiling) succeeded, and a 4-agent Run Review
  batch that previously had one agent abort at exactly 90s completed all 4
  with zero errors on a restarted server. Also bumped
  `server/src/adapters/llm/openai.ts`/`anthropic.ts`'s `DEFAULT_TIMEOUT`
  (was 60_000 — even shorter) to 300_000 for consistency, though that
  wasn't independently reproduced against those two direct, non-OpenRouter
  adapters this session. (`src/llm/openrouter.ts:51,70,94`)

## Recurring Errors & Fixes

## Open Questions

- 2026-08-13 — No test in this package's suite (`test/*.test.ts`, 30 tests)
  exercises `OpenRouterProvider`'s timeout/retry/abort behavior at all — the
  90s→300s change above shipped with zero regression coverage on either
  side, verified only against the real network. Worth a hermetic test (a
  stubbed `chat.completions.create` that never resolves, checked against a
  short injected `timeoutMs`) asserting the abort fires at the configured
  value, before the next timeout-tuning session repeats this same
  live-test-only verification loop.

## Session Notes
