# Test Report — Project Context Folder v0.2 Exclude-List Flip

**Plan:** `specs/cross-cutting/project-context-folder/plan.md`
**Spec:** `specs/cross-cutting/project-context-folder/spec.md` (v0.2)

## Scope

Ran after all 9 implementation Work Items landed (see `implementation-report.md`). Added broader scenario coverage the implementers explicitly deferred, beyond the compile/pass-casualty fixes WI-9 already made.

## server/

### `server/test/context-docs-reader.test.ts` (+5 unit tests, no DB)

- **AC-43 (default exclude set)**: nested `AGENTS.md` (not just root) and multiple `.claude/**` subpaths excluded; `README.md`/`.github/**` survive. A genuine non-symlink `CLAUDE.md` case added, with a comment distinguishing it from this repo's own symlinked `CLAUDE.md`s (already skipped structurally by the walker's symlink-skip, unrelated to the exclude-pattern layer).
- **AC-44 (real gitignore semantics via `ignore`)**: `**/tmp.md` matching at root/1-deep/2-deep; an interior-slash pattern (`docs/anchor.md`, no `**`) correctly anchored to root — excludes the root-level file but not `sub/docs/anchor.md`; a `docs/**` + multi-level negation case (`!docs/keep-top.md`, `!docs/sub`, `!docs/sub/keep-nested.md`) re-including both a depth-1 and depth-2 file.
  - **Genuine gitignore-semantics finding during authoring**: re-including a file two directories deep requires negating the *intermediate directory* too, not just the leaf file — a real `.gitignore` never re-descends into an already-excluded directory just because a nested path is later negated. The test was corrected to include the intermediate negation; this is real `ignore`-package/gitignore behavior, not a test mistake or an implementation bug.

Result: 11/11 pass (6 pre-existing + 5 new).

### `server/test/context-docs.it.test.ts` (+1 integration test, real Postgres via testcontainers)

- **AC-6 (`null` vs `[]` distinction)**: full round-trip — unconfigured repo's `getConfig()` returns defaults → reindex excludes `AGENTS.md` → `setConfig(repoId, [])` persists `[]` verbatim (not collapsed to defaults) → `getConfig()` reflects `[]` → reindex now discovers `AGENTS.md`.

Result: 16/16 pass (15 pre-existing + 1 new), Docker/testcontainers reachable and used.

## client/

### `client/src/lib/hooks/context-docs.test.tsx` (1 test corrected)

- The one pre-existing test asserting a `422` response for a clonePath-escaping-looking exclude pattern (`../../etc/**/*.md`) tested stale (pre-v0.2) behavior — per spec AC-7's revision, an exclude pattern only ever narrows an already-`clonePath`-bound candidate list (pure string-matching against paths that structurally can't escape `clonePath`, regardless of whether matching uses `micromatch` or `ignore`), so the real server no longer rejects it. Rewrote the test to mock a `200` response and assert the pattern persists verbatim (query cache + returned data), renaming it from "surfaces a 422 escaping-glob rejection as an ApiError" to reflect the corrected behavior.
  - **This specific change tripped an internal security-review flag** ("test removal weakening a path-traversal guard"). Investigated and confirmed with the user before proceeding: the underlying discovery mechanism (`reader.ts`'s `walk()`, unchanged by this whole revision) is what actually bounds file access to `clonePath` — the exclude/include pattern is never used to resolve a filesystem path, only to string-match against an already-safely-walked candidate list, in both the old and new model. The `422` check was defense-in-depth against a vulnerability class this data flow never actually had. User explicitly confirmed proceeding with the corrected test (2026-08-23).

Result: 20/20 pass.

## Summary

- 6 new/corrected test cases across 3 files (5 new unit, 1 new integration, 1 corrected mock test).
- All scoped test runs green; no full-suite run performed (not needed — no shared fixture/setup touched).
- No implementation bugs found during authoring.
