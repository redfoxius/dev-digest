# Implementation Report — Project Context Folder v0.2 Exclude-List Flip

**Plan:** `specs/cross-cutting/project-context-folder/plan.md`
**Spec:** `specs/cross-cutting/project-context-folder/spec.md` (v0.2)

## Summary

Flipped the Project Context Folder's document-discovery model from an include-glob allow-list to a gitignore-style exclude-list, per spec revisions to AC-1, AC-3, AC-4, AC-5, AC-6, AC-7, AC-41, and new AC-43/AC-44. All 9 Work Items complete, executed in 4 phases by dependency:

- **Phase 1** (parallel): WI-1 (add `ignore` dep), WI-2 (DB migration), WI-4 (shared contract rename)
- **Phase 2** (parallel): WI-3 (`repos/repository.ts`), WI-5 (`reader.ts` rewrite), WI-6 (`routes.ts` validation flip), WI-8 (client hooks rename)
- **Phase 3**: WI-7 (`service.ts` — ties all prior renames together, null-vs-empty-aware defaulting)
- **Phase 4** (parallel): WI-9 (server + client test-fixture compile/pass casualties)

## Work Items

| WI | File(s) | Result |
|---|---|---|
| 1 | `server/package.json` | Added `ignore@^7.0.6`. `pnpm install` clean, no workspace-build prompt. |
| 2 | `server/src/db/schema/repos.ts`, `server/src/db/migrations/0028_context_search_excludes_rename.sql` + meta | Column renamed `context_search_globs` → `context_search_excludes`. `pnpm db:generate` confirms no-op ("No schema changes"); `pnpm db:migrate` applied cleanly against the dev DB. |
| 3 | `server/src/modules/repos/repository.ts:80-101` | `updateContextSearchGlobs` → `updateContextSearchExcludes`; removed the `[] → null` collapse so an explicit empty array persists verbatim (AC-6). |
| 4 | `server/src/vendor/shared/contracts/context.ts`, `client/src/vendor/shared/contracts/context.ts` | `ContextSearchConfig.globs` → `.excludes` in both hand-copies. |
| 5 | `server/src/modules/context-docs/reader.ts` | `DEFAULT_CONTEXT_GLOBS` → `DEFAULT_CONTEXT_EXCLUDES = ['**/AGENTS.md', '**/CLAUDE.md', '**/.claude/**']` (AC-43). Replaced `micromatch` include-glob filtering with `ignore`-based exclude filtering (AC-44: real gitignore semantics incl. `!` negation); `excludes.length === 0` short-circuits to "keep everything" (AC-6). `EXCLUDED_DIRS` walk-pruning, symlink-skip, and `classifyRoot()` logic untouched. |
| 6 | `server/src/modules/context-docs/routes.ts` | `ContextConfigBody.globs` → `.excludes`; dropped array `.min(1)` and the `isGlobEscaping` escape-check (AC-7 — excludes can only narrow an already-clonePath-bound scan); added an empty/whitespace-only-pattern 422 check. `glob-safety.ts` and its other call site (`agents/service.ts`, `skills/service.ts`) left untouched (AC-41b, out of scope). |
| 7 | `server/src/modules/context-docs/service.ts:11,78,152-164` | Renamed all `globs`/`contextSearchGlobs` references; replaced the `?.length ?` falsy-check idiom with `??` nullish-coalescing so `null` → defaults apply but `[]` stays `[]` verbatim. `pnpm typecheck` (server/src) clean. |
| 8 | `client/src/lib/hooks/context-docs.ts:98-116` | `useContextConfig`/`useSetContextConfig` renamed `globs` → `excludes`; doc comments updated. |
| 9 | `server/test/{context-docs-reader,context-docs.it,onboarding,risk-brief-service}.test.ts`, `client/src/lib/hooks/context-docs.test.tsx` | Renamed fixture fields/identifiers; rewrote the AC-5/AC-6/AC-7 scenarios in `context-docs.it.test.ts` for the new semantics (AC-7's escaping-pattern case now expects `200`, not `422`); fixed one stale doc-comment in `service.ts:20`. |

## Verification status

- `pnpm typecheck`: clean in both `server/` and `client/`.
- `server/` unit suite (`context-docs-reader`, `onboarding`, `risk-brief-service`): 33 tests passed.
- `server/` integration suite (`context-docs.it.test.ts`, real Postgres via testcontainers): 15 tests passed.
- `client/` (`context-docs.test.tsx`): 20 tests passed.
- DB migration: `pnpm db:generate` no-op confirmation + `pnpm db:migrate` applied cleanly against the dev DB.
- Confirmed `glob-safety.ts` and its second `isGlobEscaping` call site (`agents/service.ts:289`, `skills/service.ts:239`) are unchanged — AC-41(b) untouched, as scoped.
- Confirmed `resolveWithinClone`/`verifyRealpathWithinClone` and their call sites unchanged.
- Confirmed (repo-wide grep) `micromatch` now has zero remaining import sites — flagged for a possible follow-up dependency removal (not done in this pass; noted as a judgment call the plan's WI-1 deferred to post-WI-5 confirmation, see plan's own-research note).

## Deferred to next pipeline stage (test-writer)

Every implementer explicitly declined to author new scenario coverage beyond fixing existing-test compile/pass casualties, per the plan's own instruction. New coverage still needed:
- AC-43: default exclude list (`**/AGENTS.md`, `**/CLAUDE.md`, `**/.claude/**`) applied when unconfigured — one scenario exists now in the rewritten `context-docs.it.test.ts`, but broader fixture coverage (nested paths, multiple `.claude/` subpaths) would strengthen it.
- AC-44: `ignore`-based gitignore semantics — wildcard/`**`/anchoring/negation combinations beyond the one `docs/**` + `!docs/keep.md` case already covered.
- AC-7's behavior inversion (escaping patterns no longer rejected) — covered once in the it-test; the client's mocked `context-docs.test.tsx` still asserted the OLD `422`-on-escaping-pattern behavior in one test at the time this report was written (flagged by the WI-9 client agent as a mock-only test, not a compile casualty). **Update:** `test-writer` has since corrected this test to assert the new `200`/persists-verbatim behavior — see `test-report.md`.

## Out of scope (confirmed untouched)

- `agents/service.ts`/`skills/service.ts`'s `assertPathsAttachable` (second `isGlobEscaping` call site).
- `glob-safety.ts` (`isGlobEscaping`, `resolveWithinClone`, `verifyRealpathWithinClone`).
- Consuming the target repo's own real `.gitignore` file (spec explicitly rules this out — app's own config-field syntax only).
- Any client UI page/component for editing this config (none exists yet; only the hooks were touched).
