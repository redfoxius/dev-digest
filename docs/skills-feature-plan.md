# Agent Skills — feature spec

**Status:** implemented — schema, contracts, server `skills` module,
`agents` module changes, `run-executor.ts` wiring, `reviewer-core` trust
wrapping, client hooks, `/skills` pages, and the Agent Editor Skills tab
are all built, orchestrated via a multi-agent `Workflow` (4 server agents
in parallel → 1 hooks agent → 2 client agents in parallel), then verified
directly: `pnpm typecheck` clean and all tests green across all three
packages (server: 199 unit + 50 integration; reviewer-core: 26; client: 99).
**Not done**: the acceptance script's live walkthrough (seeding the two
demo agents + skills, running the control experiment, eyeballing the trace
drawer in a browser) and the `pr-self-review` auto-invoke toggle — both
need a running app / human judgment call, not just code.

## Context

DevDigest's own review Agents already support attaching reusable, ordered
text/markdown blocks — the schema calls them **Skills**. Skills are pure
text/config, never executable ("Скіли не можуть нічого використовувати,
тільки текст конфігурації"), reusable across agents, user-editable in the
UI, and the Agent Editor needs a way to attach/enable/reorder them, where
order = prompt block order.

**The single most important finding of this spec's research phase**: this
is not a greenfield feature. Per this repo's own stated convention
(`AGENTS.md`: *"DB schema already ships every future-lesson table, empty —
later lessons fill them"*), a large share of the Skills feature already
exists — schema, contracts, half the server API, the prompt-assembly
mechanics, ready UI primitives, even i18n copy for both the standalone
Skills page *and* the Agent Editor's Skills tab. `server/src/modules/
agents/repository.ts:9-11`'s own doc comment says it plainly: *"Owns
`agents`, `agent_versions`, and the `agent_skills` link table (shared with
A1's skills repository, but A2 owns the agent side...)"* — a dedicated
skills module was always the plan; it just hasn't been built. This spec is
scoped as **"finish what was started,"** not "design from scratch."

The design (`working-screenshots/Agent Editor _ Skills.png` +
`Skill Editor _ {Config,Preview,Evals,Stats,Versions}.png` +
`Skills _ Community search drawer.png`) confirmed most of the existing
(previously unused) i18n copy verbatim and corrected a few assumptions from
the first pass of this spec — see "What the design confirms/changes" below.

## What the design confirms / changes vs. the first pass

1. **Sidebar reorganizes into three sections** — WORKSPACE (Pull Requests,
   Onboarding Tour, Project Context), **SKILLS LAB** (Skills, Agents,
   Conventions, Eval Dashboard), GLOBAL (Memory, Multi-Agent Review, Agent
   Performance, CI Runs). Today's `client/src/vendor/ui/nav.ts` has exactly
   one section (`WORKSPACE`) with two items (`pulls`, `agents`) — confirmed
   by reading the file directly. **Only "Skills" + moving "Agents" into a
   new "SKILLS LAB" section are in scope here** — Conventions and Eval
   Dashboard are separate, not-yet-built lessons (matching the `conventions`
   /`memory`/`eval*` tables already sitting empty in the schema barrel).
   Don't build nav entries for those two now; leave room for them.
   `client/src/components/app-shell/helpers.ts:33`'s `activeKeyFor()`
   already special-cases `pathname.startsWith("/skills")` — confirms the
   route was anticipated.
2. **Agent Editor's Skills tab is ONE unified list, not
   attach-dropdown-plus-separate-list.** The mockup shows a single list
   containing **every skill in the workspace** — each row: drag handle,
   a `Checkbox` (not a `Toggle`!), the skill's name (mono font, kebab-case
   — visually identical to a Claude Code skill slug), and a colored type
   badge (`rubric`/`convention`/`security`/`custom`). Header: "Skills" +
   `{linked} of {total} enabled` pill (`agents.json`'s `skills.enabledCount`
   key, already written) + a "Filter skills…" input + the caption *"Order
   matters — earlier skills appear earlier in the assembled prompt. Toggle
   to attach"* (`agents.json`'s `skills.orderHint`, already written —
   note it literally says **"toggle to attach"**, confirming the checkbox
   *is* the attach action, not a separate step after a dropdown pick).
   **This changes the API shape**: instead of "attach via dropdown, then
   toggle enabled, then reorder," it's one surface where checking a
   previously-unlinked skill creates its `agent_skills` row (appended at
   the end of the current order) and unchecking sets `enabled: false`
   (row persists, keeps its `order`) — see "Server: `agents` module
   changes" below for the exact endpoint implication.
3. **The standalone `/skills` page is master-detail, exactly as the unused
   `skills.json` copy said** — confirmed by the actual mockup. Left: "+ Add
   Skill ▾" dropdown (3 items, matching `page.menu.{fromFile,fromUrl,
   community}`), search input, then a vertical list of skill rows (icon
   tinted by type color, name, a global `Toggle`, description, `[type
   badge][source icon+label]`, and a small performance-stats row —
   **out of scope, see below**). Right: skill detail, **5 tabs**: **Config
   | Preview | Evals | Stats | Versions** — only the first, second, and
   fifth are in scope for this spec (see the scope table below).
4. **The "From file" import path is paste-first, not upload-first** —
   `skills.json`'s `file.nameLabel/nameHint/bodyLabel/bodyPlaceholder`
   describe a plain **name + Markdown-body form**, not a file picker
   (`file.bodyHint`: *"Pasted content is wrapped as untrusted data — never
   executed as instructions."*). The user's original requirement
   (upload a `.md` file or an archive, extract the core, ignore executable
   parts) is **additive** on top of this — the "From file" tab needs both
   the existing paste form *and* a real `<input type="file">` /
   drag-and-drop affordance for `.md` and archives, converging on the same
   preview-then-confirm flow either way.
5. **Trust-wrapping should be simpler than the first pass proposed**: given
   `file.bodyHint` says *pasted* content is *also* wrapped as untrusted
   data, wrapping is clearly meant to be **universal** (every skill body,
   regardless of source), not conditional per-source. This is simpler than
   Decision 3 in the first pass: `assemblePrompt()` should wrap **every**
   skill body via `wrapUntrusted()` unconditionally — no `ReviewInput.skills`
   interface change needed at all, it stays a plain `string[]`. The
   disabled-until-vetted **gate**, by contrast, *is* source-dependent —
   see the revised Decision 3 below. The earlier idea of adding a 5th
   `SkillSource` value (`'imported_file'`) is **dropped** — `'manual'`
   covers typed, pasted, *and* uploaded-directly-by-the-user content
   equally (a human provided it directly to the app either way); only
   genuinely fetched-without-a-human-in-the-loop sources (`imported_url`,
   `community`) get the vetting gate.
6. **The Community "drawer" is really its own full search panel**, not a
   third tab squeezed into the small "Add a skill" drawer — distinct
   title/subtitle ("Search community skills" / "Import vetted skills from
   public repos" vs. the generic drawer's "Add a skill" / "Import from a
   file, a URL, or search vetted community skills"), language/tag filter
   chips (`All languages`/`TypeScript`/`security`/`performance`), and result
   cards (name, ★ stars, description, source repo, language tag, **+
   Import** button) — an exact match for the existing `CommunitySkill`
   contract (`name/repo/stars/lang/desc`) and `skills.json`'s `community.*`
   copy. Model this as **two separate client components**: a small
   `ImportSkillDrawer` (file + URL tabs) and a dedicated full-width
   `CommunitySkillsDrawer` (search + filters + result cards) — both
   reachable from the same "+ Add Skill" dropdown.
7. **`AgentCard` is already built for a skill count, just never wired.**
   Confirmed by reading the file directly:
   `client/src/app/agents/_components/AgentCard/AgentCard.tsx` already
   accepts a `skillCount?: number` prop and renders a `Badge icon="Sparkles"`
   with `t("card.skillCount", { count })` — but every call site
   (`AgentsListView.tsx:86`, `[id]/page.tsx:84`) passes `ag`/`onClick`/
   `onToggle` only, never `skillCount` — so the badge never renders today.
   Wiring this is now in scope (small: `GET /agents` needs a per-agent
   linked-and-enabled skill count).
8. **The skill body editor in the Config tab is a real line-numbered code
   editor** (filename tab "pr-quality-rubric.md", an "unsaved" pill, a live
   token count, syntax-highlighted headings) — **not** the plain `Textarea`
   `ConfigTab` uses for `system_prompt`. This is a genuinely new UI
   building block for this codebase; see "New client dependencies" below.
9. **The Versions tab needs a schema field the current `skill_versions`
   table doesn't have**: each version row shows a one-line human-readable
   **change summary** ("Tightened scope rule; cap at 5 high-signal
   findings") plus **Diff** and **Restore** actions (the current version
   shows neither, just a "Current" tag). `skill_versions` today is only
   `(skill_id, version, body, created_at)` — no summary field. See "Data
   model changes" below.
10. **Evals and Stats tabs are out of scope** — they belong to a separate,
    not-yet-built analytics/eval feature. The Evals tab is the same
    `eval_cases`/`eval_runs` domain already scaffolded with
    `owner_kind: 'skill'|'agent'` (`server/src/db/schema/eval.ts:12`,
    `EvalCase.owner_kind`) — a different lesson. The Stats tab (`USED BY N
    agents`, `PULL FREQUENCY`, `ACCEPT RATE`, `FINDINGS (30D)`, a findings-
    by-category donut) mirrors the already-contracted-but-unbuilt
    `AgentPerf`/`AgentPerfRow` (`productionize.ts:139-186`) applied to
    skills — same "later lesson" pattern, not core CRUD/injection work.
    The small stats row on each Skills-page list card (`3 agents / 71%
    pull / 74% accept`) is the same out-of-scope domain, **except** the
    plain "N agents" count, which is a trivial `COUNT(*) GROUP BY skill_id`
    on `agent_skills` — cheap enough to include if wanted, called out
    separately from the %-metrics.

## Decisions (final, after the design pass)

1. **UX shape: master-detail `/skills` page + a unified full-catalog list
   in the Agent Editor's Skills tab** — confirmed by the actual mockups,
   superseding the originally-described card-grid/create-or-import
   phrasing. No free-form "create a blank skill" entry point exists in
   the design (see Open Questions).
2. **`agent_skills` gains an `enabled` column** (per-agent link toggle,
   distinct from the skill's own global `enabled`) — confirmed exactly by
   the Agent-Editor-Skills-tab checkbox behavior ("toggle to attach").
3. **Trust, revised**: `assemblePrompt()` wraps **every** skill body via
   `wrapUntrusted()` unconditionally (no interface change to
   `ReviewInput.skills`, stays `string[]`) — matches `file.bodyHint`'s
   "pasted content is wrapped as untrusted data" applying even to
   directly-typed content. Separately, **only** `source ∈ {imported_url,
   community}` skills are created `enabled: false` ("needs vetting") until
   a human flips it on; `source: 'manual'` (typed, pasted, or a directly
   uploaded file/archive — a human provided it to the app either way) is
   enabled immediately. This directly serves *"чужий скіл — це чужі
   інструкції в промпті агента"* at the wrapping layer, and gates the
   *effect* of an import at the enablement layer — two independent axes,
   not one conditional rule.
4. **Archive import format: a Claude-Code-style skill package** — one main
   markdown file (the body) + optional supporting `.md` files, exactly the
   convention this session used for `.claude/skills/pr-self-review/
   {SKILL.md,examples.md}`. Non-markdown archive entries are read (to list
   their names) but never parsed as code or executed; the preview response
   surfaces them as an explicit "N file(s) ignored" notice.
5. **No new `SkillSource` value.** The first pass's proposed 5th value
   (`'imported_file'`) is dropped per Decision 3's revision above — file
   uploads are `source: 'manual'`.

## Skill Editor — tab scope

| Tab | In scope? | What it needs |
|---|---|---|
| **Config** | Yes | name/description/type fields, a real code-editor for the Markdown body (new dependency — see below), Enabled toggle, version badge, Save (with an optional one-line "what changed?" summary, see Decision on `skill_versions.summary` below) |
| **Preview** | Yes | Render the body via the existing `Markdown` primitive, captioned "Rendered as the reviewing agent receives it." — trivial, no new work beyond the component itself |
| **Versions** | Yes | List of `skill_versions`, newest first, each showing `v{n}`, a change summary, date, and Diff/Restore (current version: just a "Current" tag) |
| **Evals** | **No** | Separate eval-cases feature (`owner_kind: 'skill'`), not yet built anywhere; leave as a `mount.body`-style placeholder like the Agent Editor's own Evals/Stats/CI tabs |
| **Stats** | **No** | Separate Performance-analytics feature, mirrors the unbuilt `AgentPerf`; same placeholder treatment |

## Data model changes

- **New migration** (single file, next number `0013` per drizzle-kit's
  auto-slug convention or a hand-named `0013_add_skill_link_enabled.sql`
  like the `0001_add_agent_run_error.sql` precedent):
  ```sql
  ALTER TABLE "agent_skills" ADD COLUMN "enabled" boolean NOT NULL DEFAULT true;
  ALTER TABLE "skill_versions" ADD COLUMN "summary" text;
  ```
- **`server/src/db/schema/agents.ts`** — add `enabled: boolean('enabled').notNull().default(true)` to `agentSkills`.
- **`server/src/db/schema/skills.ts`** — add `summary: text('summary')` (nullable) to `skillVersions`. No change to `skills.source`'s literal union (Decision 5).
- No other schema changes.

## Server: new `skills` module (`server/src/modules/skills/`)

Mirror `server/src/modules/agents/`'s exact file layout
(`routes.ts`/`service.ts`/`repository.ts`/`helpers.ts`/`constants.ts`).

- **`repository.ts`**: `list(workspaceId, filters?)` (include a per-skill
  `linked_agent_count` via one grouped query alongside the main list query
  — the "fixed 2-query pattern, not N-query" convention already
  established for the PR list's findings/cost columns, see
  `docs/findings-by-severity-plan.md`), `getById`, `deleteById`, `insert`
  (+ snapshot v1 with `summary: 'Initial version'`), `update` (uses
  `isSkillConfigChange` — mirrors `agents/repository.ts:112-146`, comparing
  `name/description/type/body`, ignoring `enabled`; accepts an optional
  `summary` string for the snapshot, defaulting to `"Updated {changed
  field(s)}"` if omitted), `listVersions`, `getVersion`, `restoreVersion`
  (fetches the target version's `body`, calls `update()` with it — creates
  a *new* version whose body matches the old one, summary defaults to
  `"Restored from v{n}"` — never rewrites history in place).
- **`service.ts`**: business logic layer, plus the import pipeline:
  - `previewFileImport({ name?, body })` — the paste path (matches
    existing copy exactly): body required, name optional (derive from the
    first `# heading` if blank, matching `file.nameHint`).
  - `previewFileUpload(fileBuffer, filename)` — the new upload path: if
    `filename` ends in `.md`/`.markdown`, the whole buffer is the body; if
    it's an archive (`.zip`/`.tar`/`.tar.gz`), extract in-memory, the main
    `.md` file (root-level or named like the archive) is the body, other
    `.md` files become `evidence_files`, every non-markdown entry's name
    goes into an `ignored_files: string[]` for the preview response —
    nothing in the archive is ever executed or shelled out to.
  - `previewUrlImport(url)` — fetch server-side, same extraction rule as
    the paste path.
  - `listCommunitySkills(query?, lang?, tag?)` — returns `CommunitySkill[]`
    filtered by the drawer's search/chip state; source data is a **static
    curated seed**, hardcoded in this module (decided — no live registry
    fetch for this course-scope feature). Seed the four skills already
    shown in the design mockup, so the demo drawer matches the screenshots
    exactly:
    ```ts
    const COMMUNITY_SKILLS_SEED: CommunitySkill[] = [
      { name: 'owasp-top-10-review', repo: 'secdev/agent-skills', stars: 1240, lang: 'any', desc: 'Maps diff changes to the OWASP Top 10 with CWE references.' },
      { name: 'react-hooks-rules', repo: 'frontend-guild/skills', stars: 842, lang: 'TypeScript', desc: 'Detects conditional hooks, missing deps, stale closures.' },
      { name: 'sql-injection-gate', repo: 'secdev/agent-skills', stars: 690, lang: 'any', desc: 'Flags string-concatenated SQL and unparameterized queries.' },
      { name: 'a11y-jsx-audit', repo: 'a11y-collective/skills', stars: 318, lang: 'TypeScript', desc: 'Checks JSX for missing alt text, ARIA, and focus traps.' },
    ];
    ```
  - `confirmImport(candidate, source)` — persists with
    `enabled: source === 'manual' ? true : false`, `version: 1`.
  - `create(input)` — the direct-entry path (`source: 'manual'`, `enabled:
    true`) for **both** creation surfaces: the paste form inside "From
    file" (name+body *is* the final content, nothing to extract, no real
    preview step needed) **and** the standalone "+ New skill" button
    (decided — see "Client: routes & pages" below) which opens a blank
    Config-tab-shaped form directly, no drawer/preview/confirm at all,
    just fields + Save.
