# Go language support — analysis + plan

**This plan is the canonical worked example for the `add-language-support`
skill** (`.claude/skills/add-language-support/`) — the findings below (the
pointer-type bug, the 5th `SUPPORTED_EXT` consumer, the per-language-module
design decision, etc.) were distilled into that skill so the next language
(Rust, C++, ...) starts from a checklist instead of rediscovering the same
lessons. Read that skill first if you're adding a new language; read this
doc for the full phase-by-phase reasoning behind it.

## Context

DevDigest's review pipeline is JS/TS-only today. This doc analyzes exactly
where that coupling lives and lays out a phased plan to add a second
language pack, starting with Go, without regressing the existing TS/JS path.

## Where JS/TS coupling actually lives

The coupling is concentrated in one layer, not spread evenly across the
codebase.

**`reviewer-core/` — already language-agnostic, no changes needed.**
Diff→prompt→LLM→grounding treats the diff as opaque text keyed by line
number. There is no `language` field/enum anywhere. `repoMap`/`callers` are
just strings handed to it by the server — reviewer-core never inspects their
contents.

**`client/` — already language-agnostic, no changes needed.**
The diff viewer renders plain text lines, uses a single generic
`Icon.FileText` for every file, and has no syntax-highlighting library
(no Prism/Shiki/Monaco/CodeMirror).

**`server/` — the coupling, and it's triple-duplicated:**

- `server/src/modules/repo-intel/constants.ts:14` —
  `SUPPORTED_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']`, the
  allowlist driving `walk.ts`, `service.ts`, `incremental.ts`.
- `server/src/adapters/codeindex/ripgrep.ts:25` — a **second**,
  independently duplicated `CODE_EXT` allowlist.
- `server/src/adapters/astgrep/index.ts` — real tree-sitter parsing via
  `@ast-grep/napi`. `langForFile()` (lines 57-76) only recognizes
  `TypeScript`/`Tsx`/`JavaScript`; everything else returns `null` and is
  silently skipped. `parseSymbols`/`parseReferences`/`parseImports` are
  built entirely on JS/TS grammar node kinds (`function_declaration`,
  `class_declaration`, `jsx_opening_element`, `import_statement`, ...) plus
  a hardcoded JS `KEYWORDS` set.
- `server/src/adapters/codeindex/extract.ts` — the regex fallback
  extractor, explicitly documented as "for TS/JS"; patterns match
  `function`/`class`/`interface`/`enum` keywords verbatim.
- `server/src/adapters/depgraph/index.ts` — the import graph is built via
  `dependency-cruiser`, which looks for `tsconfig.json` and resolves
  modules using Node/npm rules. There is no equivalent for Go.
- `server/src/db/seed-prompts.ts:12-13,191` and
  `docs/agent-prompts/general-reviewer.md` / `performance-reviewer.md` — the
  seeded system prompts literally open with "You are reviewing a
  pull-request diff for a **Node.js (TypeScript, ESM) service**". This is
  live prompt content sent to the LLM, not just docs.
  `docs/agent-prompts/security-reviewer.md` is already language-neutral —
  a ready template for how the others should read.
- No DB table (`repos`, `repo-intel.ts` schema) has a `language` column —
  it only exists implicitly via `SUPPORTED_EXT`.

**Verified constraint:** `@ast-grep/napi@0.43.0` (already a dependency)
ships a built-in `Lang` enum of only `Html | JavaScript | Tsx | Css |
TypeScript` — Go isn't included out of the box. ast-grep's core (Rust/CLI)
does support Go, and the napi package exposes `registerDynamicLanguage()`
for loading other tree-sitter grammars via separate `@ast-grep/lang-*`
packages (see the `ast-grep/langs` repo). Whether a prebuilt
`@ast-grep/lang-go` exists needs to be checked at implementation time; if
not, an alternative (compile the grammar ourselves, or ship regex-only
support for v1) is needed.

## Polyglot repos (e.g. TypeScript + Go in the same repo)

The Phase 0 registry is already per-file (dispatched by extension), not
per-repo, so mixed-language repos work by construction at the
walk/parse/symbol layer: each file is handled by whichever language pack
matches its extension, and files with no matching pack are silently
skipped — exactly like today's behavior for extensions outside
`SUPPORTED_EXT`. Three places still need an explicit polyglot-aware design,
called out in their phases below:

- **Phase 3 (import graph)** — no single depgraph builder; dispatch
  per-language and union the results.
- **Phase 4 (system prompts)** — frame the review by the languages actually
  touched in *this* diff, not by a single repo-wide stack label.
- **Phase 5 (language detection)** — store a set, not a scalar.

## Plan (phased, Go as the first language pack)

### Phase 0 — make "language" an explicit concept
Replace the three independent allowlists (`repo-intel/constants.ts`,
`ripgrep.ts`, `astgrep langForFile`) with one registry, e.g.
`server/src/modules/repo-intel/languages/`:

```
{ id: 'go', extensions: ['.go'], astGrepLang: 'go' (dynamic) }
{ id: 'ts', extensions: ['.ts','.tsx','.js','.jsx','.mjs','.cjs'], astGrepLang: Lang.TypeScript/Tsx/JavaScript }
```

This removes the "added Go to one allowlist, forgot the other two" risk —
which is exactly the current state for TS/JS (3 copies of the same list).

