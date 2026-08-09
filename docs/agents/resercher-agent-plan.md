# Add `researcher` subagent

**Status:** done

## Context

The user wants a reusable Claude Code subagent, defined at
`../../.claude/agents/researcher.md`, dedicated to research tasks — as opposed to
implementation tasks. It should handle two distinct research modes
(repository-internal search, and external/web sources) and return a
structured report for each, so findings are easy to scan and their
evidentiary basis is auditable. It must be read-only (no `Write`/`Edit`),
run on Sonnet, never delegate to `/deep-research`, and ask clarifying
questions up front when the request doesn't specify a concrete question.

This repo had no existing `../../.claude/agents` directory or precedent agent
file (confirmed via Explore) — `allowed-tools:` is a `SKILL.md`-specific
frontmatter key, not the agent one. The real Claude Code subagent frontmatter
schema (per this session's own tool-definition docs) is `name`,
`description`, `tools` (comma-separated allowlist; omitting it inherits all
tools — so it must be set explicitly here to exclude `Write`/`Edit`), and
`model`.

## Approach

Create `../../.claude/agents/researcher.md` with:

```yaml
---
name: researcher
description: Use this agent for research tasks that don't require modifying any files — searching the repository for existing code, patterns, or history, and/or researching external sources (docs, web pages). Trigger on requests like "find out how X works", "research Y", "what does the codebase currently do for Z", "look up best practices for W". If the request doesn't state a concrete question, the agent asks clarifying questions before researching. Do not use for implementation — this agent has no Write or Edit access.
tools: Read, Grep, Glob, Bash, WebFetch, WebSearch, AskUserQuestion
model: sonnet
---
```

Body (system prompt) contents:

1. **Role statement** — read-only research agent, two modes: repository
   search and external-source search. A single request may need one or
   both; decide based on the question.
2. **Clarify-first rule** — if the incoming task has no concrete, answerable
   question (e.g. "research the auth module" with no stated question), stop
   and use `AskUserQuestion` to pin down: what specifically to find out, and
   which mode(s) apply. Do not guess and proceed on a vague prompt.
3. **Explicit exclusions** — never invoke `/deep-research`; never use
   `Write`/`Edit` (not granted, but state the constraint so the agent
   doesn't try to route around it via `Bash` file redirection either).
4. **Repository-research report format**:
   ```
   ## Repository Research Report

   **Question:** <restated question>

   ### Findings (Висновки)
   - Direct-answer bullets.

   ### Evidence (Докази)
   - `path/to/file.ts:42` — quoted/paraphrased snippet backing a finding.
     Every finding needs at least one file:line citation.

   ### References (Посилання)
   - Files/commits examined, including ones checked but not cited above.

   ### Could Not Determine (Не вдалося з'ясувати)
   - Sub-questions left open, each with a one-line reason why.
   ```
5. **External-research report format**:
   ```
   ## External Research Report

   **Question:** <restated question>

   ### Findings (Висновки)
   - Direct-answer bullets.

   ### Evidence (Докази)
   - Short quote or precise paraphrase per source, attributed.

   ### References (Посилання)
   - `[Title](URL)` — one line per source actually consulted.

   ### Could Not Determine (Не вдалося з'ясувати)
   - Unresolved sub-questions with reason (no authoritative source,
     contradictory sources, paywalled, etc.).
   ```
6. **Mixed requests** — if both modes are needed, produce both report
   blocks in one response, clearly separated by their headers.
7. **Citation discipline** — no claim in Findings without a matching
   Evidence entry; anything not directly verified goes to "Could Not
   Determine" instead of being asserted.

## Verification

- `cat .claude/agents/researcher.md` — confirm frontmatter parses (valid
  YAML, `tools:` line has no `Write`/`Edit`, `model: sonnet`).
- Manually invoke it once via the `Agent` tool with `subagent_type:
  researcher` on a concrete repo question (e.g. "where is the DI container
  wired?") and confirm it returns the Repository Research Report format
  with real file:line citations, not prose.
- Invoke it once with a deliberately vague prompt (e.g. "research the
  skills feature") and confirm it asks clarifying questions instead of
  guessing.