- **`routes.ts`**:
  ```
  GET    /skills                          list (workspace-scoped, filterable, w/ linked_agent_count)
  GET    /skills/:id
  POST   /skills                          create manually (paste path; source: manual)
  PUT    /skills/:id                      update (body: {..., summary?}) — versions on real change
  DELETE /skills/:id
  GET    /skills/:id/versions
  GET    /skills/:id/versions/:version
  POST   /skills/:id/versions/:version/restore
  POST   /skills/import/file/preview      multipart upload → { candidate, ignored_files }
  POST   /skills/import/file/confirm      → persists, enabled=true (manual)
  POST   /skills/import/url/preview       → { candidate }
  POST   /skills/import/url/confirm       → persists, enabled=false (imported_url)
  GET    /skills/community                → CommunitySkill[]
  POST   /skills/community/:name/import   → persists, enabled=false (community)
  ```
- **`helpers.ts`**: `toSkillDto`, `toSkillVersionDto`, `isSkillConfigChange`.
- **`constants.ts`**: `INITIAL_SKILL_VERSION`, `DEFAULT_SKILL_DESCRIPTION`,
  `MAX_ARCHIVE_BYTES`, `ALLOWED_MARKDOWN_EXTENSIONS`.
- **New dependencies**: `@fastify/multipart` (file/archive upload — matches
  the `@fastify/*` plugins already in use) + `adm-zip` (pure-JS, no native
  build step) for `.zip`; add `tar` (npm) too if `.tar.gz` support is
  wanted on day one. None of these exist in `server/package.json` today.