### Phase 1 — generalize `astgrep/index.ts` instead of forking it for Go
Rather than a parallel ~600-line Go-specific file, extract a per-language
"node-kind mapping" config (which grammar node name means
function/class/interface/call/import in this language) and make
`parseSymbols`/`parseReferences`/`parseImports` read from that config. Tree
walking, dedup, and signature trimming (`headSignature`) stay shared.
Go-specific mapping needed: `function_declaration`/`method_declaration`
(receiver), `type_declaration` → `struct_type`/`interface_type`,
`call_expression` with `selector_expression` (Go's analogue of
`member_expression`), no `new_expression` (Go's `new(T)` is a plain call),
imports via `import_spec` inside an `import (...)` block.

### Phase 2 — regex fallback for Go
Mirror `codeindex/extract.ts` for Go, so indexing degrades gracefully (same
"never throw, degrade to partial" principle already used for TS/JS) if the
ast-grep dynamic-language load fails on a given platform.

### Phase 3 — import graph without dependency-cruiser
The riskiest part: no off-the-shelf npm tool resolves Go imports. Realistic
v1: parse `import (...)` blocks (already produced by Phase 1/2), read the
module path from `go.mod`, map each imported package path to a local
directory in the repo, and build file-edges the same way as today
(`fileEdges.fromFile/toFile`). Nuance: Go resolves at the **package**
(directory) level, not the file level — needs an explicit decision on
whether an edge points at "any file in that package" or whether the schema
should aggregate at directory granularity.

**Polyglot repos:** `DepGraph` stops being one implementation
(`DepCruiseGraph`) and becomes a per-language dispatch — each builder
(`dependency-cruiser` for TS/JS, the new resolver for Go) runs scoped to
only the files of its own language, and the container's `depgraph` port
unions the edge lists. Cross-language edges (Go importing a `.ts` file)
aren't a real case to support — the two subgraphs stay disjoint, which
PageRank handles fine as separate components with no special-casing needed
in `rank.ts`.

### Phase 4 — de-hardcode the system prompts
Remove the fixed "Node.js (TypeScript, ESM)" framing from
`seed-prompts.ts` and `docs/agent-prompts/{general,performance}-reviewer.md`
— rewrite neutrally (following the already-neutral
`security-reviewer.md`).

**Polyglot repos:** don't substitute a single repo-wide stack label at
prompt-assembly time — a repo-level `languages[]` (Phase 5) would wrongly
frame a Go-only PR in a TS+Go repo as a "Node.js service" review. Instead,
derive the stack framing from the languages of the files actually **in
this diff** (same per-file extension lookup as Phase 0), computed at
review-run time, not index time. A PR touching only `.go` files gets Go
framing; a PR touching both `.ts` and `.go` files mentions both stacks (or
falls back to the neutral framing when the mix is wide).

### Phase 5 — repo language detection
At clone/index time, detect the repo's languages via marker files (`go.mod`,
`package.json`/`tsconfig.json`), and persist the result as
`languages: string[]` — **a set, not a scalar** — on a new column on `repos`
or `repo_index_state`. A repo can legitimately have both markers present at
once (e.g. this very repo: `client/` is TS, a Go service could sit
alongside it); the field exists for informational use (badge, filtering),
never as a gate that picks one indexing path over another — indexing
already runs per-file per Phase 0.

### Phase 6 — tests
Go fixtures under `server/test` (a small `go.mod` repo), unit tests for the
Go `parseSymbols`/`parseReferences`/`parseImports` config, and an
integration test that indexes a Go repo end-to-end.

## Out of scope
`reviewer-core/` and `client/` need zero changes — both are already
language-agnostic.

## Implementation notes — Phase 0+1+2 (this iteration)

**Status: Phase 0+1+2 done and merged** (fork PR #3, branch
`docs/go-language-support-plan`) — registry, real Go AST parsing via
`@ast-grep/lang-go`, regex fallback, and test coverage (unit:
`astgrep-go.test.ts`/`extract-go.test.ts`/`languages.test.ts`; integration:
`repo-intel-go.it.test.ts` indexes a real Go fixture end-to-end against
Postgres). **Phase 3 (import graph) done.** **Phase 4 (de-hardcode system prompts)
done.** **Phase 5 (repo language detection) done.** All 6 phases are now
complete — Phase 6 (tests) was covered incrementally alongside each phase
rather than as a separate final pass; see each phase's own "Tests:" note
above. **Phase 6 audit (post-completion): one real gap found and fixed —
see "Implementation notes — Phase 6 audit" below.**

Verified against the actual codebase and the real `@ast-grep/lang-go`
package before implementing (not trusted from the analysis above as-is):

- `@ast-grep/lang-go@0.0.6` exists on npm — the "needs to be checked"
  risk flagged above is resolved. Its `index.js` already exports the exact
  `{ libraryPath (getter), extensions, languageSymbol, expandoChar }` shape
  `registerDynamicLanguage()` expects and resolves the platform prebuilt
  binary itself — no manual native-path resolution needed on our side.
- Real tree-sitter-Go field names, read from the package's own
  `node-types.json`: `call_expression{function}`,
  `selector_expression{operand,field}`,
  `method_declaration{name,receiver,body,parameters,result}`,
  `type_declaration` → `type_spec{name,type}`, `import_declaration` →
  `import_spec{name?,path}` (possibly nested in `import_spec_list`),
  `pointer_type` wraps a bare `_type` child. Go's grammar reuses the
  `identifier`/`type_identifier` leaf-kind names TS/JS already uses.
