# Architecture Review — Eval Pipeline (Reviewer Agents)

**Target reviewed:** `feat/eval-pipeline` diffed against its actual base `docs/eval-pipeline-spec-and-plan` (66 files changed). Production, non-test code only.

**Skills routed:** `onion-architecture` (server/src/modules/evals/*, agents/helpers.ts, reviews/run-executor.ts, modules/index.ts, db/rows.ts, vendor/shared/contracts/eval-ci.ts), `frontend-ui-architecture` (client/src/app/agents/**, client/src/app/eval-dashboard/**, client/src/app/repos/** FindingCard chain, lib/hooks/{agents,evals}.ts, vendor/shared/contracts/*, vendor/ui/nav.ts).

## Gate: PASS

No CRITICAL findings. Two WARNING-level findings, one SUGGESTION (the SUGGESTION was resolved by the fix-loop, see below).

## Fix-loop update

A scoped re-review of the two fix-loop changes (`buildAlert`'s headline logic in `scoring.ts`; the `EvalRunResult` wrapper in `service.ts`/`routes.ts`/the client hook) found **zero new findings** — both fixes stayed narrow, onion-clean, and consistent with existing route/hook conventions in this repo. The SUGGESTION below (inconsistent response-shape convention) is resolved by the `EvalRunResult` fix, not newly violated. The two WARNINGs are untouched by the fix-loop and stand as logged.

## Findings

### WARNING — `resolveAgentRunConfig` extraction introduces new bidirectional module coupling (`agents` ⇄ `reviews`)
- `server/src/modules/agents/helpers.ts:9-10` — new imports `buildStackFraming` (from `../reviews/helpers.js`) and `REVIEW_STRATEGY` (from `../reviews/constants.js`).
- `server/src/modules/reviews/run-executor.ts:12` — `import { resolveAgentRunConfig } from '../agents/helpers.js'`.

Before this change, `reviews/` depended on `agents/` only through `Container.agentsRepo`. This extraction makes `agents/helpers.ts` reach directly into `reviews/` internals — the reverse direction — creating a two-way module dependency where before there was only one. Not a Dependency Rule break, not circular, so not CRITICAL — but new, undisclosed coupling the plan's "no scope creep" bar for this one accepted exception should have caught. A cleaner placement (a shared `modules/_shared/` pure helper, or accepting the duplication of `buildStackFraming`/`REVIEW_STRATEGY` instead) would keep `agents/` and `reviews/` mutually independent as originally designed.

### WARNING — WI-6's SSE log-ordering change is not purely cosmetic; it reorders a real async I/O call relative to repo-intel enrichment
- `server/src/modules/reviews/run-executor.ts:202-217` — `resolveAgentRunConfig`'s single `runLog.step` now performs `agentsRepo.linkedSkills()` (a DB read) as part of the FIRST step, before repo-intel enrichment (`buildCallersDigest`/`buildRepoMap`/`buildRankNote`) runs. Pre-diff, `linkedSkills()` ran AFTER that enrichment block.

Final resolved config values are unchanged (confirmed: `run-executor.test.ts` 17/17 pass unchanged) — not a correctness bug — but the plan required this be "a pure lift-and-shift with zero behavior change," and reordering when a DB call fires relative to other I/O on a live production request path is a real behavior change (SSE Live Log order, timing), not merely a label rename as the implementation report characterized it.

### SUGGESTION — Inconsistent response-shape convention: `POST /agents/:id/eval-cases/:caseId/run` returns a bare `EvalRun`
- `server/src/modules/evals/service.ts:230-236` (`runOne`) returns the same aggregate `EvalRun` shape `runAll` returns, with no `case_id`/`run_id`, unlike sibling case-scoped routes (`createCase`/`updateCase` return the named `EvalCase` entity). This is the already-known `EvalRunResult` spec-compliance gap (left for `plan-verifier`) — noted here only as a minor internal route-response-consistency smell, not a layering violation.

## Clean / explicitly checked, no findings

- The `resolveAgentRunConfig` extraction itself is narrow and correctly scoped (`agents/helpers.ts:94-160`) — takes only the 4 inputs it needs, no Drizzle/Fastify import, identical call sites in `run-executor.ts` and `evals/service.ts`.
- `client/src/vendor/shared/contracts/knowledge.ts`'s new `AgentVersion`/`AgentVersionConfig` — byte-identical to the server's copy (confirmed via diff).
- `useAgentVersions`/`useAgentVersion` in `client/src/lib/hooks/agents.ts:83-105` — match established hook conventions exactly.
- `evals/` module: routes→service→repository shape clean, only `repository.ts` imports Drizzle/schema, service reaches other modules only via `Container` getters, composition root places `new EvalsService(container)` directly in `routes.ts` (matches `RiskBriefService`/`BlastService` precedent, no new `Container` getter).
- `evals/scoring.ts` — zero DB/Fastify/LLM imports, true domain purity.
- Two-layer Zod validation correctly implemented on both create and update paths.
- Every new client component's data-fetching goes through `lib/hooks/{agents,evals}.ts` — no inline `fetch`/`api.*` anywhere (verified by grep).
- Every new component folder follows this repo's anatomy convention; route-colocation respected throughout.
</content>