## Server: `agents` module changes

- **`repository.ts`**: `linkedSkills()`'s select adds `enabled`;
  **`setSkillEnabled(agentId, skillId, enabled)`** — upserts the
  `agent_skills` row (creating it with the next `order` if it doesn't
  exist yet, matching "checking an unlinked skill attaches it") or flips
  `enabled` on an existing row (never deletes on uncheck — the mockup's
  "toggle to attach" behavior needs the row, and its `order`, to persist
  across a later re-check).
- **`routes.ts`**: `PATCH /agents/:id/skills/:skillId { enabled: boolean }`
  — the per-row checkbox action. `POST /agents/:id/skills {skill_ids:
  [...]}` (already exists) keeps its full-replace-with-order-by-index
  semantics for drag-reordering, and should now accept **every** workspace
  skill's id in the desired order (not just linked ones) so a drag can
  reposition an unlinked (unchecked) row too.
- **`helpers.ts`**: any skill-link mutation (attach/detach via checkbox,
  reorder via drag) now calls `snapshotVersion()` the same way `update()`
  does — `AgentVersionConfig.skills` already exists specifically to record
  this for eval reproducibility, but `setSkills`/`linkSkill`
  (`agents/repository.ts:207-235`) don't trigger it today.

## Server: `run-executor.ts` wiring — the critical missing link

