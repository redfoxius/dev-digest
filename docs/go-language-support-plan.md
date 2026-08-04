# Go language support — analysis + plan

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
