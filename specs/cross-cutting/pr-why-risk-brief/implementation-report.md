# Implementation Report: PR Why + Risk Brief

**Plan:** [plan.md](./plan.md) — 16 Work Items, multi-agent DAG execution (7 dependency-ordered batches).
**Spec:** [spec.md](./spec.md) (SPEC-2026-08-20-pr-why-risk-brief, 31 ACs).
**Execution:** `/run-plan`, 2026-08-20. All 16 Work Items completed; every implementer self-verified with scoped tests + typecheck before returning.

## AC-N traceability preflight

31/31 `AC-N` ids in `spec.md` are referenced by at least one Work Item's `Satisfies:` line in `plan.md`; no stray ids on either side. Confirmed mechanically before any implementation started.

## Work Items — status

| WI | Title | Files (new/changed) | Self-verify |
|---|---|---|---|
| 1 | Shared contracts `RiskBrief`/`ReviewFocusItem`/`RiskBriefGenerateResult`, `PrDetail.risk_level` | `server/`+`client/` `vendor/shared/contracts/{brief,platform}.ts` | typecheck (found + flagged the `octokit.ts`/`mocks.ts` gap, closed by WI-9) |
| 2 | `pr_brief` table-shape verification (no migration) | none | static schema read, confirmed `{pr_id, json}` |
| 3 | `context-docs` top-K similarity search | `context-docs/{similarity.ts (new),repository.ts,service.ts}`, `test/context-docs-similarity.test.ts` | 5+40/40 unit tests, incl. `source:'code'` exclusion |
| 4 | `risk-brief` constants + repository (over `pr_brief`) | `risk-brief/{constants,repository}.ts` (new), `test/risk-brief-repository.test.ts` | 4/4 unit tests |
| 5 | Input assembly + token-budget trimming | `risk-brief/prompt.ts` (new), `test/risk-brief-prompt.test.ts` | 6/6 unit tests |
| 6 | Grounding + output bounding | `risk-brief/grounding.ts` (new), `test/risk-brief-grounding.test.ts` | 13/13 unit tests |
| 7 | `RiskBriefService` orchestration | `risk-brief/service.ts` (new), `test/risk-brief-service.test.ts` | 11/11 (+39/39 sibling-suite regression) |
| 8 | Routes `GET`/`POST /pulls/:id/brief` + module registration | `risk-brief/routes.ts` (new), `modules/index.ts`, `test/risk-brief.it.test.ts` | 6/6 it.test (real Postgres) + 7/7 `pulls.it.test.ts` regression |
| 9 | `GET /pulls/:id` `risk_level` enrichment | `pulls/routes.ts`, `adapters/github/octokit.ts`, `adapters/mocks.ts`, `test/pulls.it.test.ts` | 7/7 it.test, server typecheck 3→0 errors |
| 10 | `RiskBriefCard` (new client component) | `lib/hooks/risk-brief.ts`, `OverviewTab/_components/RiskBriefCard/**` (new), `messages/en/brief.json` | 6/6 + 16/16 sibling regression |
| 11 | Promote `RISK_SEVERITY_COLOR` | `client/lib/risk-severity.ts` (new), `IntentCard/constants.ts` (re-export) | 5/5 `IntentCard` regression |
| 12 | `PrBriefBanner` risk badge (both branches) | `PrBriefBanner/{PrBriefBanner.tsx,styles.ts}`, `messages/en/prReview.json` | 7/7 + 4/4 sibling regression |
| 13 | Flagged-refs derivation helper | `client/lib/risk-brief-helpers.ts` (new) | 6/6 unit tests |
| 14 | `BlastRadiusCard` flagged-dot | `BlastRadiusCard/{.tsx,styles.ts}`, `BlastRadiusCard.test.tsx` (new) | 5/5 + 21/21 sibling regression |
| 15 | `page.tsx`/`OverviewTab` wiring | `page.tsx`, `OverviewTab/{.tsx,.test.tsx}` | 35/35 scoped + 282/282 full client suite |
| 16 | `IntentCard` risk merge | `IntentCard/{.tsx,helpers.ts (new),.test.tsx}` | 11/11 + 27/27 sibling regression |

## Deviations from the plan's literal text (all judgment calls made in-scope, flagged for review)

- **WI-1**: found the `octokit.ts`/`mocks.ts` gap the plan's WI-9 text didn't originally name — folded the fix into WI-9's scope (agreed live during orchestration) rather than leaving server typecheck red.
- **WI-3**: added a JS-level `source !== 'code'` defense-in-depth filter on top of the mandatory SQL `inArray(source, ...)` filter — not required by the plan, added for unit-testability without Postgres and resilience to a future WHERE-clause regression.
- **WI-9**: flags a tension for `architecture-reviewer` — `RiskBriefRepository` is locally constructed in `pulls/routes.ts` (`new RiskBriefRepository(container.db)`) rather than exposed via a `container.riskBriefRepo` getter, mirroring `BlastService`'s local-construction precedent but not `reviewRepo`/`contextDocsRepo`'s getter precedent. Followed the task's explicit scoped instruction; judgment call flagged for the review gate.
- **WI-12**: implemented `riskLevel` as optional (`riskLevel?:`) rather than the spec's literal `required (nullable)` typing, to avoid breaking `client/` typecheck before WI-15 wired the real value through — resolved once WI-15 landed (confirmed clean).
- **WI-16**: colocated `mergeRisks` unit tests inside `IntentCard.test.tsx` rather than a separate `helpers.test.ts`, since the owned-paths list for that Work Item didn't enumerate a fourth file.