In `ReviewRunExecutor.runOneAgent()` (near the existing `callersDigest`/
`repoMap` build steps, `run-executor.ts:185-196`):

```ts
const linkedSkills = await this.agentsRepo.linkedSkills(agent.id);
const resolvedSkills = linkedSkills
  .filter((l) => l.enabled && l.skill.enabled)
  .map((l) => l.skill.body); // already ordered ascending by `order`
if (resolvedSkills.length) {
  runLog.info(`skills: ${resolvedSkills.length} attached`); // matches the
  // existing "repo map: N token(s) attached" / "callers digest: N …
  // attached" log-line convention at run-executor.ts:381,397 — this is
  // the exact log line the acceptance script below checks for.
}
```

then thread `...(resolvedSkills.length ? { skills: resolvedSkills } : {})`
into the existing `reviewPullRequest({...})` call (`run-executor.ts:
212-234`). Also fix the hardcoded `skills: null` in the failure-path trace
builder (`run-executor.ts:451`) to reflect `resolvedSkills` — found during
research, a small correctness fix unrelated to the rest of this spec.

## `reviewer-core`: universal untrusted-skill wrapping

Per the revised Decision 3, this is now a **small, self-contained** change
— no interface/type change to `ReviewInput.skills` or `PromptParts.skills`
(both stay `string[]`). In `assemblePrompt()` (`reviewer-core/src/
prompt.ts`), change the `skillsBlock` construction from
`parts.skills.join('\n\n')` to wrap each entry via the existing
`wrapUntrusted()` helper (already used for `specs`/`diff`/`callers`/
`repoMap`) before joining. Update the doc comment at `prompt.ts:42`
(currently *"trusted-ish; community skills should be sanitized upstream"*)
to state plainly that this function is where that now actually happens,
unconditionally, for every skill.

