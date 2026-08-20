# Architecture Review: PR Why + Risk Brief

**Run:** `/run-plan` Step 2, iteration 1. Target: full uncommitted working tree (`git diff origin/main`, 56 files).

## Overall gate: FAIL — 1 CRITICAL finding

### Finding 1 (CRITICAL) — `server/src/modules/pulls/routes.ts:11,26`

`pulls/routes.ts` locally constructs a second, independent instance of `RiskBriefRepository` (`new RiskBriefRepository(container.db)`) instead of using a container-level shared getter — bypassing both `RiskBriefService` and `Container`.

**Rationale:** `server/src/platform/container.ts:85-88`'s comment on the shared-repository block states the composition-root rule this violates: repositories are "Constructed here, in the composition root, so consuming modules use `container.agentsRepo` instead of reaching into another module's folder." The `contextDocsRepo` getter (`container.ts:133-141`) documents the exact precedent that applies: a shared-repo getter exists "for OTHER modules' cross-reads (this module's own `service.ts` constructs its own instance directly)" — precisely `RiskBriefRepository`'s situation: own-module construction in `risk-brief/service.ts:82` is fine; `pulls/routes.ts`'s foreign-module construction is not.

`BlastService` is not a valid counter-precedent — it's a *service*, always called via its public method (as `risk-brief/service.ts:255` itself does), never a *repository* reached into directly from a foreign module's `routes.ts`.

**Fix:** add a `container.riskBriefRepo` lazy getter mirroring `reviewRepo`/`contextDocsRepo`; have `pulls/routes.ts` consume that instead of constructing its own instance.

## Everything else checked — clean

- `risk-brief/{repository,service,routes,prompt,grounding,constants}.ts` — routes→service→repository chain intact; only `repository.ts` imports `drizzle-orm`; `prompt.ts`/`grounding.ts` are genuinely pure (zero Container/DB/network imports).
- `context-docs/repository.ts:186` — the mandatory `inArray(source, ['docs','spec','insights'])` SQL filter is present (not just claimed), plus a JS-level defense-in-depth filter.
- Both vendor `contracts/brief.ts` copies byte-identical; `platform.ts` diff hunks byte-identical between copies (a separate, pre-existing, unrelated `defaultProvider`/`defaultModel` drift predates this PR — correctly out of scope).
- Client: all data-fetching confined to `lib/hooks/risk-brief.ts`; `RISK_SEVERITY_COLOR` correctly promoted (now 4 consumer folders); `mergeRisks`/`buildFlaggedRefsMap` correctly colocated/promoted; `OverviewTab.tsx`/`PrBriefBanner.tsx` stay pure prop-threading.
- `BlastRadiusCard.tsx`'s two small inline helpers (not a colocated `helpers.ts`) — MEDIUM organizational polish at most, not flagged.

## Fix-loop status

- Iteration 1: 1 CRITICAL finding dispatched to `implementer` — fixed by adding `container.riskBriefRepo` (lazy getter, mirrors `reviewRepo`/`contextDocsRepo` exactly, `container.ts:145-154`) and switching `pulls/routes.ts:294` to consume it instead of constructing its own instance.
- Iteration 2 (scoped re-review, `server/src/platform/container.ts` + `server/src/modules/pulls/routes.ts` only): **RESOLVED** — 0 findings. `pulls/routes.ts` no longer imports/constructs `RiskBriefRepository`; the getter matches the established memoization pattern byte-for-byte; no new violation introduced.

**Final gate: PASS** (0 findings remaining, backlog empty).
