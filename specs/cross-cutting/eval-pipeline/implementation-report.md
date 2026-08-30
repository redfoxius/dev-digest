# Implementation Report — Eval Pipeline (Reviewer Agents)

## Plan
- `specs/cross-cutting/eval-pipeline/plan.md`
## Spec
- `specs/cross-cutting/eval-pipeline/spec.md` (SPEC-2026-08-29-eval-pipeline)

## Summary

All 15 Work Items implemented across `server/` and `client/`. `reviewer-core/` untouched, as planned. Executed via `run-plan` with multi-agent dispatch: independent Work Items ran concurrently in batches; Work Items 4/5/6/7 (which all write `server/src/modules/evals/service.ts`) were combined into one sequential task to avoid concurrent-write conflicts on a shared file.

## Work Items — status

| WI | What | Status |
|---|---|---|
| 1 | `EvalExpectation`/`EvalCaseExpectedOutput` shared contract (both vendor copies) | Done |
| 2 | `evals/repository.ts` (Drizzle) | Done |
| 3 | `evals/scoring.ts` (pure, zero-LLM-call scoring) | Done — 22 tests |
| 4 | `EvalsService.createFromFinding` | Done |
| 5 | Manual case CRUD (`evals/service.ts`) | Done |
| 6 | Shared `resolveAgentRunConfig` extraction (`agents/helpers.ts`) + run execution | Done — extraction verified behavior-preserving |
| 7 | `EvalsService.getDashboard` | Done |
| 8 | Wire 7 routes + register `evals` module | Done |
| 9 | `pnpm verify:l06` (root `package.json` + `scripts/verify-l06.sh`) | Done |
| 10 | `client/src/lib/hooks/evals.ts` | Done |
| 11 | `FindingCard` "Turn into eval case" action | Done — 11 new tests |
| 12 | `AgentEditor` Evals tab + `EvalCaseModal` | Done — 40 tests (tab area) |
| 13 | Eval Dashboard sidebar page + drilldown | Done — 18 tests |
| 14 | Compare-runs view + `resolveAgentVersionForBatch` | Done — required adding missing `useAgentVersions`/`useAgentVersion` client hooks (see Deviations) |
| 15 | i18n/a11y closing pass (WI-11–14) | Done — zero real issues found, one test strengthened |

## Self-verification evidence

- `server/`: full unit suite (`pnpm exec vitest run --exclude '**/*.it.test.ts'`) — 48 files / 483 tests passing after WI-8. Includes `evals-scoring.test.ts` (22), `evals-service.test.ts` (17), `evals-routes-smoke.test.ts` (1), and the pre-existing `run-executor.test.ts` (17/17, unchanged — proves the WI-6 config-resolution extraction is behavior-preserving).
- `server/`: `pnpm typecheck` clean throughout.
- `client/`: full unscoped suite (`pnpm test`) — 57 files / 353 tests passing after WI-15.
- `client/`: `pnpm typecheck` clean throughout.
- `pnpm verify:l06` resolves and each of its 4 steps was independently confirmed green against the codebase state at the time WI-9 landed.

## Deviations from the plan (all self-reported by implementers, none silent)

1. **WI-14 required adding two client hooks the plan assumed already existed.** `client/src/lib/hooks/agents.ts` had no `useAgentVersions`/`useAgentVersion` wrapping the pre-existing backend routes `GET /agents/:id/versions[/:version]`. The implementer correctly stopped rather than inline-fetching (would have violated `frontend-ui-architecture`'s "all data-fetching lives in `lib/hooks/`" rule) or guessing; a follow-up task added the two hooks (mirroring `useAgentSkills`'s shape) plus tests, then completed the modal. Files: `client/src/lib/hooks/agents.ts`, `agents.test.tsx`.
2. **`client/src/vendor/shared/contracts/knowledge.ts` was missing `AgentVersion`/`AgentVersionConfig` entirely** — the plan's Context section claimed the two vendor copies were "byte-identical... only `EvalExpectation` genuinely missing," which was inaccurate for this type. Added, byte-identical to the server's copy, same hand-copied-twin convention WI-1 already used.
3. **Real bug found and fixed during WI-14**: `EvalTrendPoint.cost_usd` is `z.number().nullable()`, not always non-null — the Compare view's delta computation now handles `null` (renders `—`) instead of assuming both sides are numbers.
4. **Cosmetic-only SSE log-ordering change in WI-6's extraction**: the `runLog.step` label wrapping provider/skills/system-prompt resolution in `ReviewRunExecutor.runOneAgent` was renamed (`"Resolving ${provider} provider"` → `"Resolving agent run config"`) to describe the now-larger unit of work `resolveAgentRunConfig` performs. This changes the *order* some SSE Live Log lines appear in during a real review (not their content, cost, findings, or any persisted field). No test asserts on this ordering. **Flagged for architecture-reviewer/plan-verifier to confirm acceptable.**

## Known gap for the review gate (flagged repeatedly by 3 separate implementers, not yet fixed)

**`POST /agents/:id/eval-cases/:caseId/run` returns a bare `EvalRun`, not the `EvalRunResult` wrapper (`{run_id, case_id, result: EvalRun}`) spec §10 documents.** `EvalsService.runOne`'s return type is `Promise<EvalRun | undefined>`; the route passes that straight through. The client's `useRunEvalCase` hook was typed against the real (bare) shape rather than papering over the gap. This is a genuine spec-vs-implementation mismatch — left for `plan-verifier`/`architecture-reviewer` to formally flag and for a fix-loop pass to resolve (likely: have `runCases`'s single-case path return `{run_id, case_id, result}` using the inserted row's real id from `insertRunBatch`'s `.returning()`).

## Review gate outcome (update)

`test-writer` (both packages), `architecture-reviewer`, and `plan-verifier` all ran. `architecture-reviewer`: PASS (2 WARNING, 1 SUGGESTION, none blocking). `plan-verifier`: initially REVIEW (37/39 MET) — the `EvalRunResult` gap above and a `buildAlert` headline-selection bug (AC-25) were the two NOT MET criteria. A bounded fix-loop (1 iteration) resolved both; a scoped re-verification confirmed all 39/39 ACs now MET and 0 new architectural findings. See `verification.md` and `architecture-review.md` for full detail.

**Final canary** (full, unscoped suite per package, run directly): `server/` 637/638 (the one failure is confirmed pre-existing and unrelated — see `verification.md`); `client/` 367/367.

## Remaining (not this session's job)

- Manual/live end-to-end verification (real finding → case → run → prompt change → run → compare) and the course assignment's required screencast/screenshot — not performed by any implementer or review agent; remains for a human pass.
</content>