## Client: routes & pages

- **`client/src/vendor/ui/nav.ts`** — add a `"SKILLS LAB"` `NavGroup` with
  `{ key: "skills", label: "Skills", icon: "Sparkles", href: "/skills", gKey: "s" }`
  and move the existing `agents` item into it (leaving `WORKSPACE` with just
  `pulls`). Don't add Conventions/Eval Dashboard — out of scope.
- **`client/src/app/skills/page.tsx`** + **`client/src/app/skills/[id]/
  page.tsx`** — mirror `app/agents/page.tsx` + `app/agents/[id]/page.tsx`'s
  shell exactly: master list (left) + detail (right), tab state in `?tab=`.
- **`SkillsListView`** (`app/skills/_components/SkillsListView/`) — mirrors
  `AgentsListView`; `useSkills()`; renders `listItem.type`/`listItem.
  source`/`listItem.needsVetting` (copy already in `skills.json`);
  `EmptyState` using `page.empty.*` copy; "+ Add Skill" `Dropdown` with the
  3 `page.menu.*` items opening `ImportSkillDrawer` (file/URL) or
  `CommunitySkillsDrawer` (community) per the design split above. **Plus a
  separate "+ New skill" button** (decided — the design's import-only menu
  doesn't cover this, but a blank-slate creation path is worth having next
  to it, not folded into the dropdown): opens `SkillDetail`'s own Config
  tab directly in create mode (empty name/description, `type: custom`,
  empty body) — no drawer, no preview/confirm step, just the form + Save,
  calling `POST /skills` (`source: 'manual'`, `enabled: true`) on first
  save. New i18n copy needed here — `skills.json` has none for this
  (it wasn't designed for a blank-creation path), unlike everything else
  in this spec which reuses existing keys.
- **`SkillDetail`** (right pane) — 5-tab shell per the scope table; `Config`
  tab needs the new code-editor building block (see below) plus the
  optional "what changed?" summary prompt on save; `Preview` tab is a
  simple `Markdown` render; `Versions` tab lists `skill_versions` with
  Diff (client-side text diff between two fetched bodies — no new server
  endpoint needed) and Restore (`POST .../restore`) actions; `Evals`/`Stats`
  render the same `mount.body`-style placeholder the Agent Editor already
  uses for its own out-of-scope tabs.
- **`ImportSkillDrawer`** (`Drawer`, 2 tabs — File, URL): File tab has both
  the existing paste form (name + body textarea, matching `file.*` copy)
  **and** a new `<input type="file" accept=".md,.markdown,.zip,.tar,.tar.gz">`
  / drop-zone — either path converges on the same preview
  (`Markdown` render of the extracted body + an "N file(s) ignored" notice
  when applicable) → Confirm → `.../file/confirm`. URL tab: `TextInput` +
  `url.hint` copy → preview → confirm.
- **`CommunitySkillsDrawer`** (full-width panel, own title/subtitle) —
  search input, language/tag filter chips, result cards from `GET /skills/
  community` (name/★stars/desc/repo/lang), "+ Import" per row → confirm,
  still lands `enabled: false`.

## Client: Agent Editor — Skills tab (revised for the unified-list design)

- **`AgentEditor/constants.ts`** — append `{ key: "skills", labelKey:
  "editor.tabs.skills", icon: "Sparkles" }` to `TABS` (copy already exists:
  `agents.json`'s `editor.tabs.skills`).
- **`app/agents/[id]/page.tsx`** — add `"skills"` to `VALID_TABS`.
- **`AgentEditor.tsx`** — render `<SkillsTab agent={agent} />` when
  `tab === "skills"`.
- **New `SkillsTab`** (`AgentEditor/_components/SkillsTab/`): fetches the
  full workspace skill catalog (`useSkills()`) **and** this agent's current
  links (`useAgentSkills(agent.id)`), merges into one ordered list (linked
  skills first in their `order`, unlinked skills appended after, stable by
  name); header uses `skills.title`/`skills.enabledCount`/
  `skills.filterPlaceholder`/`skills.orderHint` copy (all already written).
  Each row: drag handle, a `Checkbox` (bound to `enabled`, calling `PATCH
  /agents/:id/skills/:skillId` — checking a not-yet-linked skill both
  creates the link *and* sets `enabled: true` in one call), name, type
  badge. **Decided**: checking an unvetted skill (`enabled: false`
  globally) is allowed, not blocked — its row still visibly carries
  `needsVetting`, and the per-link `enabled` gates actual prompt injection
  independent of the skill's own global vetting status (attaching ≠
  injecting). Reordering (drag) calls the existing `POST /agents/:id/skills
  {skill_ids: [...]}` with the full list's new order. Reorder UI:
  **hand-rolled** (HTML5 `draggable`/`onDragOver`/`onDrop`), matching this
  codebase's consistent house style of small hand-rolled primitives over
  new heavy dependencies — no DnD library exists here today
  (`grep -rniE "dnd|sortable|reorder|drag" client/src` = zero hits).

## Client: hooks

New `client/src/lib/hooks/skills.ts`: `useSkills`, `useSkill`,
`useCreateSkill`, `useUpdateSkill`, `useDeleteSkill`, `useSkillVersions`,
`useRestoreSkillVersion`, `useImportFilePreview`/`Confirm`,
`useImportUrlPreview`/`Confirm`, `useCommunitySkills`,
`useInstallCommunitySkill`. Extend `client/src/lib/hooks/agents.ts` (today
has zero skill-related hooks) with `useAgentSkills(agentId)`,
`useSetAgentSkills(agentId)` (reorder), `useSetAgentSkillEnabled(agentId)`
(checkbox).

## New client dependencies

- A lightweight code/markdown editor for the Config tab's skill-body field
  (line numbers, basic syntax highlighting, token count) — this codebase
  has no such primitive today (`ConfigTab`'s `system_prompt` is a plain
  `Textarea`). Recommend `@uiw/react-textarea-code-editor` (small,
  dependency-light, matches the house preference for minimal deps) or
  CodeMirror 6 if richer highlighting is wanted — a call to make during
  implementation, not resolved here.
- A tiny text-diff library for the Versions tab's "Diff" action (e.g. the
  `diff` npm package) — client-side only, no new server endpoint.

