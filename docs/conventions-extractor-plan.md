# Conventions Extractor + API Contract Reviewer — feature plan

**Related:** this feature is currently JS/TS-only in practice (Decision 10's
config-derived pool has no non-JS equivalent, and the model-derived pool is
untested against other languages) — see Phase 7 of
[go-language-support-plan.md](go-language-support-plan.md#phase-7--conventions-extractor-multi-language-support-planned)
for the analysis and a Go-first, extensible-to-any-language upgrade plan
(status: not started).

**Status:** code complete for the Conventions Extractor feature itself —
foundation (migration `0014`, schema, contracts, `repoIntel.getFileContent`),
the server `conventions` module (extract pipeline, config parsers, evidence
verification, routes), and the client UI (`/repos/:repoId/conventions` page,
hooks, `ConventionCandidateCard`, `CreateSkillFromConventionsModal`, nav) are
all built and verified: server 254 unit + 54 integration tests green, client
112 tests green, both packages typecheck clean, `next build` succeeds.
**Not done**: a live run against a real indexed repo (the PR's own
findings-quality report needs real output, not synthetic), and the entire
**API Contract Reviewer workstream** below (content authoring + demo — no
app code needed, reuses the existing Skills/Agents UI) — deferred, not
started.

## Context

Two linked deliverables, from the course assignment brief (L02):

1. **Conventions Extractor** — a real product feature: scan a repo's configs
   + top-ranked files, have a cheap model propose house-style "conventions"
   candidates (category, rule, file+line evidence, confidence), verify each
   candidate's evidence *in code* (file exists, snippet exists at/near the
   claimed location), let the user accept/reject/edit candidates in the UI,
   then bundle the accepted ones into one (or more) `Skill` and link it to an
   agent — all clicking through to real GitHub code for evidence.
2. **API Contract Reviewer** — not a coding task. It reuses machinery that
   already ships on this branch (Agent + Skill CRUD, import, and agent↔skill
   linking — see `docs/skills-feature-plan.md`, status: implemented). The
   work here is *content* (4 skill bodies with directive rules + good/bad
   examples) and a *demo* (create the agent, attach skills — at least one via
   import — run a breaking-change PR with skills off vs. on, capture both).

**This is not a greenfield feature either.** Repeating the pattern already
noted in `docs/skills-feature-plan.md` ("DB schema already ships every
future-lesson table, empty — later lessons fill them"), a large share of
Conventions' scaffolding already exists on this branch:

| Piece | Where | State |
|---|---|---|
| `conventions` table | `server/src/db/schema/knowledge.ts:31-42` | exists, empty, needs 2 columns added |
| `ConventionCandidate` contract | `.../contracts/knowledge.ts:186-195` | exists, needs 2 fields added |
| `PluginConvention` + bundle export | `.../contracts/productionize.ts:60-67,90` | exists, unused |
| `repoIntel.getConventionSamples(repoId, n)` | `server/src/modules/repo-intel/service.ts:665` | exists, already does exactly "top-N ranked files minus tests/configs" |
| `SkillSource` includes `'extracted'` | `.../contracts/knowledge.ts:118` | exists, never produced by any code path yet |
| Agent↔Skill linking (attach, enable, reorder) | `server/src/modules/agents/routes.ts:33-35,156-179` | fully implemented (this session's earlier work) |
| Skill CRUD + import (file/URL/community) + universal untrusted-wrapping | `server/src/modules/skills/*`, `reviewer-core/src/prompt.ts` | fully implemented |
| Nav placeholder for "Conventions" under SKILLS LAB | `client/src/vendor/ui/nav.ts:29-35` (comment: *"Conventions + Eval Dashboard belong here too"*) | reserved, not wired |
| GitHub blob deep-link helper | `client/src/lib/github-urls.ts:24-37` (`githubBlobUrl`) | exists, used by `FindingCard` — same pattern this feature needs |
| Repo's pinned commit for stable links | `server/src/db/schema/repo-intel.ts:40` (`lastIndexedSha`) | exists |

So this spec is scoped as **"finish what was started,"** same framing as the
Skills feature: a new `conventions` server module + a handful of schema/
contract additions + one new client route, wired onto machinery that already
works end-to-end.

Two mockups in `working-screenshots/` (the two most-recently added at the
time of writing) confirm the UI shape:

- `bf74f383-…image (1).png` — **Conventions list page**: repo switcher,
  "Detected from 84 sample files · last scan 1h ago", "Re-scan" button, a
  "Deselect all" + "N of M accepted" counter, "Create skill" button, and a
  vertical list of candidate cards (bold rule title, `file:line` evidence
  block with a copy icon and the actual code snippet inline, a green/orange/
  red confidence bar, and per-card **Accepted** (solid, active) / **Reject**
  (outline) buttons — default state is *accepted*, user prunes down).
- `e7103c01-…image (2).png` — **"Create skill from conventions" modal**:
  banner *"Merged from 3 accepted conventions in payments-api. Everything
  below is editable before you save."*, then Name / Description / Type
  (`convention`) / Enabled toggle / a line-numbered Markdown body editor
  pre-filled with one `##` section per accepted candidate (heading = a
  slugified rule id, body = the rule text + the evidence snippet), a token
  count, Cancel / Create skill.

## Scope boundary: what's genuinely new vs. reused

**New code (server):**
- `conventions` DB migration (4 columns — see Decisions 3 and 10) + a
  `server/src/modules/conventions/` module (repository/service/routes/
  helpers/constants, mirroring the `skills` module's file layout — repo
  convention).
- One `repoIntel` facade addition: `getFileContent(repoId, file)` (a thin
  export of the already-private `readClone` helper at `repo-intel/
  service.ts:797`) so the new module can read evidence out of the same
  clone without duplicating clone-path logic.
- A cheap-model prompt + `completeStructured()` call (pattern already used
  by `server/src/adapters/llm/openai.ts:88`) to produce raw candidates.
- Code-only evidence verification (no model call) that discards or confirms
  each candidate.
- **Deterministic config-rule parsers** (eslint/tsconfig/prettier → convention
  candidates, zero model calls) — promoted into core v1 scope, not left as a
  deferred idea. See Decision 10.

**New code (client):**
- `client/src/app/repos/[repoId]/conventions/page.tsx` + its
  `_components/` (candidate list, candidate card, create-skill modal),
  `client/src/lib/hooks/conventions.ts`.
- Wire the reserved `"Conventions"` nav entry in `nav.ts`.

**Reused as-is (no code changes needed):**
- Everything under `server/src/modules/skills/` and `agents/*skills*` —
  the new module calls `SkillsService.create()` and the existing
  `POST /agents/:id/skills` to do the "bundle into a skill, link to an
  agent" steps. **No new linking mechanism is built for this feature** —
  this directly satisfies "прилінкуйте його до агента (механізмом з
  лабораторної)."
- `githubBlobUrl()` — evidence links use it exactly like `FindingCard`
  does, pinned to `repos.lastIndexedSha` (analogous to `FindingCard` pinning
  to a PR's `headSha` — same reasoning: stable links independent of later
  pushes).
- `wrapUntrusted()` in `reviewer-core/src/prompt.ts` — the generated
  `repo-conventions` skill goes through the same universal untrusted-wrap
  as every other skill; no special-casing needed.

## Decisions

1. **Evidence line numbers are computed by code, not trusted from the
   model.** The model is asked for `{category, rule, evidence: {file,
   snippet}, confidence}` — no line number in its output. Verification
   reads the file from the clone and searches for the snippet (normalized:
   trim trailing whitespace per line, collapse blank-line runs) to find its
   actual line range. This is strictly more robust than asking the model
   for a line number and spot-checking it — the "does the line exist" check
   *is* the line-number computation, not a separate step. A candidate whose
   snippet isn't found (exact or ≥90%-line-similarity fuzzy match, tried in
   that order) is discarded before it ever reaches the DB.