- Two gaps in the "triple-duplicated" framing above, corrected: `astgrep/
  index.ts` is a **4th** consumer of `SUPPORTED_EXT` beyond the three named
  (`walk.ts`/`service.ts`/`incremental.ts`); it also has a **4th** function
  with the same hardcoded-node-kind structure as `parseSymbols`/
  `parseReferences`/`parseImports` — `parseInvocationHeads()` (the
  phantom-gate's call-head extractor) — needing the same per-language
  treatment.
- Real gap in the fallback wiring: `codeindex/ripgrep.ts`'s `symbols()`/
  `references()` call the TS/JS regex extractor **unconditionally** for any
  file passing the extension gate (today that gate only ever admits TS/JS).
  Once the gate also admits `.go`, this call site needs explicit language
  dispatch or Go files silently run through TS/JS regexes.

**Design decision — per-language modules, not one generic node-kind config
object** (this iteration deviates from the sketch above): TS/JS and Go
differ structurally, not just in kind-name spelling — TS/JS tracks
"exported" via an `export` keyword node; Go's exported-ness is a naming
convention (`/^[A-Z]/`), not an AST fact at all. TS/JS member access is
`member_expression{object,property}`; Go's is
`selector_expression{operand,field}` — different field names, not
substitutable via a lookup table. A single generic walker parameterized by
kind-name mapping would need to grow into most of a second interpreter to
cover this. Instead: extract the genuinely language-agnostic tree helpers
(`headSignature`, `lineOf`, `endLineOf`, `childrenOfKind`, `getField`,
`dedupe` — none of these reference a TS/JS-specific kind name today) into
`astgrep/shared.ts`, then give TS/JS and Go their own concrete
`parseSymbols`/`parseReferences`/`parseInvocationHeads`/`parseImports`
implementations (`astgrep/langs/typescript.ts`, `astgrep/langs/go.ts`)
built on those shared primitives. `astgrep/index.ts` stays a thin
dispatcher — the public API and every existing caller are unchanged.

Full implementation-level plan (files, signatures, exact Go AST shapes)
lives in the plan-mode session that scoped this iteration; see git history
for the corresponding commits.

## Implementation notes — Phase 3 (import graph)

**Status: done.** `DepCruiseGraph` (TS/JS) is untouched; a new
`GoDepGraph` (`server/src/adapters/depgraph/go.ts`) handles Go, and both
are composed by a new `UnionDepGraph`
(`server/src/adapters/depgraph/union.ts`) that the container now binds
instead of `DepCruiseGraph` directly
(`server/src/platform/container.ts:123`) — the port interface and both
existing call sites (`pipeline/full.ts:216`, `pipeline/incremental.ts:219`)
are unchanged, since they already pass the full multi-language file list
and let the adapter filter internally (the same pattern `DepCruiseGraph`
already used for TS/JS).

`GoDepGraph.buildEdges`:
- Filters `files` to `.go` files via `languageIdForFile`. Returns `[]`
  immediately if there are none — no `go.mod` read attempted.
- Reads `go.mod` from `root` and extracts the `module <path>` directive via
  a line-anchored regex. No `go.mod` (or no `module` line) → `[]` for the
  whole build, since there's no way to tell a local import from a
  third-party one without it. This is a real v1 limitation, not a bug: a
  Go file tree with no `go.mod` at the repo root (e.g. `go.mod` in a
  subdirectory of a monorepo) produces zero edges.
- For each Go file, parses its imports via the existing
  `astgrep/index.ts` `parseImports` dispatcher (already built in Phase 1) —
  no new parsing code needed, Phase 3 is a pure downstream consumer of
  Phase 1's output.
- **Resolved the plan's "file vs. directory granularity" question**:
  edges point at *every* already-walked Go file in the imported package's
  directory, not one representative file. A single `import` statement
  pulls in the whole target package, so under-connecting (picking one
  file) would make PageRank undercount a package's real fan-in.
- Non-local imports (stdlib, third-party module paths) are silently
  skipped — mirrors `DepCruiseGraph`'s existing "local files only"
  contract for TS/JS.

**Polyglot union**: `UnionDepGraph` takes an array of `DepGraph`
(defaulting to `[DepCruiseGraph, GoDepGraph]`), runs them in parallel over
the same `(root, files)`, and concatenates results — no cross-language
edges are possible since each builder only ever emits edges between files
of its own language. `rank.ts` needed zero changes: it already treats
`file_edges` as an opaque edge list and lets `graphology`/PageRank handle
disconnected components.

Tests: `server/test/depgraph-go.test.ts` (hermetic, on-disk fixture) covers
local-package edge fan-out, stdlib-import exclusion, self-edge exclusion,
no-Go-files, and missing-`go.mod` cases, plus `UnionDepGraph`'s
concatenation behavior. `server/test/repo-intel-go.it.test.ts` was
extended with a second local package (`internal/util`) imported by
`main.go`, asserting the resulting `file_edges` row lands in Postgres via
the real `runFullIndex` pipeline.

## Implementation notes — Phase 4 (de-hardcode system prompts)

**Status: done.** Two changes, matching the two things that were actually
wrong: a static prompt that named the wrong stack, and no mechanism at all
for per-diff stack framing.

**Static prompt rewrite** — `GENERAL_REVIEWER_PROMPT` and
`PERFORMANCE_REVIEWER_PROMPT` (`server/src/db/seed-prompts.ts`, mirrored in
`docs/agent-prompts/{general,performance}-reviewer.md`) opened with "You
are ... reviewing a pull-request diff for a Node.js (TypeScript, ESM)
service" and a "# Stack context (assume this unless the diff shows
otherwise)" block naming DevDigest's own dependencies (Fastify, Drizzle,
postgres-js, octokit, simple-git, ripgrep, p-queue) as if they were a fact
about *any* reviewed repo — including one specific, concrete error: "With
max ~10 connections this stalls the whole service" is DevDigest's own pool
size, asserted as true of the target repo being reviewed. Rewrote both to
match `SECURITY_REVIEWER_PROMPT`'s already-neutral style: a stack-agnostic
role sentence + a "# Stack context" instruction to infer the stack from the
diff itself rather than assume one. `PERFORMANCE_REVIEWER_PROMPT`'s
checklist section headers/bullets (`## 1. Database (Drizzle / postgres-js /
Postgres)`, `## 4. Event loop & memory (Node)`) were similarly genericized
to name patterns (N+1 queries, connection-pool starvation, event-loop/
goroutine blocking) rather than DevDigest's specific libraries, keeping
concrete technology names only as illustrative examples. Verified the
`.ts`/`.md` mirrors are still byte-identical (was already true pre-change,
confirmed no test pins the exact prompt text — see the plan-mode research
for this iteration).