## Contracts to update (both `server/src/vendor/shared` **and**
`client/src/vendor/shared` copies — this repo's non-default convention)

- `contracts/knowledge.ts`: `AgentSkillLink` gains `enabled: z.boolean()`;
  `Skill` gains nothing (source enum unchanged, per Decision 5); new
  `SkillVersion` (`skill_id, version, body, summary, created_at`),
  `CreateSkillBody`/`UpdateSkillBody`, `ImportCandidate` (name,
  description, type, body, ignored_files) schemas; `Agent` (or the list
  response DTO) gains `skills_count: z.number().int()` for the `AgentCard`
  badge.
- `contracts/productionize.ts`: no change needed — `PluginSkill.source`
  already matches `SkillSource`, and Decision 5 keeps that enum as-is.

## Acceptance / demo script

Provided directly by the user as the definition of "done" for this
feature — not a testing-framework plan, a manual walkthrough:

**Seed content required:**
- A new agent, **"Test Quality Reviewer"** — reviews test quality
  (uncovered branches, missed corner cases, over-mocking, flaky tests).
- A second new agent for the **"API Contract"** scenario below —
  **"API Contract Reviewer"** (confirmed), detects breaking changes to
  route/API signatures.
- Each new agent gets its own skills attached via the Skills tab. **At
  least one skill across the two agents must be created through the
  import path** (file, URL, or community — not the paste/manual path), to
  exercise the full import→preview→confirm→attach chain at least once.

