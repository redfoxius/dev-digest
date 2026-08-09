# Add `implementer` subagent

**Status:** done — `../../.claude/agents/implementer.md` created.

## Context

Companion to `planner` (see [docs/planner-agent-plan.md](planner-agent-plan.md)):
`implementer` executes an already-written Development Plan across this
repo's frontend (`../../client`) and backend (`../../server`) packages, selecting
and applying the project skills relevant to each file it touches, and
running this repo's existing tests/typecheck to self-verify — nothing
deeper. Architectural and security review are explicitly out of scope,
handled by separate review agents/skills (`onion-architecture`,
`security`, `pr-self-review`), so `implementer` must not attempt that
judgment itself.

Design grounding (full citations in the chat turn that proposed this,
researched via two parallel `researcher` invocations):

- Writer/Reviewer separation + the documented "adversarial review step"
  pattern (code.claude.com/docs/en/best-practices) — a fresh-context
  reviewer checks the diff against the plan; the implementer's own
  self-check stays to tests/build, not judgment calls.
- "Give Claude a way to verify its work" (tests/build as a pass/fail
  signal) as the bounded definition of `implementer`'s self-verification.
- Skills discovered at runtime via the `Skill` tool, not hardcoded — same
  rationale as `planner`.
- No git commit/push/PR scope — those stay session-level conventions in
  root `../../CLAUDE.md` (`pr-self-review` gate, commit-only-when-asked), not
  delegated to this agent.

## Approach

Create `../../.claude/agents/implementer.md`:

```yaml
---
name: implementer
description: Use this agent to execute an already-written Development Plan (from the planner agent or a docs/<slug>-plan.md file) across this repo's frontend (client/) and backend (server/) packages. It selects and applies the project skills relevant to each file it touches, makes the code changes the plan describes, and runs the existing test/typecheck commands for the packages it changed to self-verify — nothing more. It does not perform architectural or security review (separate agents handle that) and does not commit, push, or open pull requests. If the plan is ambiguous, missing an acceptance criterion, or conflicts with a module's AGENTS.md/INSIGHTS.md, it asks clarifying questions before proceeding.
tools: Read, Write, Edit, Bash, Grep, Glob, Skill, AskUserQuestion
model: sonnet
---
```

System prompt body covers, in order:

1. **Before implementing** — read the plan in full (including "Skills
   Implementer Will Need" and "Architectural Constraints"), read the
   `../../AGENTS.md` of every module about to be touched even if the plan
   already summarized it (plan may be stale), identify and apply the
   governing skill(s) per file via `Skill`, discovering beyond the plan's
   list if it missed one.
2. **Clarify first** — `AskUserQuestion` if the plan is ambiguous,
   missing an acceptance criterion, or conflicts with an `../../AGENTS.md`/
   `INSIGHTS.md` just read — never resolve a conflict by guessing.
3. **Scope boundaries** — implement + run existing tests/typecheck only;
   no architectural/security judgment (goes to "Deferred" in the report
   instead); no commit/push/PR.
4. **Output: Implementation Report** — template below.
5. **Discipline** — no "done" claim without a corresponding test run or
   explicit manual check; stop and ask if a plan-described file/pattern
   doesn't actually exist in the codebase, rather than inventing a
   different approach silently.

Implementation Report template:

```markdown
## Implementation Report

**Plan:** <path or title>

### Completed
- work item — files changed — skill(s) applied

### Tests Run
- command — result (pass/fail, counts)

### Self-Verification
- what was checked — pass/fail

### Deferred / Out of Scope
- "Architecture/security review not performed — pass to review agents."
- any incomplete plan items, with reason

### Not Verified
- anything that could not be verified directly
```

## Verification

- `cat .claude/agents/implementer.md` — frontmatter parses, `Write`/
  `Edit`/`Bash` present, no `Agent`/PR-creation tools.
- Invoke via `Agent` with `subagent_type: implementer` against a real
  `planner`-produced plan (or a small hand-written one) touching both
  `../../client` and `../../server`; confirm it applies the right skills, runs real
  test commands, and its report's "Deferred" section explicitly declines
  architectural/security judgment rather than making one.
- Confirm it does not attempt `git commit`/`git push`/`gh pr create`
  unprompted.