**Per-diff dynamic framing** — the static rewrite alone leaves the model
with *no* stack information at all, which is worse than a wrong guess for
a monolingual repo. `reviewer-core` intentionally has no `language`
concept anywhere in its types (confirmed: `ReviewInput`/`PromptParts` have
no such field) and its system message is exactly `agent.systemPrompt +
INJECTION_GUARD` with no templating hook — so per-run framing has to be
assembled server-side, before the `reviewPullRequest()` call, as plain
text folded into the `systemPrompt` string itself rather than a new
reviewer-core field (keeps Phase 4 change local to `server/`, matches this
doc's "Out of scope: reviewer-core needs zero changes"). New pure
`buildStackFraming(changedFiles)` (`server/src/modules/reviews/helpers.ts`,
alongside the existing pure `taskLine` helper — kept a standalone exported
function rather than a private class method specifically so it's directly
unit-testable without constructing a `ReviewRunExecutor`) maps every
`diff.files[].path` through `languageIdForFile` (already built in Phase 0),
dedupes into a set of touched language ids, and renders a `# Languages in
this diff` line (capped at 3 languages before falling back to a generic
"multiple languages" phrase). `ReviewRunExecutor.runOneAgent`
(`server/src/modules/reviews/run-executor.ts`) calls it and appends the
result to `agent.systemPrompt` before the `reviewPullRequest()` call.
Computed **per run, from the diff actually being reviewed** — not a
repo-wide label — so a Go-only PR in a mixed TS+Go repo gets Go framing
and a mixed PR gets both, per this doc's original polyglot note for this
phase. `LanguageDef` gained a `label` field
(`server/src/modules/repo-intel/languages/index.ts`) as the single source
of truth for the human-readable name used in this framing line, plus a
`labelForLanguageId()` lookup, rather than a second labels map duplicated
in `helpers.ts`.

Tests: `server/test/stack-framing.test.ts` (new, hermetic) covers TS-only,
Go-only, mixed TS+Go, and no-recognized-language (undefined). The >3-
languages generic-fallback branch is unreachable with only 2 languages
currently registered — left uncovered rather than tested via a contrived
mock, and worth revisiting once a 3rd+ language pack exists.

## Implementation notes — Phase 5 (repo language detection)

**Status: done.** One deliberate deviation from the plan sketch above, and
one genuinely new column.

**Marker files → derived from the indexed file set.** The plan originally
suggested detecting languages via `go.mod`/`package.json`/`tsconfig.json`
marker files. Implemented differently: `languagesPresent(files)`
(`server/src/modules/repo-intel/languages/index.ts`) derives the set from
`languageIdForFile` over the *actual walked/indexed file list* instead —
`walk.files` in `runFullIndex`, `allFiles` in `runIncremental` (both
already computed for other T3 steps, so this is free). Reasoning: a marker
file answers "what does this repo claim to contain" (a `go.mod` can exist
with zero `.go` files actually indexed, e.g. an empty scaffold or a
walk that skipped everything as oversized) while the indexed-file-derived
set answers "what did we actually index" — strictly more accurate for the
stated purpose (informational badge/filtering), and needs no new
marker-file-parsing code since Phase 0's registry already does the
per-file lookup.

**Schema**: `repo_index_state.languages` — a `jsonb` column typed
`string[]`, defaulting to an empty JSON array
(`server/src/db/schema/repo-intel.ts`), following the existing
`prIntent.inScope`/`outOfScope` precedent (`server/src/db/schema/reviews.ts:55-56`)
rather than a native Postgres array column — no array-column precedent
exists anywhere else in this schema. Migration
`0011_high_zeigeist.sql` (auto-numbered by `drizzle-kit generate`), applied
via `pnpm db:migrate`.

**Write paths**: `IndexStateUpsert.languages` (`server/src/modules/repo-intel/repository.ts`)
threads through `upsertIndexState()`'s insert + `onConflictDoUpdate`.
`runFullIndex` computes it once from `walk.files` right before the final
upsert; the two `safePersist()` early-exit paths (no clone / no files)
always write `[]` since neither has a real walked set. `runIncremental` is
the subtler case: its only full walk (`allFiles`) happens inside a
try/catch around the T3 graph rebuild
(`server/src/modules/repo-intel/pipeline/incremental.ts`), so a transient
failure there must NOT blank out a previously-known-good `languages` set —
`allFiles` is hoisted above the `try` (stays `[]` on failure) and the
final upsert uses `languagesPresent(allFiles)` when the walk succeeded, or
falls back to the prior `state.languages` (already in scope from the
earlier `tryGetIndexState` call) otherwise.

**Read path**: `IndexState` (`server/src/modules/repo-intel/types.ts`)
gained a required `languages: string[]` field, projected in
`tryGetIndexState()`. Confirmed via `pnpm typecheck` (`src/**/*.ts` only —
`server/test/**` is NOT type-checked by this repo's `tsconfig.json`
`include`, so the compiler didn't catch 3 test fixtures that constructed
`IndexState`/`IndexStateUpsert`-shaped literals without the new field;
found and fixed by re-running the full test suite and cross-checking
against the plan-mode research instead) — updated
`repo-intel-resync.test.ts`'s `stateAt()`, `indexer-pipeline.test.ts`'s
`makeInitialState()` and its in-memory repository stub's `upsertIndexState`
(which was silently dropping `languages` before this fix), plus
`service.ts`'s synthesized degraded-state stub (`getIndexState`'s no-row
fallback).

