# Development Plan: Project Context Folder

**Status:** not started

## Spec
- [specs/cross-cutting/project-context-folder/spec.md](../specs/cross-cutting/project-context-folder/spec.md) (SPEC-2026-08-19-project-context-folder, 42 ACs, no open `[NEEDS CLARIFICATION]` markers)

## Context

Agents/skills currently never see a repo's own written documentation during a
review — `reviewer-core`'s `## Project context` prompt block
(`reviewer-core/src/prompt.ts:158`) and `ReviewInput.specs`
(`reviewer-core/src/review/run.ts:60`) are fully built and already flow
through `wrapUntrusted`/`INJECTION_GUARD`, but `server/src/modules/reviews/run-executor.ts`
never populates them (`specs: null` at line 522, `specs_read: []` at lines
364/528, and `reviewPullRequest()`'s call at line 251 never passes a `specs`
key at all). This plan wires up two independent mechanisms on top of that
already-shipped, unchanged foundation: (a) manual path-based
attach/inject (new DB tables + endpoints + UI + one `run-executor.ts`
resolution step) and (b) indexing/browsing-only chunk/embed (gated by the
existing `EMBEDDINGS_ENABLED` flag/`Embedder` port, reusing the existing,
currently-empty `code_chunks` table).

`reviewer-core/src/prompt.ts` and `reviewer-core/src/review/run.ts` already
fully implement `parts.specs`/`input.specs` → `wrapUntrusted('spec-i', …)` →
`## Project context` → `PromptAssembly.specs`, and the verbose per-spec
token breakdown (`reviewer-core/src/review/run.ts:182-186`) is already gated
on `input.promptLogVerbose` and iterates `input.specs ?? []`. No new code
belongs in `reviewer-core/` for this feature.

## Scope

- In scope: new `context_documents`/`agent_context_docs`/`skill_context_docs`
  tables, `repos.context_search_globs` column, `code_chunks.source`
  TS-enum widening, reader/reindex + chunk/embed services, 8 new endpoints,
  Project Context page, Agent/Skill Editor Context tabs, `run-executor.ts`
  resolution wiring, both `vendor/shared` contract copies.