2. **Discarded candidates are not persisted.** "Кандидати без доказів
   відкидаються" is read literally — they never become a `conventions` row,
   so they can't leak into a skill and don't clutter the UI. (A debug-only
   server log line records the discard + reason, for the PR's own
   quality-report section — see "Product quality report" below — but no
   user-facing "discarded" list is built; out of scope.)
3. **`conventions` schema gains `category` (text) and `evidence_line_start`
   / `evidence_line_end` (integer, nullable)**, and `accepted: boolean`
   becomes a tri-state via a new `status` text enum
   (`'pending' | 'accepted' | 'rejected'`), matching the mockup's
   accept/reject toggle semantics (a `boolean` can't represent "rejected"
   distinctly from "never reviewed"). Migration `0014_add_convention_fields.sql`:
   ```sql
   ALTER TABLE "conventions" ADD COLUMN "category" text;
   ALTER TABLE "conventions" ADD COLUMN "evidence_line_start" integer;
   ALTER TABLE "conventions" ADD COLUMN "evidence_line_end" integer;
   ALTER TABLE "conventions" ADD COLUMN "status" text NOT NULL DEFAULT 'pending';
   ALTER TABLE "conventions" ADD COLUMN "origin" text NOT NULL DEFAULT 'model';
   -- origin: 'model' | 'config' — see Decision 10.
   -- backfill note: table is empty pre-feature, so no data migration needed
   -- for `accepted` → `status`; keep `accepted` as a generated/derived
   -- column only if some other unseen consumer reads it directly (grep
   -- first — at plan time, none does), otherwise drop it in the same
   -- migration to avoid two sources of truth.
   ```
4. **`ConventionCandidate` contract gains the same fields**: `category:
   z.string()`, `evidence_line_start`/`evidence_line_end: z.number().int()
   .nullish()`, `status: z.enum(['pending','accepted','rejected'])`
   replacing the bare `accepted: z.boolean()`. `PluginConvention` (export
   bundle) gains `category` too, for symmetry — the export/import round-trip
   should carry it.