**No consumer yet** — confirmed via the plan-mode research that nothing
reads `languages` downstream today (not in `service.ts`, not in any route,
not in the client's `PrMeta`/repo contracts). Purely informational/future-
use, exactly as the plan text states — the client's `RepoIntelState` hook
(`client/src/lib/hooks/repo-intel.ts`) is the closest existing "badge"
surface but is itself currently unwired to any component, so wiring
`languages` into it wouldn't yet produce a visible UI change without also
building that UI — out of scope here.

Tests: `server/test/languages.test.ts` gained `languagesPresent`/
`labelForLanguageId` unit coverage (dedup, sort, exclude-unrecognized,
empty-input). `server/test/indexer-pipeline.test.ts` asserts
`languages: ['typescript']` after a full index and after an incremental
slice (the latter proving the T3-walk-recompute path, not just the
initial-state passthrough). `server/test/repo-intel-go.it.test.ts` asserts
`languages: ['go']` against a real Postgres row after `runFullIndex` on
the Go fixture.

## Implementation notes — Phase 6 audit (post-completion)

Requested explicitly ("чи все ми виконали для фази 6?") after all 6 phases
were marked done. Re-read the original Phase 6 scope literally — "unit
tests for the Go `parseSymbols`/`parseReferences`/`parseImports` config"
— and noticed it never named `parseInvocationHeads`, the 4th astgrep
function (the phantom-API gate's call-head extractor, already flagged as
an easy-to-miss 4th function back in the Phase 0+1+2 notes above). Checked
whether it had any test coverage at all, for either language.

**Finding: it had none — and that gap was hiding a real bug.**
`server/src/modules/repo-intel/service.ts`'s `getUnresolvedReferences`
(the phantom-API gate) calls `parseInvocationHeads` and filters out
anything in a hardcoded `PHANTOM_GLOBALS_ALLOWLIST` — a pure JS/TS list
(`console`, `Math`, `Buffer`, `fetch`, ...). This allowlist lives in
`service.ts`, one layer above the astgrep dispatcher that Phase 1's
per-language-module refactor covered — so extending `parseInvocationHeads`
to Go in Phase 1 correctly returned bare Go call heads, but nothing
updated this consumer to know Go builtins exist. Verified empirically
(not just by reading the code) with a throwaway script: parsing
`s := make([]int, 0); s = append(s, 1); n := len(s)` returned `make`,
`append`, and `len` as invocation heads, none matched by the TS-only
allowlist — meaning **every ordinary Go file would have `len`/`make`/
`append`/etc. flagged as phantom APIs** in the phantom-gate feature. No
test caught this because `getUnresolvedReferences` itself only had
degraded-contract tests (flag-off, no-clone) — never a single positive-path
test with real source, for either language.

**Fix**: split the allowlist by language
(`TS_PHANTOM_GLOBALS`/`GO_PHANTOM_GLOBALS`/`PHANTOM_GLOBALS_BY_LANGUAGE`,
keyed by `languageIdForFile`), and added Go's predeclared identifiers —
both builtin functions (`len`, `make`, `append`, `panic`, `recover`, ...)
and builtin types used in conversion-call syntax (`string(b)`, `int32(x)`,
...), which are syntactically indistinguishable from a bare call in Go's
grammar and would otherwise ALSO false-positive.

**New test**: `server/test/repo-intel-phantom-gate.test.ts` — the first
positive-path coverage `getUnresolvedReferences` has ever had, for both
languages: confirms a genuinely undeclared/unimported bare call is still
flagged (TS and Go), confirms JS globals / Go builtins / locally-declared
functions are NOT flagged. Verified this test actually catches the bug by
reverting the `service.ts` fix and re-running it before committing — it
failed exactly as expected (`make`/`append`/`len` present in the result).

**Lower-severity, not fixed**: `extractEndpoints`/`extractCrons`
(`adapters/codeindex/extract.ts`) also run unconditionally on every
indexed file, including Go, via `pipeline/full.ts`/`incremental.ts`/
`service.ts`. Their regexes are narrow (`app.get(`-style HTTP verb calls,
`cron.schedule(`-style expressions) and unlikely to match ordinary Go
syntax, but not provably safe the way the phantom-gate bug was provably
unsafe — left as an open question rather than a speculative fix with no
observed false positive to verify against.

**Generalizable lesson, folded into the `add-language-support` skill**: a
per-language-module refactor at one layer (the astgrep adapter) does not
guarantee every *consumer* of that layer's output was updated in lockstep
— a facade sitting above the dispatch (like this allowlist) is exactly the
kind of cross-cutting piece a phase-by-phase, file-by-file plan can miss,
because it isn't "a new language file," it's an existing file whose
implicit language assumption only breaks once a second language actually
exercises it.

## Phase 7 — Conventions Extractor: multi-language support (planned)

**Status: not started.** Prompted by the observation that the Conventions
Extractor (`server/src/modules/conventions/`, shipped by
[conventions-extractor-plan.md](conventions-extractor-plan.md) after Phase
0-6 above were already done) surfaces conventions only from JavaScript/
TypeScript files, even on repos where Go support is fully indexed. This is
exactly the "a consumer built above the dispatch layer doesn't
automatically inherit language support" lesson from the Phase 6 audit
above, playing out a second time in a different module.

### Root cause (verified against the actual code, not assumed)

The Conventions module was built without threading through the language
registry (`server/src/modules/repo-intel/languages/index.ts`) that Phase 0
above already established as "the single source of truth" for what
languages this codebase indexes. It re-invented a private, JS/TS-only
allowlist instead — the exact mistake Phase 0's own doc-comment warns
about ("Replaces what used to be three independently maintained copies of
the same allowlist... the risk this closes"), just in a module that didn't
exist yet when that warning was written.

Two independent gaps, of very different severity:

1. **The deterministic config-derived pool (`origin: 'config'`,
   Decision 10 in the original plan) is 100% JS/TS-tooling-specific, with
   zero Go equivalent.** `CONFIG_FILE_CANDIDATES`
   (`server/src/modules/conventions/constants.ts:12-24`) lists only
   `tsconfig.json`/`.eslintrc*`/`prettier*` filenames; `parseConfigFile`
   (`helpers.ts:370-382`) dispatches only to
   `parseTsconfigStrictness`/`parseEslintRules`/`parsePrettierConfig`. For
   a Go repo, none of these files exist, so this pool — the
   highest-quality one: no model call, can't hallucinate, always lands as
   `status: 'accepted'`, `confidence: 1.0` — produces exactly **zero**
   candidates, every scan, unconditionally. Since this pool is also the
   *fastest to appear* on a first scan (no LLM round-trip), it's plausibly
   why the Extractor "looks" JS-only even before considering the model
   pool at all.
2. **The model-driven pool (`origin: 'model'`) is mechanically
   language-agnostic already, but has three real gaps, not one:**
   - `getConventionSamples`/`getTopFilesByRank`
     (`server/src/modules/repo-intel/service.ts:665-698`) samples the
     top-N files by PageRank with no per-language quota. `computeFileRank`
     (`pipeline/rank.ts:25-70`) does give every indexed file — including
     isolated Go files with no import edges — a rank row (PageRank's
     uniform floor), so Go files aren't *excluded*, but in a **mixed**
     TS+Go repo they can still be crowded out of the top
     `SAMPLE_FILE_COUNT = 12` (`constants.ts:9`) if TS/JS files are
     structurally more central. This is the same class of problem the
     original plan already flagged generically ("Product improvement idea
     3: stratified sampling... can starve whole categories") — that idea
     predates `repo_index_state.languages` (Phase 5 above) and was never
     extended to *language* as a stratification axis.
   - The extraction prompt itself (`service.ts`'s `proposeRawCandidates`,
     `service.ts:156-189`) is already language-neutral text — no JS-specific
     wording — so in a **Go-only** repo this pool should, in principle,
     already surface Go conventions from raw `.go` file content handed to
     the model. **This is unverified, not confirmed broken**: unlike the
     indexer (`astgrep-go.test.ts`, `repo-intel-go.it.test.ts`,
     `repo-intel-phantom-gate.test.ts`), the conventions module has zero
     test coverage against any Go fixture — `conventions.test.ts`/
     `conventions.it.test.ts` only exercise TS/JS content. Given the Phase
     6 audit above found a real bug hiding behind exactly this kind of
     untested assumption (the phantom-globals allowlist), this needs an
     empirical check, not a guess, before deciding whether Phase 7.3 below
     is "add a test" or "add a test and fix a bug."
   - `JUNK_PATH_PATTERNS` (`repo-intel/service.ts:755-770`), which filters
     sample candidates, encodes JS/TS test-file conventions only
     (`'.test.'`, `'vitest.'`, `'jest.'`) — Go's `_test.go` suffix doesn't
     match any of those substrings, so Go test files are **not** excluded
     from convention sampling today, unlike TS/JS test files. Needs an
     empirical check against a real Go repo's ranked paths (does this
     actually happen, and does it produce bad candidates) before deciding
     how to fix it.
3. **Structural: there is nowhere to record which language a candidate
   came from, even once 1-2 are fixed.** Neither `ConventionCandidate`
   (contracts) nor the `conventions` table
   (`server/src/db/schema/knowledge.ts:31-50`) has a `language` column —
   unlike `repo_index_state.languages` (Phase 5 above), which exists for
   exactly this kind of informational/filtering use. Without it: the UI
   can't badge or filter by language, and the quality plan's
   ([conventions-extractor-quality-plan.md](conventions-extractor-quality-plan.md))
   Phase 1 accept-rate mining can't break results down by language the way
   it already does by `origin`×`category`.

### Sub-phases

**7.1 — Reuse the Phase 0 language registry instead of a private
allowlist.** Introduce a per-language "convention pack" — same shape as
Phase 1's `astgrep/langs/{typescript,go}.ts` split — e.g.
`server/src/modules/conventions/langs/{typescript,go}.ts`, each exporting
`configFileCandidates: readonly string[]` + `parseConfigFile(path,
content): ConfigCandidateDraft[]`. A new `conventions/langs/index.ts`
assembles the flat probe list from all registered packs and dispatches
`parseConfigFile` by filename, keyed off the same
`server/src/modules/repo-intel/languages/index.ts` registry Phase 0
built — not a second, independently-grown list. `service.ts`'s `extract()`
(`service.ts:75-98`) loops the assembled list instead of the current flat
`CONFIG_FILE_CANDIDATES` constant.

**7.2 — Go config-derived candidate pool**, parallel to TS's
eslint/tsconfig/prettier trio:
- `go.mod` — module path + the `go 1.x` directive (language-version
  assumption, analogous to a `tsconfig.json` strictness flag). Reuse the
  line-anchored `module <path>` regex reader `GoDepGraph.buildEdges`
  already has (`server/src/adapters/depgraph/go.ts:83` area) rather than
  writing a second `go.mod` parser.
- `.golangci.yml`/`.golangci.yaml`/`.golangci.toml` — enabled linters
  under golangci-lint's config → one candidate per enabled linter,
  analogous to an enforced ESLint rule. Needs a category map
  (`GOLANGCI_LINT_CATEGORY_MAP`, mirroring `ESLINT_RULE_CATEGORY_MAP` at
  `constants.ts:31-44`): `errcheck`→`error-handling`, `gosec`→`security`,
  `revive`/`stylecheck`→`naming`, `depguard`→`imports`, unmapped →
  `formatting`, same "unmapped falls back to formatting" rule as today.
- **gofmt is a real edge case, not a straightforward port**: Go formatting
  is not configurable the way Prettier is — `gofmt`-compliance is a fixed
  house convention with **no config file to point evidence at**, which
  breaks Decision 10's invariant that a config-origin candidate's
  "evidence" *is* the config file it was parsed from. Needs an explicit
  decision (Open Questions below) before building — this doc doesn't
  presume gofmt should auto-emit a candidate at all.
- **New dependency needed for YAML**: confirmed via `grep` that no
  `yaml`/`js-yaml` package is imported anywhere in `server/src` today (the
  repo-wide "never require()/eval() a config" rule from Decision 4 in
  `docs/skills-feature-plan.md` doesn't forbid a real YAML *parser* — it
  forbids executing JS as code — but this is still a new dependency,
  flagged for the same scrutiny Decision 10 gave the JSON/regex-only
  approach for JS configs). Alternative: a minimal regex-based
  `key: value` line extractor (same spirit as `parseSimpleKeyValueBlock`,
  `helpers.ts:319-332`) if golangci-lint's config shape is simple enough
  to avoid a real YAML parser — worth checking against a few real
  `.golangci.yml` files before picking.

**7.3 — Stratify the model pool's sampling by language, and add the first
Go test.** Extend `getTopFilesByRank`/add a `getConventionSamplesStratified`
variant (`repo-intel/service.ts`) that reserves sample slots per language
present in `repo_index_state.languages` (read via the already-existing
`getIndexState(repoId)`, `service.ts:218`) before falling back to global
top-rank fill — concretely scoping the original plan's "Product
improvement idea 3" to a language axis using infrastructure (Phase 5's
`languages` column) that didn't exist when that idea was first written.
Then add `server/test/conventions-go.it.test.ts` (mirroring
`repo-intel-go.it.test.ts`'s fixture pattern): run `ConventionsService.
extract()` against a real Go fixture repo and assert `origin: 'model'`
candidates are actually produced from `.go` sample content — the first
test coverage this path has ever had for a non-TS/JS language, needed to
confirm the "should already work" claim above rather than assume it.

**7.4 — Thread `language` through the data model, UI, and the quality
report.** Add `language: string | null` to the `ConventionCandidate`
contract (both vendor copies) and a matching `conventions.language`
column, derived in code from `evidence_path` via the existing
`languageIdForFile()` (`repo-intel/languages/index.ts:39`) at insert time
for *both* pools — never asked of the model, same "don't trust the model
for anything code can derive" principle as Decision 1's line-number
computation. `ConventionCandidateCard` gets a language badge next to the
existing origin badge; the conventions list gets a language filter
alongside the existing status/category filters
(`GET /repos/:id/conventions` gains a `language` query param, mirroring
the existing `status`/`category` filter shape in `repository.ts`'s
`list()`). The quality plan's Phase 1 accept-rate report
([conventions-extractor-quality-plan.md](conventions-extractor-quality-plan.md))
gets a `language` breakdown dimension alongside its existing `origin`×
`category` one.

**7.5 — Close the `_test.go` junk-path gap, and document the pack contract
for the next language.** Once 7.3's empirical check confirms whether Go
test files are actually leaking into samples as false "house style"
evidence, fix `isJunkPath`/`JUNK_PATH_PATTERNS`
(`repo-intel/service.ts:755-775`) — either add a `_test.go`-aware pattern,
or (more correct, and more scalable per the "any future language" part of
this ask) delegate "is this a test file" to a per-language predicate
alongside the Phase 0 registry, since junk-path detection is itself
currently only ever validated against JS/TS conventions. **The
`add-language-support` skill update is explicitly deferred to after this
phase ships** — same sequencing this doc's own header used ("distilled
into that skill" only after the Go implementation was real and audited),
not before: once 7.1-7.4 land and are audited the way Phase 6 above
audited the astgrep work, fold the "every consumer of the language
registry needs an explicit per-language pack, not just the indexer" lesson
into that skill so a 3rd language (Rust, Python, ...) gets the Conventions
pack for free instead of rediscovering this gap a third time.

### Open questions

- **gofmt's fileless "convention"** — skip it entirely for v1 (Go's
  formatting rule is arguably out of scope for a *house*-convention
  extractor, since it's a language-wide standard, not something this repo
  chose), or introduce a new `origin: 'convention'` (distinct from
  `'model'`/`'config'`) for language-inherent rules with no backing file,
  pointing evidence at `go.mod` as a proxy anchor? Not decided — affects
  the `ConventionOrigin` enum (a schema change) if the second option is
  picked.
- **YAML parsing** — pull in a real `yaml`/`js-yaml` dependency, or hand-roll
  a minimal regex extractor for golangci-lint's specific config shape (no
  new dependency, consistent with this module's existing "regex over
  flat JS/MJS configs" approach for the same reason)? Needs a look at a
  few real `.golangci.yml` files' structure before deciding.
- **Stratified sampling's slot math** — how many of the 12 samples get
  reserved per language vs. left for global top-rank fill, and what
  happens with 3+ languages present at once (even split, or weighted by
  each language's share of indexed files)? Not decided.
- **Backfill** — existing `conventions` rows (from repos already scanned
  under the old JS-only code) will have `language: null` after 7.4's
  migration; is a one-time backfill pass (derive `language` from
  `evidence_path` for existing rows) worth writing, or is it fine to leave
  historical rows unbadged and only badge new scans going forward? Given
  the table is per-workspace and Re-scan already exists as a user-
  triggered action, leaning toward "leave historical rows as-is," but
  flagging since it wasn't a deliberate call yet.

### Testing plan (additive to the existing suite)

- `server/test/conventions.test.ts` — new fixture-based unit tests for
  `parseGoModDirectives`/`parseGolangciLint` (fixture `go.mod`/
  `.golangci.yml` in, expected `origin: 'config'` candidates with correct
  category/line numbers out), mirroring the existing
  `parseTsconfigStrictness`/`parseEslintRules`/`parsePrettierConfig`
  coverage.
- `server/test/conventions-go.it.test.ts` (new, Phase 7.3) — real Go
  fixture through `extract()`, asserting both pools produce Go candidates
  where expected.
- `server/test/conventions.test.ts` — stratified-sampling unit test (mixed
  language file/rank fixture in, assert both languages represented in the
  output sample list).
- `client` — `ConventionCandidateCard.test.tsx` gains a language-badge
  assertion; conventions page test gains a language-filter case.

### Suggested build order

1. 7.1 (registry plumbing — no behavior change yet, `parseConfigFile`
   dispatch becomes pack-based but TS/JS packs are ported 1:1 first, so
   existing tests keep passing unmodified as a correctness check on the
   refactor itself).
2. 7.3's empirical checks (Go-sample-already-works? test-file-leak?) —
   cheap to run, and their answers change the scope of 7.2/7.5.
3. 7.2 (Go config pool) + its unit tests.
4. 7.3's stratified sampling + its it.test.
5. 7.4 (language column + UI + quality report) — last, since it's additive
   and doesn't block 7.1-7.3 from being independently useful.
6. 7.5 (junk-path fix, once its empirical check from step 2 is in) +
   fold lessons into `add-language-support`.

## Implementation notes — Phase 7.1 + 7.3's empirical checks (this iteration)

**Status: 7.1 done. 7.3's empirical checks done — both open questions
resolved with real answers, not assumptions.**

**7.1** landed as planned: `server/src/modules/conventions/langs/{types,shared,typescript}.ts`
+ a thin `langs/index.ts` dispatcher, `constants.ts`/`helpers.ts` reduced to
genuinely language-agnostic content, `service.ts` calls
`allConfigFileCandidates()`/`parseConfigFile()` from the new module. Zero
behavior change, confirmed by the full 259-test unit suite passing with only
`conventions.test.ts`'s import paths touched.

**7.3's empirical checks** — new `server/test/conventions-go.it.test.ts`,
using a REAL (non-`FakeRepoIntel`) `repoIntel` for the first time in this
module's test suite, run against a real Go fixture indexed via
`runFullIndex` (same fixture-generation pattern as
`repo-intel-go.it.test.ts`). This mattered because `conventions.it.test.ts`'s
existing `FakeRepoIntel.getConventionSamples()` returns whatever the test
hardcodes — it was never actually exercising the real
`getConventionSamples` → `getTopFilesByRank` → `isJunkPath` pipeline this
plan's root-cause analysis reasoned about from reading the code alone.
Both predictions confirmed, empirically:

1. **The model pool already works on Go — no bug, as predicted.** The real
   `getConventionSamples(repoId, 12)` returns `main.go` from the fixture,
   and a full `POST /repos/:id/conventions/extract` round-trip (real
   `repoIntel`, mocked LLM/git/github) produces a verified `origin: 'model'`
   candidate whose evidence resolves against the real Go file content. Confirms
   Decision 10-era code (the evidence-verification algorithm, the extraction
   prompt) needed zero changes to work for Go — the gap was always the
   config-derived pool (7.2) and sampling/filtering (7.3/7.5), never this path.
2. **The `_test.go` leak is real, not a theoretical worry.** `main_test.go`
   appears in `getConventionSamples`'s real output alongside `main.go` —
   `JUNK_PATH_PATTERNS`'s `.test.`/`vitest.`/`jest.` patterns genuinely never
   match Go's `_test.go` suffix. One test in the new file
   (`'KNOWN GAP (Phase 7.5): _test.go is not excluded from convention
   sampling'`) pins this as today's actual behavior with a comment pointing
   at the fix, rather than silently accepting it — flip its assertion when
   Phase 7.5 lands.

Both of Phase 7.5's questions are now answered ("is this real" — yes) so
that phase is ready to build without a further empirical gate; 7.2 (Go
config pool) still needs the Open Questions below resolved first (YAML
dependency choice, gofmt handling) before its parser code is written.

## Implementation notes — Phase 7.5, 7.2, 7.3 (this iteration, continued)

**Status: 7.5 done. 7.2 done (both open questions resolved with the user:
skip gofmt for v1, add a real `yaml` dependency rather than hand-roll a
regex extractor). 7.3 done.**

**7.5** — `isTestFile?(file: string)` added to `LanguageDef`
(`repo-intel/languages/index.ts`), with Go's entry set to
`file.endsWith('_test.go')`; a new `isLanguageTestFile()` dispatches through
the existing `languageIdForFile` lookup (same shape as
`PHANTOM_GLOBALS_BY_LANGUAGE`). `isJunkPath` (`repo-intel/service.ts`) now
checks it after the generic `JUNK_PATH_PATTERNS` substrings. Chosen over a
one-off `_test.go` substring pattern specifically for the "any future
language" part of this ask — a 3rd language with its own non-dot test-file
convention registers its own predicate instead of growing `isJunkPath`
again. `conventions-go.it.test.ts`'s previously-pinned KNOWN GAP test now
asserts the fixed behavior.

**7.2** — new `server/src/modules/conventions/langs/go.ts`:
`parseGoModDirectives` (the `go 1.x` version directive → one
`'type-safety'` candidate; no module-path candidate — a module path is an
identifier, not a house convention) and `parseGolangciLint` (`linters.
enable` list → one candidate per enabled linter, via a
`GOLANGCI_LINT_CATEGORY_MAP` mirroring `ESLINT_RULE_CATEGORY_MAP`). Real
YAML parsing via the new `yaml` npm dependency (added to `server/
package.json`, no native/postinstall build-script approval needed) — the
user's call, reasoning that golangci-lint configs use real YAML features a
flat-object regex extractor (this module's existing approach for JS
configs) would likely mis-parse. `.golangci.toml` intentionally not probed
(YAML only, per the same decision) and gofmt intentionally has no
candidate at all (no config file exists to anchor its evidence to, which
would've broken every other config-origin candidate's "evidence IS the
config file" invariant — the user's call, also reasoned as arguably out of
scope since gofmt is a language-wide standard, not a house choice).

**7.3** — two deliverables, one algorithmic and one about test design:
- `stratifyByLanguage` (new `repo-intel/pipeline/sample.ts`) is a **pure**
  function (ranked paths in, reservation math out) rather than the N+1-
  DB-round-trip version first sketched — mirrors `pipeline/rank.ts`'s
  existing split of pure PageRank computation out of its DB-reading
  service wrapper, and makes the reservation math hermetically unit-
  testable (`repo-intel-sample.test.ts`) without depending on real
  PageRank tie-breaking. `RepoIntelService.getConventionSamplesStratified`
  does one `getRankedPaths` fetch + one `getIndexState` call and delegates.
  `ConventionsService.extract()` now calls this instead of plain
  `getConventionSamples`.
- **Real bug found while building the DB-backed wiring test, unrelated to
  Phase 7 but worth recording**: `DepCruiseGraph.buildEdges`
  (`server/src/adapters/depgraph/index.ts`) silently returns **zero edges**
  for any fixture rooted under `os.tmpdir()` on macOS. `/tmp` and `/var`
  are themselves symlinks to `/private/tmp`/`/private/var` on macOS;
  dependency-cruiser's resolver realpath's a dependency's *resolved* path
  but not the *entry* file paths passed into `cruise()`, so `toRel(root,
  dep.resolved)` produces a long `../../private/...` escape that never
  matches `fileSet`, and every edge is dropped as "not a local file" —
  with no error surfaced (the adapter's own try/catch is designed to
  degrade silently on a broken tsconfig, which makes this failure mode
  doubly invisible). No existing test caught this because no test exercised
  the real `DepCruiseGraph` against a real on-disk fixture before now —
  `depgraph-go.test.ts` only covers `GoDepGraph` (its own hand-rolled
  resolver, unaffected), and `indexer-pipeline.test.ts`'s in-memory stub
  replaces `depgraph` entirely (`buildEdges: async () => []`). Worked
  around here by seeding `file_rank`/`repo_index_state` rows directly in
  `repo-intel-sample.it.test.ts` rather than depending on a real
  `runFullIndex` + dependency-cruiser pass — kept the fix itself **out of
  scope** for this iteration (a TS/JS depgraph correctness bug, not a
  multi-language-conventions concern) rather than folding an unrelated fix
  into this PR; worth its own follow-up.

Tests this iteration: `repo-intel-sample.test.ts` (hermetic, 5 cases
including the crowd-out scenario), `repo-intel-sample.it.test.ts` (3 cases,
real Postgres, proves the `getIndexState`/`getRankedPaths` wiring),
`conventions.test.ts` gained `parseGoModDirectives`/`parseGolangciLint`
coverage, `conventions-go.it.test.ts` gained a config-pool case, `languages.
test.ts` gained `isLanguageTestFile` coverage, `repo-intel-facade-degraded.
test.ts` gained a `getConventionSamplesStratified` degraded-state case.
Full suite: 277 unit + 62 integration tests green.
