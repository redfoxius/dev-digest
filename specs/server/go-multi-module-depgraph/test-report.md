# Test Report

**Target:** `server/src/adapters/depgraph/go.ts` (Go multi-module import-graph discovery) — audit-and-extend of `server/test/depgraph-go.test.ts` against `specs/server/go-multi-module-depgraph/spec.md`'s AC-1..AC-11.

## AC-1..AC-11 Traceability Table

| AC | Requirement (paraphrased) | Test | Verdict |
|---|---|---|---|
| AC-1 | Upward-walk discovery, stop at first `go.mod` found | `WI-7 "resolves local imports to repo-relative keys..."` (`gameserver/go.mod` one level below root) | **solid** — matches spec's exact fixture shape and Verify text |
| AC-2 | Multi-module monorepo, independent per-sibling resolution, zero cross-module edges | `WI-6 "resolves each sibling module independently..."` — asserts real edges in 2 modules + a loop checking every edge's `from`/`to` share a top-level segment | **solid** — the top-level-segment check is a genuine cross-module-leak guard, not just presence checks |
| AC-3 | Deepest-`go.mod`-wins for nested module boundaries | `WI-4` — 3 tests: no leak into inner module, same-module edge preserved, inner module resolves against its own `go.mod` | **solid, independently re-verified as load-bearing** (see below) |
| AC-4 | Per-directory discovery memoization within one `buildEdges` call | `WI-8` — spies `readFile`, asserts the shared directory's `go.mod` path is read exactly once across 3 co-located files | **solid** — genuinely derived from spec Verify text, would fail without memoization |
| AC-5 | Repo-relative path-join fix for non-root modules | `WI-7` | **solid** — the asserted edge (`gameserver/main.go` → `gameserver/internal/foo/foo.go`) can only exist if the joined key is used; the unjoined key (`internal/foo`) isn't a real `filesByDir` bucket, so a regression here fails closed to zero edges, not a false positive |
| AC-6 | Root-`go.mod` backward compatibility | Original `describe('GoDepGraph', ...)` block, unmodified | **solid** — matches spec's explicit "continues to pass unmodified" instruction |
| AC-7 | Per-file/per-module graceful degradation (ungoverned directory doesn't affect a governed sibling) | **was missing** — no WI/test in the original pass covered this despite WI-2 (production code) citing it; new test **`GoDepGraph — mixed fixture: one governed directory, one ungoverned directory (AC-7)`** added | **was-missing-now-added** |
| AC-8 | Whole-repo empty-edges fallback preserved | Original `"returns [] when go.mod is missing"` test, unmodified | **solid** — matches spec's explicit "continues to pass unmodified" instruction |
| AC-9 | Discovery walk never reads/stats above `root` | `WI-9` (deep-nesting, asserts every `go.mod` candidate path starts with the temp root, exact call count) + `WI-5` (adversarial). Spec's own named fixture ("a Go file sits directly at `root`") wasn't separately tested with an fs-call assertion — new test **`GoDepGraph — file directly at root, no go.mod anywhere (AC-9)`** added, asserting exactly one `go.mod` read (`root/go.mod`) and zero calls outside root | **was-missing-now-added** (WI-9 already exercised the same boundary code path logically, but the spec's literal named fixture had no dedicated fs-call assertion — added for direct traceability) |
| AC-10 | Resolved path used only as map key, fails closed on traversal-shaped import | `WI-5` — traced through by hand: `example.com/gameserver/../../../etc` **does** prefix-match the module path (so `resolveLocalPackageDir` returns `../../../etc`, not `null`), so this genuinely exercises the map-lookup-miss path, not an early parse-reject; assertion checks both `edges === []` **and** zero `readFile` calls outside root | **solid** — not tautological, would catch a regression that used `path.resolve`+direct fs read instead of a map lookup |
| AC-11 | Discovery bounded by real path depth, no separate max-depth cap | `WI-9` — 5-segment-deep fixture, asserts exact call count (6 = 5 nested + root) and completion | **solid** — asserts on a depth-specific call count and completion, not just "returns fast" |

## Independent re-verification of the WI-4 guard's load-bearing-ness

Did **not** trust the implementer's report — redid the experiment myself:
1. Ran the baseline suite first: 15/15 passing.
2. Temporarily neutralized the target-side governing-module guard in `server/src/adapters/depgraph/go.ts` (replaced the `if (!targetModule || targetModule.modulePath !== ... || targetModule.moduleDir !== ...) continue;` block with a no-op `if (false) continue;`).
3. Reran only the WI-4 nested-module describe block: the guard test **`produces zero edges from an outer-module file into an inner module it only string-prefix-matches into`** failed exactly as expected (`expected true to be false` — the leaked edge `a/main.go → a/b/x/x.go` appeared), while the other two nested-module tests (same-module edge, inner-module-resolves-its-own-imports) still passed, confirming they don't exercise this specific leak path.
4. Restored the file via `git checkout -- src/adapters/depgraph/go.ts` (working tree was clean before the experiment, confirmed via `git status`), reran the same describe block: all 3 pass again, then reran the full file: 17/17.

This confirms the guard is genuinely load-bearing — independently, not by repeating the implementer's claim.

## Tests Written / Modified
- `server/test/depgraph-go.test.ts` — added `GoDepGraph — mixed fixture: one governed directory, one ungoverned directory (AC-7)` — encodes AC-7's requirement that a directory with no governing `go.mod` anywhere in its ancestry degrades only its own files, without affecting an unrelated sibling directory that does have a governing module, and without throwing.
- `server/test/depgraph-go.test.ts` — added `GoDepGraph — file directly at root, no go.mod anywhere (AC-9)` — encodes AC-9's literal Verify fixture (a Go file directly at `root`, no `go.mod` anywhere) with an explicit fs-call-boundary assertion (exactly one `go.mod` read, at `root/go.mod`; zero reads outside root), rather than only checking the return value.
- No skill scaffolding conflict applied here — this is a pure Node/vitest hermetic adapter test, no `fastify-best-practices`/`onion-architecture`/`drizzle-orm-patterns` structural concerns (confirmed: no port/DI/Fastify/Drizzle surface touched, matches plan's own note that `onion-architecture` was considered and not applicable).

## Test Commands Run
- `cd server && pnpm exec vitest run depgraph-go.test.ts --reporter=dot` — pass, 17/17 (after additions; 15/15 baseline before)
- `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' --reporter=dot` — pass, 42 files / 417 tests, no regression
- `cd server && pnpm typecheck` — clean, no errors

## Self-Verification
- Baseline run before any edits (15/15) — pass
- Guard-disable experiment on `go.ts`, targeted rerun of the WI-4 describe block — confirmed the guard test fails for the right reason when the guard is neutralized (`fail`, as expected)
- Restore via `git checkout`, confirmed `git diff --stat src/adapters/depgraph/go.ts` empty and full file rerun back to green — pass
- New AC-7/AC-9 tests run against current (correct) implementation — both pass for the stated reason (traced by hand, not just executed)
- Full unit suite + typecheck — pass, no regression
- Final `git status` on both files — only `test/depgraph-go.test.ts` modified; `src/adapters/depgraph/go.ts` untouched

## Deferred / Suspected Bugs
None found. Every new test derived directly from the spec's `Verify:` text passes against the current implementation — no evidence of a real implementation defect. The two gaps found (AC-7, AC-9) were coverage gaps in the test suite, not implementation bugs; the underlying `go.ts` behavior for both scenarios is already correct.

## Not Verified
- Integration suite (`*.it.test.ts`) not run — out of scope for this adapter (no DB/Docker dependency; `depgraph-go.test.ts` is a unit test file per its own filename convention, and this task's instructions scoped verification to the unit suite + typecheck).
- The real external repos cited in spec §1 (`zbc-wtf`, `layering-skill-testbed`) were not re-indexed against this build; per the plan's own Verification section, the fixture shapes in the test file are direct analogues and re-running against real external repos was explicitly not required.

**Files touched:** `server/test/depgraph-go.test.ts` (only file modified). `server/src/adapters/depgraph/go.ts` was read and temporarily edited twice for the independent guard-verification experiments, then fully restored via `git checkout` both times — final `git diff` against it is empty.
