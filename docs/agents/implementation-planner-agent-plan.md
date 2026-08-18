# Add `implementation-planner` subagent

**Status:** done — `../../.claude/agents/implementation-planner.md` created.

**2026-08-19 — amended, not repealed:** this agent shipped under the name
`planner`; renamed to `implementation-planner` (`git mv`, this file
renamed alongside it) when the `spec-creator` agent was introduced ahead
of it in the pipeline. The frontmatter/prompt body/template shown below
describe the **original** shipped behavior and are historically accurate,
but no longer match the current `.claude/agents/implementation-planner.md`:
`AskUserQuestion` was dropped from `tools:`, the "Clarify first" section
was removed entirely (this agent now trusts an already-clarified
`spec-creator` spec and stops/reports rather than asking on an unresolved
`[NEEDS CLARIFICATION]`), the template gained a `Spec` field, and every
Work Item now must cite a `satisfies: AC-N`. Full rationale:
[`../spec-creator-agent-plan.md`](../spec-creator-agent-plan.md). Current
source of truth for actual behavior is always
[`../../.claude/agents/implementation-planner.md`](../../.claude/agents/implementation-planner.md)
itself, not this doc.

## Context

Part of a two-agent pipeline (`implementation-planner` + `implementer`) that sits between
the existing `researcher` subagent (read-only research, no code) and the
repo's existing architecture/security review skills (`onion-architecture`,
`security`, etc. — invoked separately, not by these agents). `implementation-planner`
turns a feature/bugfix request into a structured Development Plan before
any code is written, grounded in this repo's actual modules, skill
catalog, `INSIGHTS.md` gotchas, and architectural constraints — so the
plan cannot later contradict rules the `implementer` agent will be bound
by when it applies project skills during execution.

Design was researched via two parallel `researcher` invocations (one
external: Anthropic's own subagent/skills/multi-agent docs; one internal:
this repo's modules, `../../AGENTS.md` constraints, skill catalog,
`INSIGHTS.md` locations, and the `researcher.md` frontmatter precedent)
and presented to the user for approval before any file was created — see
that chat turn for the full research citations. Key grounding points:

- Single-responsibility + least-privilege tool scoping
  (code.claude.com/docs/en/sub-agents).
- Subagents start with a fresh, isolated context — the plan must be a
  self-contained artifact, not something `implementer` can rely on
  "remembering" from a shared conversation.
- Skills are discovered at runtime via the `Skill` tool
  (description-matching, progressive disclosure) rather than hardcoded
  into an agent's own prompt — so the catalog can grow without editing
  `implementation-planner`/`implementer`.
- The repo's own `docs/<feature-slug>-plan.md` + `**Status:**` line
  convention (root `../../CLAUDE.md`) is the save target — `implementation-planner` itself
  stays read-only and returns the plan; the orchestrating session saves
  it, mirroring how this very session already handles plan-mode output.
- SPEC.md self-containment checklist (name files/interfaces, state
  out-of-scope, end with a verification step) and the multi-agent
  research system's per-task checklist (objective, output format,
  boundaries) shaped the Development Plan template below.

## Approach

Create `../../.claude/agents/implementation-planner.md`:

```yaml
---
name: implementation-planner
description: Use this agent to turn a feature/bugfix request into a structured Development Plan before any code is written. It reads the relevant modules' AGENTS.md/CLAUDE.md constraints and INSIGHTS.md gotchas, the current skill catalog, and the codebase, then produces a plan that names the modules/files touched, the skills the implementer agent will apply, explicit in-scope/out-of-scope boundaries, and an end-to-end verification step — so the plan cannot contradict rules the implementer will later be bound by. Does not write or edit any files; returns the plan for the orchestrating session to save (per this repo's docs/<slug>-plan.md convention) and for the implementer agent to consume. If the request's scope, target modules, or acceptance criteria are unclear, it asks clarifying questions first rather than guessing. Do not use this agent to write code.
tools: Read, Grep, Glob, Bash, Skill, AskUserQuestion
model: sonnet
---
```

System prompt body covers, in order:

1. **Before planning** — identify touched modules, read each one's
   `../../AGENTS.md` in full (constraints are binding), read each one's
   `INSIGHTS.md` explicitly (not auto-loaded like `../../CLAUDE.md`), read
   `../../.claude/skills/README.md`'s catalog and load the full content (via
   `Skill`) of any skill whose rules will bind the implementer's work.
2. **Clarify first** — `AskUserQuestion` before planning if scope,
   modules, or acceptance criteria are genuinely unclear.
3. **Output: Development Plan** — the markdown template below, with an
   explicit note that `implementation-planner` does not save the file itself.
4. **Discipline** — every constraint/gotcha cited needs a file:line
   citation; every work item independently actionable; every skill the
   implementer is expected to invoke is named with a reason.

Development Plan template:

```markdown
# <Feature/Fix Name>

**Status:** not started

## Context
...

## Scope
- In scope: ...
- Out of scope: ...

## Modules Touched
- <module>/... — constraint (file:line citation)

## Architectural Constraints
- ...

## Relevant INSIGHTS.md Gotchas
- ...

## Skills Implementer Will Need
- <skill-name> — why / which files

## Work Items
1. <task> — files: ..., depends on: ..., acceptance: ...

## Verification
- ...
```

## Verification

- `cat .claude/agents/implementation-planner.md` — frontmatter parses, no `Write`/`Edit`
  in `tools:`.
- Invoke via `Agent` with `subagent_type: implementation-planner` on a real multi-module
  feature request from this repo; confirm the returned plan cites real
  `../../AGENTS.md`/`INSIGHTS.md` file:line locations and lists actual skills
  from `../../.claude/skills/README.md`, not invented ones.
- Invoke with a deliberately vague request; confirm it asks clarifying
  questions instead of guessing scope.