- Out of scope (per spec §12, not re-litigated): automatic PR-diff-based
  document selection, in-app document editing, cross-repo attachment
  pooling, a deterministic citation-grounding gate, an MCP tool, active
  `code_chunks` GC, user-configurable size caps. Also out of scope for this
  plan specifically: automatically triggering reindex on repo sync — the
  spec's glossary (§2, "Reindex") mentions this as a possibility, but no
  AC gates it (AC-1's only verified trigger is the explicit `POST
  .../reindex` endpoint); wiring reindex into the existing repo-sync job
  (`INDEX_JOB_KIND`, `server/src/modules/repos/service.ts:68`) is left for
  a future increment rather than invented here without an AC to satisfy.

## Modules Touched

- `server/` — new DB tables/column, new `context-docs` module, `agents`/
  `skills` module extensions, `run-executor.ts` resolution wiring.
- `client/` — new Project Context page, new Context tab in Agent/Skill
  editors, new API hooks. `TraceBody.tsx` needs **zero** changes (confirmed:
  `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/_components/TraceBody/TraceBody.tsx:41-86`
  already renders `trace.specs_read` and `trace.prompt_assembly.specs`).
- `reviewer-core/` — **untouched**, confirmed above. Do not create a work
  item here.
- `e2e/`, `mcp-server/` — untouched; spec §12 explicitly excludes a new MCP
  tool, and no e2e-critical flow requires new browser-level coverage beyond
  what's optional polish.

## Architectural Constraints

- Onion/ports rule (`onion-architecture` skill): `service.ts` never imports
  `drizzle-orm` directly — only `repository.ts` does
  (`.claude/skills/onion-architecture/SKILL.md` "Module Anatomy"). The new
  `context-docs` module must keep this shape: `routes.ts` → `service.ts` →
  `repository.ts`.
- Composition root: any new capability is exposed via a `Container` getter,
  never `new X()` outside `platform/container.ts` — mirror
  `get reposRepo()` (`server/src/platform/container.ts:127-128`) with a new
  `get contextDocsRepo()`.
- Cross-module reads go through the container's shared repo getters, not a
  direct import of another module's `repository.ts`
  (`.claude/skills/onion-architecture/SKILL.md` "Anti-Patterns"): the new
  module reads `repos.clonePath`/`context_search_globs` via
  `container.reposRepo` (`server/src/platform/container.ts:127`), not by
  querying `schema.repos` inline.
- Zod validates `params`/`body` at the route boundary (`server/AGENTS.md`
  "Routes validate via zod... invalid input gets a 422 before the handler
  runs") — AC-7's glob-escape 422 belongs in the `PUT context-config`
  route's zod/service validation layer, not a hand-rolled check deep in a
  service method.
- `agentSkills`'s uncheck-preserves-row / bulk-POST-vs-PATCH split is the
  literal structural precedent (`server/src/db/schema/agents.ts:52-70`,
  `server/src/modules/agents/repository.ts:250-327`) — `agent_context_docs`/
  `skill_context_docs` must mirror it exactly, including the **documented
  bulk-POST vs PATCH semantic difference** (see Gotchas below).
- Client: route-colocated `_components/` folders, one `index.ts` re-export
  per component, data-fetching lives in `lib/hooks/<domain>.ts`, never
  inline in a component (`frontend-ui-architecture` skill, "Business Logic
  Placement"). `src/vendor/shared` is a hand-copied, independently-driftable
  subset of the server's copy — both copies must be edited for every new
  contract (root `CLAUDE.md`, `client/AGENTS.md`).
- Security: every new glob and file path must be validated so it can never
  resolve outside `repos.clonePath` (AC-7/AC-41) — both at write-time
  (reject the glob string) and read-time (defense-in-depth: resolve +
  prefix-check against `clonePath` before every fs read), per the
  `security` skill's A01 "always check ownership"/path-traversal guidance
  applied to file paths instead of DB rows.

## Relevant INSIGHTS.md Gotchas

- `agent_skills`'s bulk `POST /agents/:id/skills` (replace) and
  `PATCH /agents/:id/skills/:skillId` (toggle) are **not interchangeable**
  for "attach enabled": bulk POST defaults a brand-new id to `enabled:
  false` (`server/src/modules/agents/repository.ts:299`, preserving
  existing links' enabled state), while only PATCH both attaches AND
  enables in one call (`repository.ts:307-`). A prior test picked the
  wrong one and silently got `used_by: 0`. The new
  `agent_context_docs`/`skill_context_docs` `POST .../context-docs` (bulk
  reorder, AC-20) and `PATCH .../context-docs/:path` (attach+enable,
  AC-18) must preserve this exact split — don't collapse them into one
  endpoint, and write a test asserting the bulk-POST-doesn't-auto-enable
  behavior explicitly.
- `@devdigest/shared` hand-copies have already drifted silently at least
  once (`AgentManifest`, `sessionId`, `'openrouter'` provider id existed
  server-side only) — grep the client's `src/vendor/shared` copy explicitly
  before assuming a contract only needs adding server-side (root
  `CLAUDE.md`; `server/INSIGHTS.md` 2026-07-27 entry).
- `repo-intel`'s `walkClone` (`server/src/modules/repo-intel/pipeline/walk.ts:14-18`)
  does **not** actually implement `.gitignore` parsing — its own doc
  comment says so explicitly. It only excludes a static `EXCLUDED_DIRS`
  list (`node_modules`, `dist`, `build`, `.git`, …,
  `server/src/modules/repo-intel/constants.ts:19-27`). AC-4's own verify
  clause only tests a `node_modules/**` file being excluded — fully
  satisfied by reusing an `EXCLUDED_DIRS`-style directory-name exclusion,
  **not** by building a real `.gitignore` parser.
- `server/package.json` contains **no** glob-matching library (no
  `minimatch`/`micromatch`/`fast-glob`/`ignore`). AC-1/AC-5/AC-6/AC-7
  require matching real glob patterns with globstar + brace expansion
  (`**/{specs,docs,insights}/**/*.md`), which plain `fs.readdir` walking
  cannot do — a new dependency is required (recommend `micromatch`, small,
  no native bindings, supports both features). Adding it is itself a Work
  Item, not an incidental detail.
- `code_chunks.source` (`server/src/db/schema/context.ts:31-38`) is a plain
  Drizzle `text(..., { enum: [...] })` column — that `enum` option is
  **TypeScript-only**, not a Postgres `CHECK`/`ENUM` type. Widening it to
  include `'insights'` requires **only a TS source change**, not a DB
  migration by itself — it rides along with whatever migration the new
  tables/column need for other reasons.
- Client already has its own chars/4 `estimateTokens` duplicate
  (`client/src/app/skills/_components/SkillDetail/_components/ConfigTab/helpers.ts:16`)
  used for the Skill editor's own "chars · ~N tokens" line — the client
  **cannot** import `reviewer-core` (server-only TS-source path alias,
  not wired for client). AC-21's "chars/4 `estimateTokens` heuristic" must
  be satisfied by reusing/duplicating this exact client helper, not by
  attempting a `reviewer-core` import from `client/`.

## Skills Implementer Will Need

- `drizzle-orm-patterns` — new `context_documents`/`agent_context_docs`/
  `skill_context_docs` tables, `repos.context_search_globs` column,
  composite PKs mirroring `agentSkills`.
- `postgresql-table-design` — new tables' PK/FK/index/enum choices (uuid
  PKs consistent with sibling tables, `ON DELETE CASCADE`, a unique index
  on `(repo_id, path)` for `context_documents`).
- `fastify-best-practices` — 8 new routes across 3 modules, zod
  `params`/`body` validation, 404/422 error shaping consistent with
  existing routes.
- `zod` — request/response schemas for all new contracts; `422` on AC-7's
  glob-escape validation should use a Zod refinement or a service-level
  `AppError` mapped to 422, matching the existing convention.
- `onion-architecture` — keep the new `context-docs` module's
  routes→service→repository shape; route fs-reads for run-time resolution
  through the module's own I/O-boundary file (mirroring how
  `repo-intel/pipeline/walk.ts` does raw fs I/O directly within its own
  module rather than via a formal port, since no `Embedder`-style external
  SaaS is involved).
- `security` — AC-7/AC-41 glob/path escape rejection (validate the glob
  string at write time AND resolve+prefix-check every read against
  `clonePath` at read time, defense-in-depth); AC-39's untrusted-content
  boundary (resolved doc text must reach only `ReviewInput.specs`, never
  `systemPrompt`/`task`).
- `frontend-ui-architecture` — Project Context page + 2 new Context tabs,
  each in their own route-colocated `_components/` folder; new
  `lib/hooks/context-docs.ts` for all context-doc API calls (one hook file
  per API domain, mirroring `lib/hooks/skills.ts`/`agents.ts`).
- `react-best-practices` — drag-reorder/optimistic-order state in the two
  new Context tabs should follow `SkillsTab.tsx`'s existing
  `optimisticRows`/`dragTokenRef` pattern
  (`client/src/app/agents/[id]/_components/AgentEditor/_components/SkillsTab/SkillsTab.tsx:51-58`)
  rather than reinventing drag state.
- `react-testing-library` — new component tests for the Project Context
  page and both Context tabs, mirroring `SkillsTab.test.tsx`'s assertion
  shape for AC-42's `aria-live` region.

## Work Items

1. **Add a glob-matching dependency + path-safety helper.**
   Files: `server/package.json` (add `micromatch` + `@types/micromatch`),
   new `server/src/modules/context-docs/glob-safety.ts` (pure functions:
   `isGlobEscaping(glob: string): boolean` checking for `..`/leading `/`/
   drive-letter segments; `resolveWithinClone(clonePath, relPath): string |
   null` — `path.resolve` + prefix-check against `clonePath`, returning
   `null` if it escapes).
   Depends on: none.
   Acceptance: unit tests cover `../../etc/**/*.md` → rejected, an absolute
   glob → rejected, a normal `**/{specs,docs,insights}/**/*.md` → accepted;
   `resolveWithinClone` rejects a `path` containing `..` segments that
   would resolve outside `clonePath`.
   Satisfies: AC-7, AC-41.

2. **DB schema: new tables + column + enum widening.**
   Files: new `server/src/db/schema/project-context.ts` (`contextDocuments`,
   `agentContextDocs`, `skillContextDocs`, mirroring
   `server/src/db/schema/agents.ts:52-70`'s `agentSkills` shape exactly —
   composite PK, `enabled` default `true`, `order` integer); edit
   `server/src/db/schema/repos.ts` to add `contextSearchGlobs: text('context_search_globs').array()`
   (nullable); edit `server/src/db/schema/context.ts:37` to widen
   `codeChunks.source`'s TS enum to include `'insights'` (no migration
   needed for this specific line — see Gotchas); edit `server/src/db/schema.ts`
   to export the new file. Run `pnpm db:generate` then `pnpm db:migrate`
   (manual per root `CLAUDE.md` — this must happen before any work item
   below that queries these tables, including integration tests).
   Depends on: none (independent of Work Item 1).
   Acceptance: migration applies cleanly against a fresh dev DB; a
   `select * from context_documents limit 0` and equivalent for the two
   link tables succeed; `repos.context_search_globs` column exists,
   nullable.
   Satisfies: AC-1 (schema prerequisite), §9 data model.

3. **Reader/reindex service — file discovery.**
   Files: new `server/src/modules/context-docs/{routes,service,repository}.ts`,
   `server/src/modules/context-docs/reader.ts` (recursive scan using
   `micromatch` against configured/default globs, `root` classification
   purely from which glob matched, directory-exclusion reusing an
   `EXCLUDED_DIRS`-equivalent list per the Gotchas note, size-byte
   recording, content-hash via `node:crypto`); wire
   `container.contextDocsRepo` getter in `server/src/platform/container.ts`
   (mirroring `reposRepo`, `server/src/platform/container.ts:127-128`).
   Depends on: Work Items 1, 2.
   Acceptance: reindex against a 6-file fixture clone across
   `specs/`/`docs/`/`insights/` upserts 6 rows with correct `root`; a
   second reindex after deleting one file removes only that
   `context_documents` row while a seeded `agent_context_docs` row
   referencing that path survives unchanged; a fixture
   `node_modules/pkg/README.md` never appears; `clonePath` null → `200`
   with empty `documents`/`index_status: "not_indexed"`, never `500`.
   Satisfies: AC-1, AC-2, AC-3, AC-4, AC-16.

4. **Search-root config endpoints.**
   Files: `server/src/modules/context-docs/routes.ts` (`GET`/`PUT
   /repos/:repoId/context-config`), `service.ts` (default-glob fallback,
   422 via Work Item 1's `isGlobEscaping`), `server/src/vendor/shared/contracts/*`
   (`ContextSearchConfig` — new file or added to an existing contracts
   file, see Work Item 7) + `client/src/vendor/shared` copy.
   Depends on: Work Items 1, 3.
   Acceptance: fresh repo → `GET` returns the literal default glob; `PUT`
   with a custom glob persists scoped to that repo only (a second repo's
   config/documents unaffected) and takes effect on next reindex; `PUT`
   with `["../../etc/**/*.md"]` → `422`, and no file outside `clonePath`
   ever appears in `context_documents` even before this check existed (the
   read-time defense from Work Item 1 as backstop).
   Satisfies: AC-5, AC-6, AC-7, AC-40, AC-41.

5. **Chunking + embedding — heading-based, gated by `EMBEDDINGS_ENABLED`.**
   Files: new `server/src/modules/context-docs/chunker.ts` (pure:
   split on markdown headings, ~500-token fallback window per §9,
   reusable/testable with no DB/FS); `service.ts` reindex path calls it
   only for changed/new documents (content-hash comparison, AC-38), only
   when `container.config.embeddingsEnabled` and `container.embedder()`
   doesn't throw `ConfigError` (mirroring the existing
   throw-before-any-OpenAI-call/catch-and-degrade contract,
   `server/src/platform/container.ts:264-277`); persists via existing
   `code_chunks` table with `source: 'docs'|'spec'|'insights'` (matches
   `root`); size gate (`size_bytes > 1_048_576` → skip, flag
   `too_large_to_index`).
   Depends on: Work Items 2, 3.
   Acceptance: with `EMBEDDINGS_ENABLED=true` + a mocked `Embedder`,
   reindex inserts `code_chunks` rows and per-document `chunk_count`
   reflects them; flag off → `200`, `chunk_count: null`,
   `index_status: "disabled"`; flag on + no key → `200`,
   `index_status: "misconfigured"`; an >1MB fixture doc is discovered but
   `chunk_count: null`/`"too_large_to_index"`, a doc at exactly 1MB indexes
   normally; a second reindex with zero file changes issues zero
   `Embedder.embed()` calls (content-hash short-circuit). Record the
   heading-based/~500-token-fallback chunking decision in
   `server/INSIGHTS.md` once implemented (per spec §9's explicit
   instruction).
   Satisfies: AC-8, AC-9, AC-10, AC-11, AC-38.