5. **Category is a fixed small vocabulary, not free text from the model** —
   `'naming' | 'error-handling' | 'api-shape' | 'imports' | 'testing' |
   'security' | 'formatting' | 'architecture' | 'type-safety'`
   (`'type-safety'` added for Decision 10's tsconfig-derived candidates —
   `strict`/`noImplicitAny`/etc. don't read naturally as `'formatting'` or
   `'error-handling'`). The prompt constrains the model to this enum
   (structured output schema, not a hint) so the UI can group/filter by
   category and the generated skill body can be organized by section —
   free-text categories would fragment into near-duplicates ("error
   handling" vs "errors" vs "exception handling") and defeat that.
6. **Default candidate state matches the mockup: `accepted`, not
   `pending`.** Every candidate that survives evidence verification starts
   `status: 'accepted'` and the UI leads with "Deselect all" / reject-to-
   prune, not an opt-in triage. This is a conscious quality tradeoff — see
   "Product improvement: confidence-gated defaults" below for a proposed
   refinement that keeps the mockup's UX but improves the average quality
   of what ends up pre-accepted.
7. **Model selection reuses the existing per-feature registry — don't
   hardcode a model in the module.** `contracts/platform.ts:14-79` already
   defines `FeatureModelId` (including `'conventions'`, unused until now)
   and `FEATURE_MODELS`, and `server/src/modules/settings/feature-models.ts`
   already exposes `resolveFeatureModel(container, workspaceId,
   'conventions')` (workspace override → registry default). The service
   calls that, not a hardcoded constant. **Found during foundation work**:
   the registry's shipped default for `'conventions'` was `openai`/
   `gpt-5.4` — a flagship, non-cheap model, contradicting the assignment's
   explicit "дешева модель" requirement. Changed (in both vendor copies of
   `contracts/platform.ts`) to `openrouter`/`deepseek/deepseek-v4-flash`
   (`server/src/adapters/llm/pricing.ts:29` — already priced at
   $0.14/$0.28 per 1M tokens, the CI runner's existing cheap-model
   precedent). Still user-overridable per workspace via Settings, same as
   every other feature in this registry. Called via
   `LLMProvider.completeStructured<RawConventionCandidate[]>()` — same
   shape `openai.ts:88` already exposes — with a zod array schema so the
   model's JSON is validated before it ever reaches the evidence-
   verification step (malformed rows are dropped there too, same "discard
   silently" rule).
8. **A skill built from accepted conventions is `source: 'extracted'`**
   (the contract value that's existed since the Skills feature shipped but
   has never been produced by any code path — `.../contracts/knowledge.ts:118`).
   Unlike `imported_url`/`community` (created `enabled: false`, "needs
   vetting"), `extracted` skills are created **`enabled: true`** — by the
   time `POST /skills` is called here, a human has already accepted/rejected
   every underlying candidate individually *and* had a final editable
   preview of the assembled body before saving (mirrors `source: 'manual'`'s
   reasoning: a human provided this content to the app directly, just
   through a different UI). This is a genuine new decision (not previously
   made in `docs/skills-feature-plan.md`, which only covered manual/
   imported_url/community) — flagged in Open Questions in case that read is
   wrong.
9. **One skill per extraction batch, not one skill per candidate.** The
   mockup's modal ("Merged from 3 accepted conventions… Create skill") bundles
   all currently-accepted candidates from one repo into a single
   `repo-conventions`-style skill (default name: `{repo-slug}-conventions`,
   editable). Re-running "Create skill" later after accepting more
   candidates creates a **new** skill version via the existing `PUT /skills/
   :id` versioning (if the user reopens the same skill) rather than a second
   skill — decided for the common case; a "create a second, differently-
   scoped skill from a subset" flow is not built (Open Questions).

10. **Deterministic config-rule extraction ships in v1, as a second,
    parallel candidate source alongside the LLM pass — not a "maybe later"
    idea.** `eslint`/`tsconfig`/`prettier` config values are already
    structured, machine-readable rules; parsing them needs no model call and
    can't hallucinate, which directly answers the prompt's own worry that
    "більшість знахідок дійсно можуть бути невалідними" for the pool that
    matters most (the config-derived one is never invalid by construction).
    - **New field: `origin: 'model' | 'config'`** on `ConventionCandidate`
      and the `conventions` table (see Decision 3's migration, which now
      includes this column). Lets the UI badge a card ("From config" vs
      "AI-detected") and lets the PR's findings-quality report break down
      numbers by source.
    - **Config-derived candidates skip evidence verification entirely** —
      their "evidence" *is* the config file, read directly, so there's
      nothing to fuzzy-match; they go straight to `status: 'accepted'`,
      `confidence: 1.0`. The verification algorithm below applies only to
      `origin: 'model'` candidates.
    - **Never `require()`/`import()` a config file** — flat configs
      (`eslint.config.js`, `prettier.config.js`) are parsed by static
      text/regex extraction of the `rules`/config object literal, same as
      this codebase's existing rule for archive imports ("nothing in the
      archive is ever executed or shelled out to", `docs/skills-feature-
      plan.md`'s Decision 4). JSON-shaped configs (`.eslintrc.json`,
      `tsconfig.json`, `.prettierrc`) are parsed with `JSON.parse` — safe,
      no code execution risk to begin with.
    - **Mapping (v1 scope, extend later if useful)**:
      - `tsconfig.json` `compilerOptions`: `strict`/`noImplicitAny`/
        `noUnusedLocals`/`noUncheckedIndexedAccess` set `true` → one
        `'type-safety'` candidate each (e.g. "noImplicitAny is enforced —
        don't add untyped `any` parameters").
      - `.eslintrc*`/`eslint.config.*` `rules`: any rule set to `"error"`
        or `2` → one candidate, category inferred from a small hardcoded
        rule-name→category table (e.g. `no-explicit-any` → `type-safety`,
        `import/order` → `imports`, `no-console` → `error-handling`,
        anything unmapped → `formatting`); rules set to `"warn"`/`0`/`off`
        are skipped (v1 only surfaces enforced rules).
      - `.prettierrc*`/`prettier.config.*`: `semi`/`singleQuote`/
        `printWidth`/`trailingComma` → one `'formatting'` candidate each,
        only for keys actually present (no candidate for prettier defaults
        the repo never explicitly set).
    - `evidence_path` = the config file's repo-relative path;
      `evidence_line_start`/`end` = the line(s) of that specific key,
      located the same way model-derived evidence is (text search within
      the already-read config file content) — so config-derived cards get
      real, clickable `githubBlobUrl` links too, same as model-derived ones.

## Server: evidence verification algorithm

Applies only to `origin: 'model'` candidates (Decision 10's `origin: 'config'`
candidates skip this — see above). Runs entirely in code, once per raw
candidate:

```
for candidate in rawCandidates:
  content = repoIntel.getFileContent(repoId, candidate.evidence.file)
  if content is null:              → discard ("file not found in clone")
  needle = normalize(candidate.evidence.snippet)
  match = exactSubstringSearch(content, needle)
         ?? fuzzyLineWindowSearch(content, needle, threshold=0.9)
  if match is null:                → discard ("snippet not found")
  candidate.evidence_line_start/end = match.lineRange
  category = candidate.category if in CATEGORY_ENUM else discard ("bad category")
  keep candidate, status: 'accepted'
```

`fuzzyLineWindowSearch` slides the snippet's line count as a window over the
file and scores by normalized Levenshtein or a simpler token-overlap ratio
(no new dependency needed — a ~20-line pure-TS helper is enough at this
sample size: ≤12 files + 3 config files per run).

## Server: new `conventions` module (`server/src/modules/conventions/`)

Mirrors `skills`'s layout.

- **`repository.ts`**: `list(repoId, filters?)`, `getById`, `bulkInsert`
  (post-verification candidates), `updateStatus(id, status)`, `updateRule`
  (edit a candidate's rule/category text — "едитувати конкретний інсайт"),
  `deleteAllForRepo(repoId)` (used by Re-scan, see below).
- **`service.ts`**:
  - `extract(repoId)`:
    1. Gather samples: `repoIntel.getConventionSamples(repoId, 12)` (already
       excludes tests/configs/migrations) **+** explicitly read `eslint.
       config.*`/`.eslintrc*`, `tsconfig*.json`, `.prettierrc*`/`prettier.
       config.*` from the clone root if present (deterministic file-path
       probe, not ranked — configs are always relevant regardless of rank).
    2. **Run the deterministic config parsers (Decision 10) over whichever
       config files were found** → `origin: 'config'` candidates, `status:
       'accepted'`, `confidence: 1.0`, no verification needed (see below).
       This step has no model call and runs even if the LLM call in step 3
       fails or is skipped — config-derived candidates shouldn't be blocked
       by an LLM outage.
    3. Build the cheap-model prompt: system instructions (constrained
       category enum, "cite exact code you can see, don't invent line
       numbers, one rule per finding") + the sample files' content + the
       parsed config contents (given to the model as extra context, even
       though config rules are also handled deterministically — helps the
       model avoid restating them and focus on unwritten conventions).
    4. `completeStructured()` → raw `origin: 'model'` candidates.
    5. Run evidence verification (above) on the `origin: 'model'` pool only
       → surviving candidates. Merge with step 2's `origin: 'config'` pool
       before persisting.
    6. **Re-scan semantics**: a re-scan replaces the repo's `pending`-origin
       candidate set — i.e., delete existing rows with `status IN
       ('pending')`? No — simpler and safer: **Re-scan never touches rows
       the user already accepted or rejected**; it only inserts newly-found
       candidates not already present (dedup by normalized `rule` text +
       `evidence_path`), so a re-scan can't silently undo a user's prior
       triage. (Matches the mockup's "Re-scan" being a top-level action next
       to an already-triaged list, not a destructive reset.)
  - `updateCandidate(id, {rule?, category?, status?})` — the "едитувати
    конкретний інсайт" + accept/reject actions.
  - `buildSkillDraft(repoId, candidateIds)` — assembles the default Markdown
    body (one `##` section per accepted candidate: heading = slug of the
    rule, body = rule text + fenced evidence snippet + a "Detected in
    `file:line`" line, matching the modal mockup's generated text almost
    verbatim) + a default name/description — returned to the client for the
    modal's *editable* preview, not yet persisted.
  - `createSkillFromCandidates(repoId, { name, description, body, type,
    enabled }, candidateIds)` — calls `SkillsService.create()` with
    `source: 'extracted'` (Decision 8), then nothing else — **linking to an
    agent is a separate, existing step** done from the Agent Editor's
    Skills tab (Decision 9 keeps this module's job at "produce the skill,"
    not "also decide which agent gets it" — matches "прилінкуйте його до
    агента (механізмом з лабораторної)" reading it as *reusing* that
    mechanism, not reimplementing agent-selection here).
- **`routes.ts`**:
  ```
  POST   /repos/:id/conventions/extract        run extraction (sync; see perf note below)
  GET    /repos/:id/conventions                list (filterable by status/category)
  PATCH  /conventions/:id                      { rule?, category?, status? } — accept/reject/edit
  POST   /repos/:id/conventions/skill-draft    { candidate_ids } → draft {name, description, body}
  POST   /repos/:id/conventions/skill          { candidate_ids, name, description, body, type, enabled } → Skill
  ```
- **`helpers.ts`**: `toConventionDto`, `normalizeSnippet`,
  `fuzzyLineWindowSearch`, `slugifyRule`, `buildSkillBody`, plus Decision
  10's parsers — `parseTsconfigStrictness`, `parseEslintRules` (JSON
  configs via `JSON.parse`; flat `.js`/`.mjs` configs via static regex
  extraction of the `rules: {...}` object literal — **never
  `require()`/`import()`ed**), `parsePrettierConfig` — each returning
  `origin: 'config'` candidates with `evidence_line_start/end` already
  resolved (same line-search helper the verification step uses).
- **`constants.ts`**: `CONVENTION_CATEGORIES` (the fixed enum, Decision 5),
  `SAMPLE_FILE_COUNT = 12`, `CONFIG_FILE_CANDIDATES` (eslint/tsconfig/
  prettier filename globs), `EVIDENCE_FUZZY_THRESHOLD = 0.9`,
  `ESLINT_RULE_CATEGORY_MAP` (Decision 10's rule-name → category table).

**Perf note**: extraction is one LLM call over ≤15 files — should comfortably
finish inside a normal HTTP request/response cycle (no job queue needed,
unlike PR review's async run model). If the sample set grows later, revisit
async + polling, mirroring `reviews`'s existing run pattern — not needed at
this scope.

## `repoIntel` facade addition

`server/src/modules/repo-intel/service.ts`: export the existing private
`readClone` (line 797) as a public facade method:

```ts
/** Read one file's content from the repo's clone, or null if absent/unindexed. */
async getFileContent(repoId: string, file: string): Promise<string | null> {
  const repo = await this.repo.getRepoBasics(repoId);
  if (!repo || !repo.clonePath) return null;
  return readClone(repo.clonePath, file);
}
```

Update `repo-intel/README.md`'s facade list (line 43 area) to add this entry
next to `getConventionSamples`.

## Contracts to update (both `server/src/vendor/shared` **and**
`client/src/vendor/shared` — this repo's non-default hand-copy convention)

- `contracts/knowledge.ts`: `ConventionCandidate` — add `category:
  z.enum(CONVENTION_CATEGORIES)`, `evidence_line_start`/`evidence_line_end:
  z.number().int().nullish()`, `origin: z.enum(['model','config'])`
  (Decision 10), replace `accepted: z.boolean()` with `status:
  z.enum(['pending','accepted','rejected'])`.
- `contracts/productionize.ts`: `PluginConvention` — add the same `category`
  and `origin` fields for export/import round-trip symmetry.
- New request/response DTOs: `ExtractConventionsResponse` (`{ candidates:
  ConventionCandidate[], sample_file_count: number, scanned_at: string }`),
  `SkillDraftFromConventions` (`{ name, description, body, token_count }`),
  `UpdateConventionBody` (`{ rule?, category?, status? }`).

## Client: routes & pages

- `client/src/vendor/ui/nav.ts:29-35` — un-comment/wire a `{ key:
  "conventions", label: "Conventions", icon: "ListChecks", href:
  "/repos/{lastViewedRepoId}/conventions" }` entry. **No global repo-switcher
  chrome is built** (the mockup's sidebar repo card implies one, but nothing
  in this codebase provides that primitive today — building it is a
  separate, larger UI investment out of scope for this feature). Pragmatic
  resolution: the nav entry routes to `/repos` (existing repo list) if no
  repo is in context, and the repo detail area (next to the existing
  `pulls` tab under `/repos/[repoId]/`) gets a "Conventions" sub-link — this
  reuses the `/repos/[repoId]/…` nesting this codebase already has instead
  of inventing new global-selector chrome. Flagged as a scope call, not
  hidden — see Open Questions if a real repo switcher turns out to be
  wanted.
- `client/src/app/repos/[repoId]/conventions/page.tsx` — header (repo name,
  "Detected from N sample files · last scan …", Re-scan button), "Deselect
  all" + "N of M accepted" counter bar, "Create skill" button (disabled
  when 0 accepted), candidate list.
- **`ConventionCandidateCard`** (`_components/ConventionCandidateCard/`) —
  directly mirrors `FindingCard`'s structure (`client/src/app/repos/
  [repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx`): reuses
  `MonoLink`, `ConfidenceNum`, `CategoryTag` from `@devdigest/ui`, and
  `githubBlobUrl(repoFullName, lastIndexedSha, evidence_path,
  evidence_line_start, evidence_line_end)` for the clickable evidence path —
  **this is the concrete mechanism satisfying "клік веде до файла з кодом на
  GitHub."** Rule title is inline-editable (click to edit, matching "едитувати
  конкретний інсайт"); Accept/Reject buttons call `PATCH /conventions/:id`.
- **`CreateSkillFromConventionsModal`** — on open, calls `POST /repos/:id/
  conventions/skill-draft` with the currently-accepted candidate ids to
  prefill Name/Description/Body (matching the mockup's "Merged from N
  accepted conventions… Everything below is editable" banner exactly);
  reuses the same code-editor primitive the Skill Config tab already uses
  (`@uiw/react-textarea-code-editor`, per `docs/skills-feature-plan.md`'s
  "New client dependencies") for the body field; Create calls `POST /repos/
  :id/conventions/skill`; on success, shows a toast/link to the new skill's
  `/skills/:id` page where the user attaches it to an agent via the
  **existing** Skills tab — no new "pick an agent" step is built here
  (Decision 9).

## Client: hooks

New `client/src/lib/hooks/conventions.ts`: `useConventions(repoId)`,
`useExtractConventions(repoId)` (mutation, POST .../extract),
`useUpdateConvention()` (PATCH), `useSkillDraftFromConventions(repoId)`,
`useCreateSkillFromConventions(repoId)`.

## Product improvement ideas (the bonus ask)

Concrete, scoped ideas to raise recall/precision beyond the baseline single-
pass-over-12-files design above, roughly ordered by effort. **Deterministic
config-derived conventions (the strongest of these ideas) has been promoted
out of this list and into core v1 scope — see Decision 10.** The remaining
ideas are still deferred/optional:

1. **Confidence-gated defaults**, refining Decision 6: instead of *every*
   surviving candidate defaulting to `accepted`, only default candidates
   with `confidence ≥ 0.8` to `accepted`; candidates in `[0.5, 0.8)` default
   to `pending` (shown, not pre-accepted) so genuinely marginal findings
   don't sneak into a skill via a "Deselect all"-style bulk flow. Keeps the
   mockup's overall interaction model (bulk accept/reject) while addressing
   the prompt's own observation that "більшість знахідок дійсно можуть бути
   невалідними."
2. **Corroboration count as a second confidence signal, computed in code.**
   After the model proposes a rule from *one* file, grep the rest of the
   *already-indexed* repo (not just the 12 samples — `repo-intel`'s full
   symbol/file index is available) for the same pattern (e.g., a regex/
   ast-grep pattern derived from the rule's evidence shape) and surface an
   actual count ("held in 9/11 similar call sites") next to the model's
   self-reported confidence. This turns confidence from "the model's guess"
   into a partly-falsifiable, code-checked number — directly addresses
   "кращої якості" findings, not just more of them.
3. **Stratified sampling instead of pure top-rank.** `getConventionSamples`
   returns the top-12 by PageRank, which tends to cluster around a few
   central modules (routers, the DB client, shared utils) and can starve
   whole categories (e.g., no test file ever ranks highly, so a
   `'testing'`-category convention is structurally unlikely to surface).
   Propose a stratified variant: reserve slots across a few path-prefix
   buckets (`src/api|routes`, `src/**/*.test.*`, `src/lib|utils`, top-rank
   fill for the rest) so every major category has a chance to be evidenced.
   This is a `repo-intel` facade change (a `getConventionSamplesStratified`
   variant or an `opts.strata` param on the existing method), not a UI
   change.
4. **Dedup near-duplicate candidates before verification.** Multiple sample
   files often yield near-identical rules ("always use async/await" found
   in 3 files) — cheap string-similarity clustering on the `rule` text
   (e.g. token-set Jaccard, no new dependency) merges these into one
   candidate with multiple evidence locations, instead of 3 near-duplicate
   cards competing for the user's attention.
5. **Negative memory across re-scans.** Track rejected candidates' rule
   signatures (a hash of normalized rule text) per repo; a later "Re-scan"
   filters newly-proposed candidates against that set so a rejected finding
   doesn't keep resurfacing verbatim — respects the user's prior triage
   decision instead of re-litigating it every scan.

Not all of these need to ship in v1 — (1) is cheap and high-value enough to
seriously consider including in the first pass alongside Decision 10;
(2)–(5) are good follow-ups to mention in the PR description as
"considered, deferred."

## API Contract Reviewer — workstream (content + demo, not new app code)

Everything the agent/skill CRUD, import, and linking needs already exists
(`docs/skills-feature-plan.md` status: implemented). This workstream is:

1. **Create the agent** via the existing Agent Editor: name "API Contract
   Reviewer", a system prompt describing its job (flag breaking changes to
   public API/route contracts in a diff — signature changes, removed/
   renamed response fields, status-code changes, removed routes — cite
   `file:line`, propose a semver-correct fix or a deprecation path instead
   of silent removal).
2. **Write 4 skill bodies**, each: a directive one-line rule + a **Good**
   example diff/snippet + a **Bad** example diff/snippet + what the agent
   should say when it sees the Bad pattern. Draft content below — ready to
   paste into the Skill Config tab, or into a `.md` file for the "From
   file" import path.
3. **Attach at least one skill via the Import path** (file upload, since
   these are drafted as standalone `.md` below — satisfies "принаймні один
   заведіть через імпорт"), the rest via direct paste/creation.
4. **Link all 4 to the agent** via the Agent Editor's Skills tab (checkbox +
   drag-order — the existing mechanism).
5. **Run the control experiment**: a PR that renames a response field or
   changes a route signature, reviewed twice — skills unchecked (agent
   should miss it or pass generically) vs. skills checked (agent should
   flag the breaking change, citing the skill's rule). This exactly mirrors
   `docs/skills-feature-plan.md`'s own "API Contract" acceptance-script
   scenario (that doc names this same agent as its second seed example) —
   reuse that PR/diff if it was already prepared for this branch; otherwise
   author a small synthetic one (e.g. rename `userId` → `user_id` in a JSON
   response, or change a route from `PUT /users/:id` to `PATCH /users/:id`).

### Draft skill bodies

**`breaking-change.md`**
```markdown
# breaking-change

Flag any change to a **publicly-reachable route or exported contract** that
an existing caller could not safely ignore: removed/renamed route, removed/
renamed request or response field, changed field type, changed required-ness
of a field, changed status code for an existing success/error path.

Cite the exact `file:line` of the change. If found, state what breaks for
existing callers and propose either (a) a backward-compatible alternative,
or (b) that this must ship as a major version bump with a deprecation
window (see `semver-discipline` / `deprecation-policy`).

**Good** (non-breaking — additive):
    // Before
    interface UserResponse { id: string; email: string }
    // After
    interface UserResponse { id: string; email: string; createdAt?: string }
Adding an **optional** field is safe. No comment needed.

**Bad** (breaking — silently renamed):
    // Before
    interface UserResponse { id: string; userId: string }
    // After
    interface UserResponse { id: string; user_id: string }
Flag: "`userId` renamed to `user_id` in `UserResponse` (api/users.ts:14) —
existing clients reading `.userId` will get `undefined`. This is a breaking
change; either keep `userId` and add `user_id` alongside it, or bump the
major version and document the rename in a migration note."
```

**`response-schema.md`**
```markdown
# response-schema

Flag any change to a response body's **shape**: a field's type changes, a
field becomes optional→required or required→optional, a field is removed,
or a nested structure is flattened/re-nested. Diff the shape mentally
against the PR's stated intent — a shape change that isn't called out in
the PR description is a strong signal it's accidental.

**Good**:
    // Before: items: Item[]
    // After:  items: Item[]  (unchanged; new `meta.total` field added)
No flag — additive, backward compatible.

**Bad**:
    // Before: { items: Item[] }
    // After:  { data: { items: Item[] } }
Flag: "Response shape changed from `{ items }` to `{ data: { items } }` at
`routes/items.ts:41` — every existing consumer's `response.items` access
breaks. If this is intentional, it needs a version bump (see
`semver-discipline`) and ideally both shapes served during a transition
window (see `deprecation-policy`)."
```

**`semver-discipline.md`**
```markdown
# semver-discipline

Any change matched by `breaking-change` or `response-schema` requires a
**major** version bump of the API package/spec version, not minor or patch.
If the PR doesn't touch a version file (e.g. `package.json`, an OpenAPI
`info.version`, or this repo's own API version constant) alongside a
breaking change, flag the missing bump explicitly — don't just flag the
breaking change itself twice.

**Good**: a field is removed AND `openapi.yaml`'s `info.version` goes from
`2.3.1` → `3.0.0` in the same PR.

**Bad**: a field is removed, `info.version` stays `2.3.1`, or bumps only to
`2.4.0`. Flag: "This removes `UserResponse.legacyId`, a breaking change —
`info.version` must bump to a new major (currently patch-bumped to 2.3.2),
per semver."
```

**`deprecation-policy.md`**
```markdown
# deprecation-policy

A field/route being retired must go through a deprecation window, not a
silent removal in the same PR: mark it deprecated (a `@deprecated` doc
comment, or an explicit `deprecated: true` in the response/OpenAPI spec),
keep serving it, and only remove it in a later, separate PR after the
window has passed. A PR that removes something with no prior deprecation
marker anywhere in the codebase is the failure mode to catch.

**Good**:
    /** @deprecated use `emailAddress` instead. Removal planned v4.0. */
    email?: string;
    emailAddress: string;
Both served; old field marked, not removed.

**Bad**: `email` field deleted outright, no prior `@deprecated` marker found
anywhere in history/codebase for it. Flag: "`email` is removed with no
deprecation period — add it back as `@deprecated`, keep serving both fields
for at least one release, and remove in a follow-up PR."
```

## Acceptance criteria — mapping

| Criterion | Satisfied by |
|---|---|
| Demo video: Conventions Extractor in action + API Contract experiment | Manual — see Demo script below |
| Open PR with a good description | Manual — see PR description outline below |
| Conventions Extractor gives results on the UI | `/repos/[repoId]/conventions` page + `extract` endpoint |
| From accepted candidates, 1+ skills can be created; rejected never reach the skill | `status` filter in `buildSkillDraft`/`createSkillFromCandidates` only ever reads `status: 'accepted'` rows |
| Every candidate has real-code evidence; click → GitHub | Evidence-verification algorithm (discards unverifiable) + `githubBlobUrl` in `ConventionCandidateCard` |
| Generated skill can be linked to an agent and run on review | Reuses existing Skills-tab linking + `run-executor.ts` wiring (already implemented) |
| API Contract Reviewer with skills catches a breaking change it misses without | Control experiment in the workstream above |

## Demo video — shot list

1. Open a repo, click "Conventions", show empty state, click "Extract"/"Re-
   scan".
2. Candidate list populates; click one evidence path → new tab opens on the
   real GitHub blob at the right line(s).
3. Reject one candidate, edit another's rule text inline.
4. Click "Create skill" → show the pre-filled, editable modal → Save.
5. Navigate to the new skill's page briefly, then to an agent's Skills tab,
   check the new skill on.
6. Open the API Contract Reviewer agent (or create it live, compressed) —
   show its 4 skills, one of them added via the Import (file) path.
7. Run the breaking-change PR through review with all its skills **off** —
   show the pass/miss.
8. Toggle skills **on**, re-run — show the flagged breaking-change comment,
   optionally the trace drawer's `## Skills / rules` block from
   `docs/skills-feature-plan.md`'s existing wiring.

## PR description outline

- Summary: what Conventions Extractor does, one line per step (extract →
  verify → accept/reject/edit → create skill → link → review).
- **Findings quality report** (explicitly requested by "Як перевірити"): run
  the extractor on 2-3 real repos, report raw-candidate count → verified-
  survivor count → user-accepted count, **broken down by `origin: 'model'`
  vs `'config'`** (Decision 10) since the two pools have very different
  precision profiles by construction, with 2-3 examples of correctly
  discarded/rejected model-derived candidates and 2-3 examples of genuinely
  useful ones (from either pool) that made it into a skill — this is the
  "коротким звітом по якості знахідок" the acceptance check explicitly
  asks for.
- Link back to this doc (`docs/conventions-extractor-plan.md`), per this
  repo's cross-reference convention.
- API Contract Reviewer section: the 4 skills, the control-experiment
  before/after, link to the demo video.

## Suggested build order

1. Migration (`0014_add_convention_fields.sql`) + schema changes.
2. Contracts (both vendor copies) + `repoIntel.getFileContent`.
3. `server/src/modules/conventions/` — verification helpers first (pure
   functions, easiest to unit-test), then Decision 10's config parsers
   (also pure functions, also easy to unit-test against fixture configs),
   then repository/service/routes wiring both pools together.
4. Server tests: evidence verification (exact + fuzzy match + discard
   cases), config parsers (fixture `.eslintrc.json`/`tsconfig.json`/
   `.prettierrc` → expected candidates; a flat `eslint.config.js` fixture
   to confirm regex extraction works **and** that the file is never
   `require()`d/executed), extract → verify → list round trip (asserting
   both `origin` pools land correctly), skill-draft/create-skill candidate
   filtering (rejected never included).
5. Client hooks + `/repos/[repoId]/conventions` page + `ConventionCandidateCard`
   (reusing `FindingCard`'s patterns) + `CreateSkillFromConventionsModal`.
6. Nav wiring.
7. Manual: run extraction against a real indexed repo, write the PR's
   findings-quality report from real output (not synthetic numbers).
8. API Contract Reviewer workstream: create agent, add the 4 skills (one
   via import), link, prepare/confirm the breaking-change demo PR, run the
   control experiment, record the demo video.
9. Open the PR; the repo's own `pr-self-review` skill gate applies per
   `AGENTS.md`'s session protocol once a real PR exists.

## Testing plan

- `server/test/conventions.test.ts` — `normalizeSnippet`/`fuzzyLineWindowSearch`
  (exact match, fuzzy match above/below threshold, no match), `slugifyRule`,
  `buildSkillBody` (section-per-candidate shape), Decision 10's
  `parseTsconfigStrictness`/`parseEslintRules`/`parsePrettierConfig`
  (fixture configs in, expected `origin: 'config'` candidates with correct
  category/line numbers out; a fixture flat `eslint.config.js` containing a
  deliberately side-effecting top-level statement, asserting it never runs).
- `server/test/conventions.it.test.ts` — extract → candidates persisted only
  if verified; re-scan doesn't touch already-triaged rows; re-scan dedups
  against existing rule+evidence_path; `createSkillFromCandidates` only
  bundles `status: 'accepted'` rows even if other ids are passed in
  (defense in depth, not just a client-side filter).
- `client`: `ConventionsPage.test.tsx` (extract → list → accept/reject →
  create-skill flow, `fetch` mocked per this codebase's convention),
  `ConventionCandidateCard.test.tsx` (evidence link URL construction,
  mirroring any existing `FindingCard.test.tsx` assertions).

## Open questions

- **`extracted`-skill `enabled: true` default (Decision 8)** — reads
  consistent with `manual`'s reasoning, but wasn't decided in the original
  Skills feature spec; worth a quick gut-check before implementation locks
  it in, since it's a new trust-model branch.
- **Repo switcher** — the mockup's sidebar repo card isn't built anywhere in
  this codebase yet; this plan deliberately scopes around it (nav → `/repos`
  → per-repo Conventions sub-link) rather than building new global chrome.
  If a real switcher is wanted, that's a separate, larger piece of work.
- **One skill per batch vs. per-candidate multi-skill** (Decision 9) — the
  prompt's "Також, як варіант, можна обернути цю фічу в ширшому напрямку і
  створювати багато скілів зі знахідок" floats a broader multi-skill
  direction (e.g. one skill per category) as an optional variant; this plan
  picks the mockup-confirmed single-bundle flow as v1 and leaves per-
  category multi-skill as a documented, not-built extension.
- **Which repo(s) to run the real extraction against for the PR's quality
  report** — needs an actual indexed repo at implementation time; not
  knowable at planning time.
