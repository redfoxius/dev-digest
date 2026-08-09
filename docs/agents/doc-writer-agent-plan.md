# Development Plan: `doc-writer` subagent

**Status:** done — `../../.claude/agents/doc-writer.md` created. The permission-scoping Open Question (Write vs Edit(docs/**)) remains unresolved — requires separate user approval.

## Context

The repo already runs a three-agent pipeline — `researcher` (read-only
research) → `planner` (produces a `docs/<slug>-plan.md`, no code) →
`implementer` (executes the plan, `client/`/`server/`, no commit/push/PR).
Architectural/security review is deliberately left to skills
(`onion-architecture`, `security`, `pr-self-review`), not an agent.

There is currently no agent responsible for **post-implementation,
feature-facing documentation** — i.e., turning a finished plan/PR/commit
into human-readable docs with diagrams, and knowing where in `docs/` (or
whether at all) that material belongs. `docs/` today holds exactly two
kinds of content: (a) a flat family of `<slug>-plan.md` pre-implementation
plans and `docs/agents/` (agent design docs), and (b) exactly one
precedent for *already-built-feature* reference documentation:
`docs/agent-prompts/README.md`, which documents the live prompt-assembly
pipeline (`reviewer-core/src/prompt.ts`) with file:line citations and no
narrative repetition of README/TESTING content
(`docs/agent-prompts/README.md:1-33`). No `docs/<feature>.md` (non-plan)
file exists anywhere else in `docs/`.

`doc-writer` fills that gap: given an implemented feature (a plan doc, a
PR, a commit range), it writes reference/explanation documentation with
diagrams, decides where it belongs, and links back to its source —
without touching the sections of `README.md`/`TESTING.md` that already own
quick-start and test-strategy content (`CLAUDE.md:73-77`).

Design grounding (external research supplied by a parallel `researcher`
pass; `planner` itself has no WebFetch/WebSearch):

- Anthropic, [sub-agents](https://code.claude.com/docs/en/sub-agents) —
  focused single-purpose subagent, least-privilege tools; no dedicated
  guidance exists for a "documentation-writing" subagent archetype.
- Anthropic, [permissions](https://code.claude.com/docs/en/permissions) —
  **load-bearing gotcha**: Claude Code's permission engine only evaluates
  path-scoped rules against `Edit(path)`/`Read(path)`; a `Write(docs/**)`
  rule is silently accepted but never enforced ("Use `Edit(docs/**)`
  instead — Edit rules cover all file-editing tools").
- Mermaid diagram generation pitfalls (w3resource, Obsibrain, BSWEN,
  `mermaid-validator` GitHub repo) — keep diagrams small and
  single-concept, short stable node IDs, link diagrams to their source to
  mitigate staleness; no tool verifies *semantic* accuracy against code.
- Diátaxis framework (diataxis.fr) — four documentation types by reader
  need (tutorial, how-to, reference, explanation); documenting
  already-implemented features maps to **reference/explanation**, not
  tutorial/how-to.
- GitBook IA guide — placement decisions should be driven by a maintained
  navigational/labeling structure the agent can pattern-match against,
  not re-derived from scratch each time.

## Scope

- In scope: create `.claude/agents/doc-writer.md` (new subagent
  definition) with frontmatter, a "before writing" research step, a
  placement-decision heuristic, content rules (no duplication, mandatory
  source citation, Mermaid diagram guidance), an index-maintenance step,
  a clarify-first rule, and an output report format — matching the
  structure/tone of the three existing agent files.
- Out of scope (do not implement in this plan's Work Items):
  - Any `.claude/settings.json` permission change (`Write(docs/**)` /
    `Edit(docs/**)` scoping) — see Open Question below; requires separate,
    explicit user approval.
  - Writing any actual feature documentation content — that's
    `doc-writer`'s own future runtime job, not this plan's.
  - Creating a `docs/README.md` index file — `doc-writer` maintains
    `CLAUDE.md`'s existing "Docs map" list, not a new index file, unless a
    future session decides otherwise.
  - Editing `README.md`/`TESTING.md` content — `doc-writer` only links to
    them.

## Modules Touched

- `.claude/agents/doc-writer.md` — new file, no existing constraint to
  cite (net-new agent).
- `docs/agents/doc-writer-agent-plan.md` (this file) — saved by the
  orchestrating session per `CLAUDE.md:60-71` (`**Status:**` line
  required).
- (Flagged, not required by this plan) `.claude/agents/README.md` —
  catalog table currently lists only `researcher`/`planner`/`implementer`;
  falls outside this task's "modules touched" boundary, treated as
  optional/follow-up.

## Architectural Constraints

- `CLAUDE.md:73-77` ("Docs map") — `README.md` owns quick start +
  architecture diagram, `TESTING.md` owns cross-package test strategy,
  `docs/` is "cross-cutting reference docs." `doc-writer`'s system prompt
  must forbid restating either owned section — link out instead.
- `CLAUDE.md:60-71` ("Feature planning") — plans live at
  `docs/<feature-slug>-plan.md` with a `**Status:**` line and bidirectional
  cross-referencing. `doc-writer`'s output must follow the same
  cross-referencing discipline in the other direction: every doc it writes
  must link back to the plan/PR/commit it was drawn from.
- `.claude/agents/planner.md:1`, `.claude/agents/implementer.md:1`,
  `.claude/agents/researcher.md:1` — established frontmatter shape (`name`,
  one-paragraph `description` stating trigger + scope boundary + what it
  does NOT do, `tools:`, `model: sonnet`) that `doc-writer.md` must match.
- `.claude/agents/README.md:8-23` — the pipeline diagram and
  responsibility table; `doc-writer` is a **new**, currently undocumented
  stage — a future session should fold it into that table (flagged
  optional per the stated modules-touched boundary).
- `.claude/skills/mermaid-diagram/SKILL.md:238` — "Don't exceed ~20 nodes
  per diagram — split into multiple diagrams instead"; `SKILL.md:16`
  ("Diagrams should clarify, not decorate"); `SKILL.md:228` ("Pick the
  right direction") — binding on any diagram `doc-writer` generates.

## Relevant INSIGHTS.md Gotchas

None of `server/INSIGHTS.md` or `client/INSIGHTS.md` are directly
relevant — `doc-writer` writes to `docs/` and reads (not edits) module
source, so it is not bound by either module's own engineering gotchas the
way `implementer` is. If a future request has `doc-writer` document a
specific module's feature, its system prompt should still point it at
that module's `INSIGHTS.md` for gotchas worth surfacing in the doc's
explanation.

## Skills doc-writer Will Need

- `mermaid-diagram` — every diagram `doc-writer` embeds must go through
  this skill's decision guide (`SKILL.md:23-38`) and size/scope
  constraints (`SKILL.md:224-242`); the prompt must instruct it to invoke
  this skill via the `Skill` tool rather than freehand Mermaid syntax.
- `engineering-insights` — not invoked by `doc-writer` itself, but its
  system prompt should note the boundary: `engineering-insights` captures
  *why/gotchas* into `INSIGHTS.md` (append-only, per-module engineering
  notes), while `doc-writer` produces *what/how* reference material in
  `docs/` — complementary, not overlapping, outputs.
- No other cataloged skill governs documentation authoring or `docs/`
  placement.

## Open Question / Follow-up — requires separate user approval

- **`Write(docs/**)` is silently unenforced; only `Edit(docs/**)` is
  checked.** Per code.claude.com/docs/en/permissions, a `Write(docs/**)`
  allow/deny rule is accepted into `.claude/settings.json` without error
  but is **never enforced** at runtime. If this repo wants `doc-writer`
  **technically** confined to writing only under `docs/`, that requires an
  `Edit(docs/**)` rule in `.claude/settings.json` — a repo-wide permissions
  change with a larger blast radius than adding one agent file, since it
  would also constrain any other agent/session subject to that same
  settings scope. **This plan's Work Items do not include that settings
  change.** Without it, `doc-writer`'s "only write inside `docs/`" boundary
  is enforced by its own system-prompt discipline only — exactly like
  `implementer`'s existing `Write, Edit` grant is repo-wide-capable today
  and is likewise held to `client/`/`server/` only by prompt discipline,
  not settings. Flag this to the user before deciding whether to also
  propose the settings change in a follow-up task.

## Proposed frontmatter

```yaml
---
name: doc-writer
description: Use this agent to turn an already-implemented feature — a plan doc, a PR, or a commit range — into feature-facing documentation with diagrams, and to decide where in docs/ it belongs. It reads the source material (docs/<slug>-plan.md, git log/diff, PR description), the target module's AGENTS.md/INSIGHTS.md for context, and CLAUDE.md's Docs map, then writes or updates reference/explanation-style documentation that links back to its source and links out to (never restates) README.md's and TESTING.md's owned content. Uses the mermaid-diagram skill for any diagrams, capped at ~20 nodes and one concept per diagram. Does not write or edit code, and does not author pre-implementation docs/<slug>-plan.md files — that is the planner agent's output, saved by the orchestrating session, per this repo's plan-saving convention. If the source feature or its correct docs/ placement is unclear, it asks clarifying questions first rather than guessing.
tools: Read, Grep, Glob, Bash, Write, Edit, Skill, AskUserQuestion
model: sonnet
---
```

Rationale for `tools`: `Read, Grep, Glob` to inspect implemented code and
existing docs; `Bash` for `git log`/`git diff`/`gh pr view` source
traceability (mirrors `planner`'s `Bash` grant); `Write, Edit` to author
docs (mirrors `implementer`'s grant shape, scoped by prompt discipline per
the Open Question above); `Skill` for `mermaid-diagram`; `AskUserQuestion`
for ambiguous placement/source.

## Work Items

1. **Draft frontmatter for `doc-writer.md`.** Files:
   `.claude/agents/doc-writer.md`. No dependencies. Acceptance: frontmatter
   parses as valid YAML, `description` states trigger + explicit
   non-goals, `tools`/`model` match the rationale above.

2. **Write the "Before writing" section** (source-gathering step). Depends
   on: 1. Identify the source material — a `docs/<slug>-plan.md` file, a
   PR number/URL, or a commit range — and read it in full before drafting
   anything; read the touched module's `AGENTS.md` for terminology/
   architecture and `INSIGHTS.md` for gotchas worth surfacing; read
   `CLAUDE.md`'s "Docs map" and skim `README.md`'s/`TESTING.md`'s section
   headers (not full content) so duplication is caught before writing
   starts. Acceptance: section explicitly lists all three source types and
   names the two files whose owned sections must not be duplicated.

3. **Write the "Placement decision" section** (Diátaxis-informed heuristic
   + naming convention). Depends on: 2. Content:
   - Since `doc-writer` documents *already-implemented* features, its
     output is **reference or explanation** material — never tutorial/
     how-to content.
   - Two placement shapes, by precedent already in this repo:
     - **Single file**, `docs/<feature-slug>.md` — mirrors the existing
       `docs/<feature-slug>-plan.md` convention minus the `-plan` suffix.
     - **Directory with an index**, `docs/<topic>/README.md` + supporting
       files — following the existing precedent at
       `docs/agent-prompts/README.md:1-16`. Use only when the feature
       genuinely spans multiple linkable artifacts.
   - `doc-writer` never creates content under `docs/<slug>-plan.md` names
     or edits an existing plan doc's body — at most it may add a
     "Documented at: `docs/<feature-slug>.md`" cross-reference line to the
     *bottom* of an already-done plan doc.
   Acceptance: section gives a concrete naming rule, cites the
   `docs/agent-prompts/` precedent by path, and states the plan-doc
   non-editing boundary explicitly.

4. **Write the "Content rules" section** (no duplication, mandatory
   citation, Mermaid guidance). Depends on: 2, 3.
   - **No duplication rule**: never restate README.md/TESTING.md-owned
     content — link to the specific section instead.
   - **Source-citation rule**: every doc opens with a line naming its
     source — plan doc path, PR number/URL, or commit SHA(s). No claim in
     the doc's body without a file:line, PR, or commit citation backing
     it.
   - **Mermaid diagram rules**: invoke the `mermaid-diagram` skill for
     every diagram; cap at ~20 nodes per `SKILL.md:238`; one concept per
     diagram; every diagram sits next to a sentence naming the source
     commit it reflects; explicitly labeled as best-effort, not guaranteed
     semantically accurate — instruct the user to skim-verify against the
     actual code.
   Acceptance: section enumerates all three rules as separate,
   individually-checkable bullets.

5. **Write the "Keeping the index current" section.** Depends on: 3.
   Whenever `doc-writer` adds a new durable, cross-cutting doc, it checks
   `CLAUDE.md`'s "Docs map" and adds one bullet line pointing to the new
   doc. Discretionary — not every `docs/<feature-slug>.md` warrants an
   index entry; use `AskUserQuestion` if unclear. No `docs/README.md`
   index file created. Acceptance: names the exact file/section to
   maintain and states the discretion boundary.

6. **Write the "Clarify first" section.** Depends on: 2, 3. Use
   `AskUserQuestion` before drafting when (a) no clear source material was
   given, or (b) the correct placement is genuinely ambiguous after
   reading the Docs map and existing `docs/` contents. Acceptance: states
   both trigger conditions explicitly.

7. **Write the "Output: Documentation Report" section.** Depends on: 1–6.

   ```markdown
   ## Documentation Report

   **Source:** <plan doc path / PR URL / commit range>
   **Doc(s) written/updated:** <path(s)>

   ### Placement Decision
   - shape chosen (single file / directory-with-index) — why

   ### Duplication Check
   - README.md/TESTING.md sections linked-to, not restated — list

   ### Diagrams
   - diagram — source commit/PR it reflects — node count

   ### Docs Map
   - updated CLAUDE.md's Docs map: yes/no — why

   ### Not Verified
   - anything the agent could not confirm from the source material
   ```
   Acceptance: report format includes a "Not Verified" section and a
   "Duplication Check" section that forces an explicit answer.

8. **Assemble and cross-check the full `doc-writer.md` file.** Depends on:
   1–7. Read the assembled file end-to-end against `planner.md`,
   `implementer.md`, `researcher.md` for tone/section-header consistency.
   Acceptance: file structurally parallels the three existing agent files;
   no section merely restates another agent's job.

9. **(Flagged, optional — outside this plan's stated modules-touched
   boundary) Add `doc-writer` to `.claude/agents/README.md`'s catalog
   table and pipeline diagram.** Depends on: 8. Not required for this plan
   to be considered complete. Do not implement without separate
   confirmation.

## Verification

- Frontmatter parses with `name`, `description`, `tools`, `model` keys
  present.
- Structural diff check: `.claude/agents/doc-writer.md` has the same
  top-level heading set shape as `.claude/agents/planner.md`.
- **Dry-run against a real already-implemented feature in this repo**:
  pick `docs/skills-feature-plan.md` (Status: implemented). Have
  `doc-writer` (once created) produce a documentation draft for this
  feature and confirm: it picks a placement rather than defaulting to
  editing `docs/skills-feature-plan.md` in place; the draft cites the plan
  doc path and at least one real commit SHA from the feature's range; the
  draft does not restate README.md's package table or architecture
  diagram, or TESTING.md's suite map — only links to them; any diagram
  proposed stays at or under ~20 nodes and states which commit it
  reflects.
- Confirm the Open Question section's permission-scoping gotcha is
  surfaced to the user as a distinct decision point before any
  `.claude/settings.json` change is proposed or made in a later session.

---

**Sources consulted:**
- `.claude/agents/planner.md`, `.claude/agents/implementer.md`,
  `.claude/agents/researcher.md`
- `.claude/skills/mermaid-diagram/SKILL.md`
- `CLAUDE.md`, `docs/agent-prompts/README.md`, `docs/skills-feature-plan.md`
- Anthropic, [Create custom subagents](https://code.claude.com/docs/en/sub-agents)
- Anthropic, [Configure permissions](https://code.claude.com/docs/en/permissions)
- [Diátaxis](https://diataxis.fr/)
- [GitBook — documentation structure tips](https://gitbook.com/docs/guides/docs-best-practices/documentation-structure-tips)
- [mermaid-validator (GitHub)](https://github.com/lvy010/mermaid-validator)