6. **Project Context browser endpoints.**
   Files: `server/src/modules/context-docs/routes.ts` (`GET
   /repos/:repoId/context-docs`, `POST .../reindex`, `GET .../preview`),
   `service.ts` (coverage % computation joining `agent_context_docs`/
   `skill_context_docs` counts, `used_by_agents`/`used_by_skills` per
   document), `repository.ts` (raw-file preview read using Work Item 1's
   `resolveWithinClone` guard).
   Depends on: Work Items 3, 4, 5.
   Acceptance: page load's `GET` returns one row per document with
   `used_by_agents`/`used_by_skills`; attaching 3 of 12 documents to ≥1
   agent/skill each yields coverage `25`; selecting a document via
   `GET .../preview?path=...` returns raw content read-only, `404` for an
   undiscovered path; a `clonePath`-null repo returns the `"not_indexed"`
   empty state on both `GET` and `POST .../reindex`, never `500`.
   Satisfies: AC-12 (browser never triggers embedding directly), AC-13,
   AC-14, AC-15, AC-16, AC-40.

7. **`@devdigest/shared` contracts — both vendor copies.**
   Files: `server/src/vendor/shared/contracts/knowledge.ts` (or a new
   `context.ts` contracts file, following the existing per-domain-file
   split) — add `ContextDocument`, `AgentContextDocLink`,
   `SkillContextDocLink`, `ContextSearchConfig` zod schemas per spec §10's
   exact shapes, mirroring `AgentSkillLink`
   (`server/src/vendor/shared/contracts/knowledge.ts:346-353`); **then**
   hand-copy the identical additions into
   `client/src/vendor/shared/contracts/`. Do this as one atomic step, not
   two separate PRs/passes.
   Depends on: none (can run in parallel with Work Items 1-6, must land
   before Work Items 8-13 which consume the types).
   Acceptance: `grep` both `vendor/shared` trees confirms all 4 new type
   names exist in both with identical field shapes; `pnpm typecheck` in
   both `server/` and `client/` passes.
   Satisfies: (contract prerequisite for) AC-13 through AC-36, §10.