## Known gaps / deferred (explicitly out of scope per the plan, not defects)

- No manual/browser screenshot pass yet (plan's Verification section defers this to a final manual step, not a Work Item).
- `IntentCard` review_focus[] surfacing — intentionally out of scope (§12 of spec.md).
- Real-Postgres confirmation that the `source` SQL filter itself excludes `'code'` rows (WI-3's unit tests cover the JS-level defense-in-depth filter; no `.it.test.ts` was added for the SQL clause itself).

## Post-DAG canary regression found and fixed (orchestrator, direct — not a subagent)

A full, unscoped `server/` unit-suite run (something no single owned-path-scoped implementer runs) caught one real regression no Work Item's own scoped tests could see: `server/test/contracts.test.ts:246`'s pre-existing `PrDetail` fixture (predates this feature) omits `risk_level` and asserts `.not.toThrow()` — this broke because WI-1 typed the new field `risk_level: RiskSeverity.nullable()` (required, just nullable), inconsistent with every sibling PrDetail enrichment field on the same contract (`verdict`, `score` are both `.nullish()` — optional AND nullable, per the contract's own comment: "verdict is nullish, absent-fixture above must keep passing"). **Fix**: changed `risk_level` to `RiskSeverity.nullish()` in both vendor copies (`server/` + `client/` `contracts/platform.ts`), matching the established convention — not a test change, a contract-shape correction. Re-ran full server unit suite (47/47 files, 456/456 tests, was 1 failure before the fix) and full client suite (48/48, 284/284) to confirm no other consumer assumed `risk_level` was required.

## Full local verification at DAG completion (final canary, post-fix)

- `client/`: `pnpm typecheck` clean; full suite `pnpm exec vitest run --reporter=dot` — 48 files, **284/284 tests pass**.
- `server/`: `pnpm typecheck` clean; full unit suite (excl. `.it.test.ts`) — 47 files, **456/456 tests pass**.
- Server `.it.test.ts` (real Postgres, testcontainers): `risk-brief.it.test.ts` 8/8, `pulls.it.test.ts` 7/7 — **15/15**.

## Steps 1.5 through 3.5 — completed after session-limit resume

Resumed after the earlier session-limit block. Full results:

- **Step 1.5** (`test-writer`, one per package): see `test-report.md`. Server: found and closed a real AC-9 wiring gap (`server/test/risk-brief.it.test.ts` 8→9 tests, mutation-checked). Client: confirmed a pre-existing dedup test was already correct, and closed a real cross-card cache-invalidation gap (`OverviewTab.risk-brief-pull-invalidation.test.tsx`, new).
- **Step 2** (review gate): `architecture-reviewer` → **FAIL**, 1 CRITICAL (`pulls/routes.ts` locally constructing `RiskBriefRepository` instead of a `container.riskBriefRepo` getter — the exact tension flagged in WI-9's own report). `plan-verifier` → **PASS WITH GAPS**, all 31 ACs + all 16 WIs independently re-verified MET, same architectural tension flagged, plus a spec-text/code mismatch on AC-22's `risk_level` optionality (spec said "required (nullable)", code correctly shipped `.nullish()` matching sibling fields — spec corrected). Full reports: `architecture-review.md`, `verification.md`.
- **Step 3** (fix loop, 1 of max 3 iterations used): dispatched one `implementer` for the CRITICAL finding — added `container.riskBriefRepo` (mirrors `reviewRepo`/`contextDocsRepo` exactly), switched `pulls/routes.ts` to consume it. Scoped re-review by `architecture-reviewer`: **RESOLVED**, 0 findings. **Backlog empty — gate PASS.**
- **Step 3.5** (final canary, orchestrator via Bash, no subagent): `server/` typecheck clean, unit suite **456/456** (47 files); `client/` typecheck clean, full suite **285/285** (49 files); `server/` full `.it.test.ts` suite — **1 pre-existing, unrelated failure** (`test/smart-diff-service.it.test.ts` — a `proposed_splits` directory-naming assertion, fails even in isolation, zero overlap with this feature's changed files, not caused by this diff) alongside **132 other integration tests passing**. Not fixed — out of scope for this feature, flagged for separate tracking.

## Ready state

All 16 Work Items implemented and self-verified. Both gap-fill test-writer passes complete. Review gate PASS (1 CRITICAL found and resolved in one fix-loop iteration). Final canary green except one pre-existing, unrelated integration-test failure. Nothing committed — working tree holds the full feature, uncommitted, per `/run-plan`'s guardrail (never pushes/merges/commits on its own). Recommended next step: `pr-self-review` before any push, and separately track the pre-existing `smart-diff-service.it.test.ts` failure (unrelated to this feature).