**Control experiment** (run once per scenario, twice — with the relevant
agent's skills all unchecked vs. checked):
- **Test Quality**: a PR whose only test covers the happy path. Without
  skills attached → the agent should pass/skip it (nothing to flag).
  With skills attached → it should flag the uncovered branch and the
  missing edge case.
- **API Contract**: a PR that changes a route's signature. Without skills
  → pass/skip. With skills → flags the breaking change.
- For both: open the run's trace drawer → the prompt-assembly section →
  confirm the `## Skills / rules` block is present (populated, not `null`)
  when skills are attached, and see the token count it added — this is
  exactly `TraceBody.tsx:76-77`'s already-wired `trace.prompt_assembly.
  skills` block, and the `runLog.info('skills: N attached')` line specified
  above in the `run-executor.ts` wiring section.

**Final checklist:**
1. The `pr-self-review` Claude Code skill (built earlier this session)
   exists with its automatic post-`gh pr create`/`git push` trigger
   **disabled** for the duration of this feature's development — invoked
   **manually** instead, and confirmed to pull in *both* frontend and
   backend `.claude/skills/*` matches on a mixed diff. (This checks the
   *other*, unrelated skill system from earlier in this session — note the
   naming collision: "skills" here means Claude Code's own `.claude/
   skills/*`, not the DevDigest product feature this doc otherwise
   specifies. Action item, not part of this feature's own code: temporarily
   revert/comment the auto-invoke line this session already added to root
   `AGENTS.md`'s Session protocol, restoring it once this feature's
   development is done.)
2. A skill can be created and edited in the UI (Config tab, save with
   optional change summary).
3. Both new agents have linked skills (via the unified Skills-tab list).
4. An **enabled** skill shows up in the run log/trace as its own block;
   a **disabled** one does not (this is the `l.enabled && l.skill.enabled`
   filter in the `run-executor.ts` wiring, directly testable).
5. At least one import went through the preview step, and nothing
   executable in an uploaded archive ran (a fixture archive with a `.sh`
   file inside should show it in "ignored files," never execute it).
6. The control experiment (Test Quality *and* API Contract) reproduces on
   both agents.

## Suggested build order

1. Migration + schema (`agent_skills.enabled`, `skill_versions.summary`).
2. Contracts (both vendor copies).
3. `server/src/modules/skills/` CRUD (no import yet) + tests.
4. `run-executor.ts` wiring + the `run-executor.ts:451` trace fix — makes
   the *existing* link API functional end-to-end, independently testable
   before any client UI exists.
5. `reviewer-core` universal-wrap change + `agents` module's
   version-bump-on-skill-change change.
6. Import pipeline: paste (already-copy-specified) → file/archive upload
   (the user's explicit ask) → URL → community, in that order.
7. Client hooks.
8. Client `/skills` pages + nav reorganization (`SKILLS LAB` section).
9. Agent Editor Skills tab (unified list, checkbox-attach, drag-reorder).
10. Seed the acceptance script's two new agents + skills (at least one
    imported), run the control experiment, verify the final checklist.

## Testing plan

- `server/test/skills.test.ts` + `skills.it.test.ts` — CRUD, version-bump
  on real changes (not on `enabled`), restore-creates-new-version, file/
  archive extraction (fixture `.zip` with one `.md` + one `.sh` — assert
  the `.sh` lands in `ignored_files` and is never executed), URL-import,
  community install — `imported_url`/`community` land `enabled: false`,
  `manual` (including file uploads) lands `enabled: true`.
- `server/test/run-executor.test.ts` — assert `reviewPullRequest` receives
  resolved skill bodies, correctly ordered, disabled links/skills filtered
  out; assert the failure-path trace no longer hardcodes `skills: null`.
- `reviewer-core/test` — extend prompt-assembly tests for the new universal
  `wrapUntrusted()`-on-skills behavior.
- `client`: `SkillsListView.test.tsx`, `SkillDetail.test.tsx` (all 3
  in-scope tabs), `ImportSkillDrawer.test.tsx`, `CommunitySkillsDrawer.
  test.tsx`, `SkillsTab.test.tsx` (checkbox-attach/detach/reorder), extend
  `AgentEditor.test.tsx` and `AgentCard.test.tsx` (skill count badge).

## Resolved (previously open questions)

All five items raised in the previous pass are now decided:

- **Blank-creation entry point** → a separate **"+ New skill"** button,
  distinct from "+ Add Skill" (see "Client: routes & pages").
- **Community data source** → static curated seed, hardcoded four entries
  matching the design mockup exactly (see `listCommunitySkills()`).
- **Second acceptance-test agent's name** → confirmed **"API Contract
  Reviewer"**.
- **Attach-while-unvetted UX** → allowed, flagged with `needsVetting`, the
  per-link `enabled` still gates injection independently.
- **Code-editor / archive-library choice** → not worth a round-trip;
  proceeding with the already-stated recommendations
  (`@uiw/react-textarea-code-editor`, `adm-zip`) unless implementation
  surfaces a concrete reason to switch.

## Remaining risks (not decisions — just worth tracking)

- **Design image coverage was partial.** The File/URL import *form* itself
  (as opposed to the Community drawer, which *was* shown) was never
  screenshotted — its layout in this spec is a mockup this session built
  to match the existing screens' style (published as an Artifact), not a
  confirmed design. Worth a quick visual sign-off before or shortly after
  implementation.
- **New client dependency risk**: `@uiw/react-textarea-code-editor` (or
  whatever code-editor library implementation settles on) is this
  client's first syntax-highlighting editor — confirm it doesn't clash
  with the existing `Textarea` primitive's styling conventions once wired.