8. **Agent Context tab — backend.**
   Files: `server/src/db/schema/project-context.ts` (from Work Item 2),
   `server/src/modules/agents/repository.ts` (new
   `agentContextDocs`/`setAgentContextDocs`/`setAgentContextDocEnabled`
   methods, mirroring `linkSkill`/`setSkills`/`setSkillEnabled`
   exactly — **including the documented bulk-POST-vs-PATCH split**, see
   Gotchas), `server/src/modules/agents/service.ts`,
   `server/src/modules/agents/routes.ts` (`GET`/`POST
   /agents/:id/context-docs`, `PATCH /agents/:id/context-docs/:path` —
   percent-decode `:path` per spec §10).
   Depends on: Work Items 2, 7.
   Acceptance: checking a document creates/enables a row appended at the
   end of order; unchecking preserves the row + order (never deletes);
   drag-reorder's bulk `POST` persists a new order for attached AND
   unattached rows, and does **not** silently re-enable an unrelated
   currently-unchecked row (explicit regression test); a path missing from
   the latest `context_documents` scan resolves `document: null` in the
   link response (AC-22's backend half); cross-workspace agent id → `404`.
   Satisfies: AC-17, AC-18, AC-19, AC-20, AC-22 (backend half), AC-40.

9. **Skill Context tab — backend.**
   Files: `server/src/modules/skills/repository.ts`,
   `server/src/modules/skills/service.ts`,
   `server/src/modules/skills/routes.ts` — identical shape to Work Item 8,
   skill-scoped (`GET`/`POST /skills/:id/context-docs`,
   `PATCH /skills/:id/context-docs/:path`).
   Depends on: Work Items 2, 7.
   Acceptance: mirrors Work Item 8's tests against the skill-scoped
   endpoints (AC-24 explicitly requires the same create-enable/
   disable-preserve/full-list-reorder contract as AC-18–AC-20).
   Satisfies: AC-23, AC-24, AC-40.

10. **Run-time resolution + injection — `run-executor.ts`.**
    Files: new `server/src/modules/context-docs/resolve.ts` (pure-ish
    function `resolveContextDocs(agentId, repoId, container):
    Promise<{ specs: string[]; specsRead: string[]; warnings: string[] }>`
    — resolves agent's own enabled attached docs in order, then each
    enabled linked skill's enabled attached docs in skill order then
    doc order, de-dup to first occurrence per `(repo, path)`, raw fs read
    via Work Item 1's `resolveWithinClone` guard, `### {path}` heading
    prefix, 12,000-char truncation with `"...[truncated]"` marker, missing
    file → warning + skip, never throw); edit
    `server/src/modules/reviews/run-executor.ts` — call
    `resolveContextDocs` alongside the existing `linkedSkills` resolution
    (`run-executor.ts:223`), pass `...(resolvedSpecs.length ? { specs:
    resolvedSpecs } : {})` into `reviewPullRequest()`'s call
    (`run-executor.ts:251-285`, currently omits `specs` entirely), append
    the AC-32 trusted citation-framing sentence to `task`
    (`run-executor.ts:237`) only when `resolvedSpecs.length > 0`, populate
    `trace.specs_read` (`run-executor.ts:364`, currently `[]`) with the
    actually-injected paths (post-dedup, post-missing-skip), and thread
    `resolvedSpecsRead` into `traceFromBuffer`'s failure-path trace
    (`run-executor.ts:496-531`, currently hardcodes `specs: null`/
    `specs_read: []`) the same way `resolvedSkills` already is
    (`run-executor.ts:502,520`).
    Depends on: Work Items 1, 2, 7, 8, 9.
    Acceptance (unit, hermetic — mocked fs/DB): agent with 2 own attached
    docs + 1 linked skill with 1 attached doc resolves in the documented
    order via raw reads (assert zero `code_chunks` queries); same
    `(repo, path)` at both agent and skill level → one entry at its
    agent-level position; each entry starts with `### <path>\n\n`; a
    document >12,000 chars truncates to exactly 12,000 +
    `"...[truncated]"`; a deleted attached file → skipped, warning logged
    naming the path, run still completes with the rest; `reviewPullRequest`
    is the only touched integration point (code review confirms
    `reviewer-core/src/prompt.ts` has no diff); the assembled user message
    contains the citation-framing sentence iff `specs.length > 0`; run
    against an agent whose attached documents were never
    indexed/embedded still succeeds with the Embedder spy at call count 0.
    Satisfies: AC-12, AC-26, AC-27, AC-28, AC-29, AC-30, AC-31, AC-32,
    AC-33, AC-39.

11. **Trace population — no client change, server-only confirmation.**
    Files: none beyond Work Item 10 (verification-only item —
    `trace.prompt_assembly.specs` and the verbose
    `prompt_assembly_verbose` event are already populated for free once
    Work Item 10 passes `specs` into `reviewPullRequest`, per
    `reviewer-core/src/review/run.ts:130-133,172-192`).
    Depends on: Work Item 10.
    Acceptance: a run with attached documents produces non-empty
    `RunTrace.prompt_assembly.specs`, rendered by the existing
    `TraceBody.tsx:85-86` `PromptBlock` unmodified, showing full untruncated
    text on expand; with `PROMPT_ASSEMBLY_DEBUG=true`, a
    `prompt_assembly_verbose` event lists each `spec-i` with char/token
    counts (already implemented at `reviewer-core/src/review/run.ts:182-186`,
    now actually exercised).
    Satisfies: AC-34, AC-35, AC-36.

12. **Client API hooks.**
    Files: new `client/src/lib/hooks/context-docs.ts` — one hook per
    endpoint (`useContextDocs(repoId)`, `useReindexContextDocs(repoId)`,
    `useContextDocPreview(repoId, path)`, `useContextConfig(repoId)`,
    `useSetContextConfig(repoId)`, `useAgentContextDocs(agentId)`,
    `useSetAgentContextDocs(agentId)`, `useSetAgentContextDocEnabled(agentId)`,
    and the skill-scoped equivalents), mirroring
    `client/src/lib/hooks/agents.ts`/`skills.ts`'s existing shape/naming.
    Depends on: Work Item 7.
    Acceptance: `pnpm test` for this file (mocked `fetch`, per
    `client/AGENTS.md`) covers a success + error path per hook.
    Satisfies: (client-side prerequisite for) AC-13 through AC-25.

13. **Project Context page.**
    Files: new `client/src/app/repos/[repoId]/context/page.tsx` +
    `_components/` (list grouped by root, coverage indicator, Preview
    pane, Reindex action, degraded-state chunk-count label), mirroring
    `client/src/app/repos/[repoId]/conventions/page.tsx`'s
    `useActiveRepo`/`useRepoNotFound`/loading-error-empty-populated
    structure.
    Depends on: Work Item 12.
    Acceptance (RTL): loading → skeleton rows; empty (no documents) → CTA
    to reindex/check config; populated → grouped list with per-row
    used-by-agent/skill counts and coverage %; selecting a row renders
    read-only preview content with no edit affordance anywhere in the DOM;
    `clonePath`-null repo → explicit not-yet-indexed empty state, not an
    error boundary.
    Satisfies: AC-13, AC-14, AC-15, AC-16.

14. **Agent Editor — Context tab.**
    Files: new
    `client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/`
    (`ContextTab.tsx`, `helpers.ts`, `constants.ts`, `styles.ts`,
    `index.ts`, `ContextTab.test.tsx`), mirroring
    `.../SkillsTab/SkillsTab.tsx` structurally (checkbox, drag-reorder via
    the same `optimisticRows`/`dragTokenRef` pattern, `aria-live` region);
    add a token-estimate footer reusing/duplicating
    `client/src/app/skills/_components/SkillDetail/_components/ConfigTab/helpers.ts:16`'s
    `estimateTokens`.
    Depends on: Work Item 12.
    Acceptance (RTL, mirroring `SkillsTab.test.tsx`'s assertion shape):
    attached-first ordering; checking a row attaches+appends; unchecking
    preserves position; drag-reorder persists a bulk order call; footer
    "≈ N tokens" equals `estimateTokens(sum of enabled docs' content
    length)`; a row whose path is missing from the latest scan renders a
    "missing" indicator without disappearing; `aria-live` region announces
    filtered document count on filter, keyboard-operable drag handle
    (matches `SkillsTab`'s existing pattern).
    Satisfies: AC-17, AC-18, AC-19, AC-20, AC-21, AC-22, AC-42.

15. **Skill Editor — Context tab.**
    Files: new `client/src/app/skills/_components/SkillDetail/_components/ContextTab/`
    (same anatomy as Work Item 14), labeled "Project context to use", plus
    a "SERIALIZES AS" preview panel rendering the literal `## Project
    context` heading text (reusing `reviewer-core`'s exact heading string
    as a shared constant or hardcoded to match
    `reviewer-core/src/prompt.ts:158`'s `'## Project context'` — do not
    invent illustrative mockup text).
    Depends on: Work Item 12.
    Acceptance: same test shape as Work Item 14, skill-scoped; attaching
    `specs/public-api.md` renders a preview beginning `## Project context`
    that matches what a resolved run's `prompt_assembly.specs` would
    contain for that one document (assert against the real
    `wrapUntrusted('spec-0', …)` output shape, not a hand-written string).
    Satisfies: AC-23, AC-24, AC-25, AC-42.

16. **End-to-end verification: invariant citation (AC-37).**
    Files: new integration/e2e-style test under `server/test/` (e.g.
    `server/test/context-docs-citation.it.test.ts`) — seed a fixture repo
    clone with `specs/architecture-invariants.md` stating "module `api/`
    must not import `db/` directly", attach it to a Security-Reviewer-type
    agent via Work Item 8's endpoints, construct a PR fixture whose diff
    adds an `api/handler.ts → db/...` import, run the agent through the
    real `run-executor.ts` path (mocked LLM returning a finding whose
    `rationale` cites the filename, or — if budget allows — a real model
    call against a cheap model), assert the persisted finding's
    `rationale` contains the string `architecture-invariants.md`.
    Depends on: Work Items 8, 10.
    Acceptance: the described assertion passes; a mocked-LLM version
    satisfying the plumbing is acceptable if a real-model run is judged too
    flaky/costly for CI, but at least one of the two must exist and pass
    before this plan is considered done.
    Satisfies: AC-37.

## Verification

- Run `pnpm db:migrate` (server) before any DB-backed test in this plan —
  first-run 500s ("relation ... does not exist") mean this step was
  skipped (`server/AGENTS.md` Gotchas).
- `server/`: `pnpm exec vitest run --exclude '**/*.it.test.ts'` (unit) +
  `pnpm exec vitest run .it.test` (integration, real Postgres via
  testcontainers) + `pnpm typecheck`.
- `client/`: `pnpm test` (mocked fetch) + `pnpm typecheck`.
- Explicit AC-12 regression check: a dedicated unit test asserting a run
  with never-indexed attached documents (embeddings disabled or reindex
  never run) still succeeds and injects full text, with the `Embedder`
  port spy at call count 0 — this is the sharpest test of the "two
  independent mechanisms" architectural boundary the whole spec rests on.
- Explicit AC-29 regression check: a `git diff` (or code-review pass)
  confirming zero lines changed under `reviewer-core/` for this entire
  plan.
- Explicit AC-39 regression check: grep the diff for every place
  `resolvedSpecs`/`resolveContextDocs`'s output is consumed — must resolve
  to exactly one call site (`reviewPullRequest`'s `specs` argument),
  never `systemPrompt` or `task` construction.
- Cross-workspace 404 sweep (AC-40): one parametrized test per new route
  (all 11: context-docs GET/POST-reindex/preview, context-config GET/PUT,
  agent context-docs GET/POST/PATCH, skill context-docs GET/POST/PATCH)
  asserting a valid id from a different workspace returns `404`, not `200`
  with someone else's data or a `500`.
- End-to-end (Work Item 16) — the AC-37 invariant-citation scenario is the
  single acceptance test that exercises the full stack (reindex → attach →
  run → trace) in one pass; run it last, after every other work item lands.
- Run the `engineering-insights` skill against `server/` (chunking
  strategy decision, glob-library choice, EXCLUDED_DIRS reuse) and
  `client/` (Context tab structure) once implementation completes, per
  root `CLAUDE.md`'s session protocol.

## Cross-references
- Rendered as an Artifact: none yet.
- Shipping PR: [#21](https://github.com/redfoxius/dev-digest/pull/21) (spec only, so far — this plan has not been implemented yet).
