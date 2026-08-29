# Plan Verification Report — Eval Pipeline (Reviewer Agents)

**Plan:** `specs/cross-cutting/eval-pipeline/plan.md`
**Implementation Report:** `specs/cross-cutting/eval-pipeline/implementation-report.md` + `test-report.md`
**Code reviewed:** branch `feat/eval-pipeline` (commits `b27e793`, `4543cbe`) diffed against `docs/eval-pipeline-spec-and-plan`, plus test-writer's working-tree additions.

All test-suite claims independently re-run: `server/test/evals-*.test.ts test/run-executor.test.ts` → 75/75. `pnpm verify:l06` from repo root → **exit 0**, 501 server tests / 367 client tests, both typechecks clean.

## Overall Verdict: PASS (after one bounded fix-loop iteration)

Initial pass: 37 of 39 acceptance criteria MET, 2 NOT MET (AC-11, AC-25 — both below, since fixed). A targeted fix-loop iteration resolved both; a narrow re-verification pass confirmed both now MET, with zero new findings from a matching scoped architecture re-review. **All 39 acceptance criteria are now MET.**

## Fixed (originally NOT MET, now MET)

### AC-11 — `POST /agents/:id/eval-cases/:caseId/run` must return `EvalRunResult`
Originally returned a bare `EvalRun`. Fixed: `EvalsService.runOne` now locates the requested case's persisted row (real DB-generated id, from `insertRunBatch`'s `.returning()`) and returns `{run_id, case_id, result}`; `routes.ts` declares `response: { 200: EvalRunResult }`. `runAll`/`getDashboard` shapes confirmed unchanged. Re-verified: `evals-routes.test.ts`/`evals-service.test.ts` — 23/23 passing, real `run_id` sourced from the persisted row (test uses a deliberately distinct `run_id` vs `case_id` to prove no aliasing).

### AC-25 — Deterministic alert must name the metric that regressed, per spec's own worked example
Originally headlined the largest-magnitude metric regardless of direction. Fixed: `buildAlert` now prefers the largest-magnitude *regressing* metric (delta ≤ −0.02), falling back to largest-absolute-delta only when nothing regressed. Re-verified by hand against the spec's exact worked example (precision −0.02/recall +0.04/citation +0.01) → now produces `"Precision dipped 2pts — recall and citation accuracy both up."`, matching spec. Fallback case (all metrics flat/improved) confirmed unchanged. `evals-scoring.test.ts` — 23/23 passing.

## Traceability matrix

37/39 MET (AC-1–10, AC-12–24, AC-26–39), full evidence for each in the agent's original report (superseded by the fix-loop's re-verification below for AC-11/AC-25). Full per-AC citations available in this report's generating conversation; summarized here to keep this file scannable — every criterion cites a file:line and either a passing test or direct code inspection.

## Architecture-review cross-reference

`architecture-review.md` gate: PASS, 2 WARNING (new `agents`⇄`reviews` coupling from the WI-6 extraction; the "cosmetic" SSE log-ordering change is a real I/O reordering, not just a label) + 1 SUGGESTION (same AC-11 gap, architectural-consistency angle). Neither WARNING rises to critical/high — logged for awareness, not blocking.

## Final canary (full, unscoped suite per package, run directly)

- `server/`: `pnpm test` (unscoped, includes `.it.test.ts` via real Testcontainers Postgres) — **637/638 passing**. The one failure (`test/settings-models.it.test.ts`) is confirmed pre-existing and unrelated to this feature: zero diff touches `server/src/modules/settings/**` or `server/src/vendor/shared/contracts/platform.ts` (where `FEATURE_MODELS` lives), and that file's own in-code comment documents the `risk_brief` registry default was intentionally changed to `openrouter`/`deepseek-v4-flash` in an earlier, unrelated commit (`c6513eb`) — the test simply wasn't updated to match. Not a regression introduced by this branch.
- `client/`: `pnpm test` (unscoped) — **367/367 passing**.
- `pnpm verify:l06` (excludes `.it.test.ts` by design) — exit 0.

## Next step

None — fix-loop resolved both findings, final canary is green (modulo the one confirmed pre-existing, unrelated failure). Ready for `pr-self-review` before merge.
</content>
