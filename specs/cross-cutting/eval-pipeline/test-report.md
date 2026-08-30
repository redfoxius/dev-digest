# Test Report — Eval Pipeline (Reviewer Agents)

## Plan / Spec
- `specs/cross-cutting/eval-pipeline/plan.md`
- `specs/cross-cutting/eval-pipeline/spec.md` (SPEC-2026-08-29-eval-pipeline)
- `specs/cross-cutting/eval-pipeline/implementation-report.md`

## Scope

Run after all 15 Work Items were implemented and self-verified by their own implementers. Two `test-writer` passes, one per package, dispatched to find and fill genuine coverage gaps beyond what implementers wrote inline — not to duplicate existing coverage.

## server/

New/extended test files:
- `server/test/evals-repository.test.ts` (new, 12 tests) — workspace scoping on every `eval_cases` read/write (AC-9/AC-24/AC-38, verified against real drizzle-orm SQL AST, not just call counts), `deleteCase`'s no-manual-cascade behavior (AC-8), `insertRunBatch`'s one-transaction/one-multi-row-insert mechanism + zero-row short-circuit (AC-12/AC-15/AC-21), `listRunsByCaseIds` `IN`-scoping.
- `server/test/evals-routes.test.ts` (new, 5 tests) — first non-Docker HTTP-layer (`.inject()`) test for the `evals` module: happy-path `200`, workspace-scoped `404`s (AC-24/AC-38), `422` on malformed `expected_output` (AC-10), and independent confirmation of the actual (bare `EvalRun`, not spec's `EvalRunResult` wrapper) response shape of the single-case run route — reproduces the already-known/documented gap, not a new one.
- `server/test/evals-service.test.ts` (extended, +1 test) — AC-13: two consecutive `runAll` calls each make fresh LLM calls, never replay/cache.

Result: `pnpm exec vitest run test/evals-repository.test.ts test/evals-routes.test.ts test/evals-service.test.ts test/evals-scoring.test.ts test/evals-routes-smoke.test.ts test/run-executor.test.ts --reporter=dot` — **75/75 passing**. `pnpm typecheck` clean.

Not verified: real-Postgres `.it.test.ts` coverage for the evals module (none exists; AC-9/AC-12's guarantees are proven structurally via fake-`Db` SQL-AST inspection, not against a real database).

## client/

New test files:
- `client/src/lib/hooks/evals.test.tsx` (new, 12 tests) — every hook in `evals.ts` against real request URL/method/body + real cache-invalidation behavior (fills a real gap: `EvalsTab.test.tsx` mocks `useRunEvalSet` away, so AC-31's "refetches both" guarantee was previously only proven at the mock level, not the real hook level).
- `client/src/app/repos/[repoId]/pulls/[number]/page.test.tsx` (new, 2 tests) — the actual `handleTurnIntoEvalCase` wiring in `page.tsx`: toast fires with the case name on success, no navigation call fires either way (completes AC-29's full path — `FindingCard.test.tsx` only proved the button fires its prop, not that the prop is wired correctly to the real mutation+toast+no-nav contract).

Precedent note: the implementation report's WI-14 discovery ("no hook-test precedent, no page.tsx-test precedent") was re-checked and found **partially inaccurate** — 5 of 12 `lib/hooks/*.ts` files do have dedicated test files, and 2 existing `page.tsx` files (`context/`, `tour/`) do have direct tests. Both gaps above were filled following those real precedents.

Result: `pnpm test` (full unscoped suite) — **367/367 passing** (353 baseline + 14 new). `pnpm typecheck` clean.

Not verified: `e2e/` browser flows (out of scope for test-writer); `EvalCaseModal`'s "Files" sub-tab content rendering (only Diff↔PR-meta switching asserted — judged non-regression-class per `TESTING.md`'s bar).

## Bugs found

None new. Both passes independently reproduced the already-known, already-documented gap (`POST /agents/:id/eval-cases/:caseId/run` returns bare `EvalRun`, not spec's `EvalRunResult` wrapper) rather than surfacing anything new — this is now confirmed at both the unit (server) and would-be-consumer (client hook typed against the real shape) level. Left unfixed for the review gate, per the implementation report.

## Combined totals

- `server/`: 483 (pre-existing/implementer) + 18 (test-writer) = **501 tests**, all passing.
- `client/`: 353 (pre-existing/implementer) + 14 (test-writer) = **367 tests**, all passing.
</content>
