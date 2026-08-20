# Test Report: PR Why + Risk Brief

**Step:** `/run-plan` Step 1.5 — gap-fill test authoring, once per package, after all 16 Work Items' own self-verification tests already landed. Scope: find and fill cross-cutting gaps no single owned-path-scoped implementer would see, not duplicate existing coverage.

## server/

**Gap named, checked, found already covered:** an end-to-end `POST /pulls/:id/brief` cache-miss through the real route (real Postgres, LLM mocked only at `Container` level) — already present in `risk-brief.it.test.ts` (2 tests beyond the plan's original 6, added mid-run without an implementation-report update).

**Real gap found and filled:** `RiskBriefService.generate()`'s AC-9 branch (`droppedInputTooLarge` → `degraded_reason: 'input_too_large'`, no LLM call, no persist) had zero coverage of the wiring between the pure `assembleRiskBriefInput()` trimming signal and the service's early-return — only the pure function itself was unit-tested in isolation (`risk-brief-prompt.test.ts`), and `risk-brief-service.test.ts` never triggered the branch at all.

- Added: one `it(...)` to `server/test/risk-brief.it.test.ts` — a real ~3000-file diff makes the real route return `degraded_reason: 'input_too_large'`, zero LLM calls, prior valid persisted brief left untouched.
- Verified load-bearing via a mutation check (swapped the huge diff for a small fixture, confirmed the test fails as expected; reverted, confirmed green again).
- Result: `risk-brief.it.test.ts` now **9/9**.

**Other candidate gaps considered, not written (with reasoning):** AC-10's caller-only-file grounding widening end-to-end (already indirectly covered by the pre-existing AC-5/AC-10/AC-11 integration test); a concurrent-POST race (Postgres `onConflictDoUpdate` already guarantees row-level atomicity; no application-level "single in-flight generation" invariant is claimed anywhere in spec.md's ACs).

## client/

**Gap named, checked, found already covered:** the React-Query dedup assumption (`IntentCard` + `RiskBriefCard` both calling `usePrRiskBrief` under the same `["pr-risk-brief", prId]` key resolving to ONE network request) — a test for this (`OverviewTab.risk-brief-dedup.test.tsx`) had already been written by an earlier, interrupted test-writer run (session-limit failure mid-write) and was found on disk, verified passing (2/2), left as-is.

**Real gap found and filled:** cross-card cache-invalidation — clicking Regenerate in `RiskBriefCard` invalidates both `["pr-risk-brief", prId]` and `["pull", prId]` (`risk-brief.ts:38-41`), but no test exercised the second half: that `PrBriefBanner`'s risk badge (fed by a *different* query, `usePullDetail`) actually updates after a real regenerate. Each component's own test mocked around this cross-query path.

- Added: `client/.../OverviewTab/OverviewTab.risk-brief-pull-invalidation.test.tsx` — minimal harness (real `usePullDetail` → `riskLevel` prop → real `OverviewTab` → real `RiskBriefCard`, `page.tsx`'s unrelated repo/run-polling/blast-jump logic deliberately excluded) — a real Regenerate click flips `PrBriefBanner`'s badge from "Low risk" to "High risk" through genuine invalidation, not prop-drilling.

**Full client suite after both additions:** 49 files, **285/285 tests pass**. `pnpm typecheck` clean.

## Combined result

- `server/`: unit 47/47 files (456/456 tests, unchanged), `.it.test.ts` risk-brief **9/9** (was 8), pulls.it.test.ts 7/7 — all green.
- `client/`: **285/285** (was 284 post-fix, +1 new), typecheck clean.

Both Test Reports collected by the orchestrator from the two `test-writer` agents' final reports; no production code was modified by either (test files only, per each agent's own scope).
