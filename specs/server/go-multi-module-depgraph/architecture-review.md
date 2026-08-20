# Architecture Review — PR #25 (`fix/go-multi-module-depgraph`)

**Target:** `git diff main...fix/go-multi-module-depgraph -- server/src/adapters/depgraph/go.ts server/test/depgraph-go.test.ts` (verified `union.ts`, `index.ts`, `platform/container.ts` are byte-identical to `main` via `git diff --stat` — zero diff on all three).

**Skill routed:** `onion-architecture` (`.claude/skills/onion-architecture/SKILL.md`), matched because `server/src/adapters/depgraph/go.ts` is under `server/src/adapters/*`. No other skill applies — `server/test/depgraph-go.test.ts` is a test file for the same adapter, reviewed under the same skill's "Testability" axis rather than routed separately.

**Skipped:** none — both files in the stated scope are `.ts` under `server/`, no Go source files (`*.go`) or `client/src/**` files are touched by this diff, so `golang-architecture` and `frontend-ui-architecture` don't apply.

## Verification against each requested axis

1. **Import list unchanged?** Yes. `server/src/adapters/depgraph/go.ts:34-38` retains exactly the same four import lines as `main`: `node:fs/promises` (`readFile`), `node:path` (`dirname, join`), `../astgrep/index.js` (`parseImports`), `../../modules/repo-intel/languages/index.js` (`languageIdForFile`), plus the `./index.js` type-only import (`DepGraph, FileEdge`). No new dependency was added anywhere in the diff — confirmed by reading the diff hunk headers (only additions inside existing import block region are none) and the full current file.

2. **`DepGraph` port genuinely unchanged?** Yes. `git diff main...fix/go-multi-module-depgraph -- server/src/adapters/depgraph/index.ts` is empty. `interface DepGraph { buildEdges(root: string, files: string[]): Promise<FileEdge[]> }` is byte-identical, and `GoDepGraph.buildEdges` (`go.ts:49`) still matches that exact signature.

3. **`union.ts` genuinely unchanged?** Yes. `git diff` for `union.ts` is empty. `UnionDepGraph`'s constructor still defaults to `new GoDepGraph()` with no constructor args (`union.ts:14`), and `GoDepGraph`'s own constructor is unchanged (implicit, no explicit constructor added in the diff) — no new registration logic.

4. **New DB/network/cross-module coupling from the per-directory discovery/memoization logic?** None found. `discoverGoverningModule` (`go.ts:139-168`) and `readModulePathAt` (`go.ts:171-178`) only call `readFile(join(root, dir, 'go.mod'), ...)` — same `node:fs/promises` primitive already in use, bounded to `root`-relative paths built from `dirname()` walks that terminate at `'.'` (never above `root`). The new `moduleCache` (`go.ts:63`) is a plain in-memory `Map` scoped to a single `buildEdges` call — no persistence, no DB, no network, no cross-adapter coupling. The adapter remains a pure filesystem-reading, in-memory-caching component, same shape as before.

5. **New export surface?** None. `go.ts` still exports only `export class GoDepGraph` (`go.ts:48`); `GoModule`, `discoverGoverningModule`, `readModulePathAt`, `joinModuleRelative` are all module-private (no `export` keyword) — consistent with the plan's claim.

6. **Composition root (`platform/container.ts`)?** `git diff` for this file is empty — confirmed untouched, no new `new <Adapter>()` construction introduced or moved outside it.

7. **Other onion-architecture axes** (Module Anatomy routes→service→repository, Contracts as DTOs, Domain Purity) don't apply here — `go.ts` is a `src/adapters/*` infrastructure-ring file with no `modules/*` service/route/repository counterpart in this diff, and it doesn't touch `reviewer-core`.

8. **Test file (`server/test/depgraph-go.test.ts`)**: the `vi.mock('node:fs/promises', ...)` passthrough wrapper (test file lines ~13-19) is scoped to asserting call counts on the real `readFile` implementation for the adapter under direct unit test — not a service-level test that should instead be using `ContainerOverrides`/`src/adapters/mocks.ts`. `GoDepGraph` is itself the adapter being tested, so direct instantiation and real-filesystem fixtures (matching the file's own stated precedent, `indexer-pipeline.test.ts`) is the correct tier — no "Testability Follows From the Rule" violation.

## Non-architectural note (not a finding)

`go.ts:2` and `depgraph-go.test.ts` docstrings reference `docs/go-multi-module-depgraph-plan.md`, but the actual plan/spec in this branch live at `specs/server/go-multi-module-depgraph/{plan.md,spec.md}` — a stale doc-path reference. This doesn't map to any onion-architecture rule (dependency direction, ports, composition root, module anatomy, contracts, testability), so it's excluded from findings per this review's severity discipline; flagging for the implementer to fix as a docs nit if desired.

## Verdict

No divergence from the plan's own claims, and no onion-architecture rule violation (CRITICAL, HIGH, or otherwise) found in the actual diff.

```json
{
  "findings": []
}
```
