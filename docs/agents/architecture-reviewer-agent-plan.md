# Development Plan: `architecture-reviewer` subagent

**Status:** done — `../../.claude/agents/architecture-reviewer.md` created. Open items (Go-scope, `ReportFindings` tool) remain unresolved — see "Clarification" section.

## Context

The user wants a fourth subagent, `.claude/agents/architecture-reviewer.md`,
completing the `researcher` (read-only investigation) → `planner` (plan,
no code) → `implementer` (writes code) → **`architecture-reviewer`**
(read-only post-hoc structural check) pipeline. Role brief: "без права
запису, перевіряє архітектурні межі й повертає знахідки з доказами" — no
write access, checks architectural boundaries, returns findings with
evidence.

This repo already has two architecture-rule skills the new agent must
route to rather than duplicate:

- `onion-architecture` — dependency-rule for `server/` + `reviewer-core/`
  (`.claude/skills/onion-architecture/SKILL.md:71-140`: dependency rule,
  ports & adapters, module anatomy, composition root, all CRITICAL/HIGH).
- `frontend-ui-architecture` — folder/layering rules for `client/`. **The
  repo-local copy at `.claude/skills/frontend-ui-architecture/SKILL.md`
  is the authoritative one to route to**, not any global personal copy at
  `~/.claude/skills/frontend-ui-architecture/SKILL.md`. Confirmed by diff:
  the repo-local file is grounded in this repo specifically — cites
  `client/AGENTS.md`'s "Where things live" section as authoritative
  (`.claude/skills/frontend-ui-architecture/SKILL.md:19-22`), names actual
  repo paths (`vendor/shared`, `vendor/ui`, `lib/api.ts`,
  `AgentCard/constants.ts`, `RunTraceDrawer/_components/PromptBlock/`)
  where the global copy has only generic placeholders. Both are on the
  Skill-tool's candidate list under the same unscoped name
  `frontend-ui-architecture`, so an implementer/reviewer session that just
  calls `Skill({skill: "frontend-ui-architecture"})` cannot control which
  one it gets — this is a real ambiguity, not a hypothetical, so the new
  agent's system prompt must state explicitly which one is authoritative
  for this repo and why.
- `golang-architecture` exists only as a **global** skill
  (`~/.claude/skills/golang-architecture/`, confirmed absent from this
  repo's own catalog — `.claude/skills/README.md`'s table has no
  `golang-architecture` row, and `ls .claude/skills/` has no
  `golang-architecture/` directory). It is nonetheless already relied on
  by this repo's own `pr-self-review` skill as a fixed critical-tier
  reviewer for any matched Go files
  (`.claude/skills/pr-self-review/SKILL.md:176`,
  `.claude/skills/pr-self-review/SKILL.md:3` description). So there is
  in-repo precedent for depending on this global skill's presence, but
  no in-repo guarantee it always exists.

Design grounding (external research, no WebFetch/WebSearch available to
`planner` itself — findings supplied by a parallel `researcher` pass):

- Anthropic, [sub-agents](https://code.claude.com/docs/en/sub-agents) — the
  read-only reviewer precedent uses `tools: Read, Grep, Glob, Bash` (no
  Write/Edit); `disallowedTools: Write, Edit` is documented as a more
  future-proof alternative that survives inherited-pool growth.
- Anthropic, [best-practices](https://code.claude.com/docs/en/best-practices)
  — the "adversarial review" pattern: a fresh-context subagent evaluates a
  diff/target against given criteria only and must "report gaps, not style
  preferences," explicitly warning against over-triggering.
- Cloudflare Blog ("Orchestrating AI Code Review at scale") — explicit
  "What NOT to Flag" negative-prompting prevents "a firehose of speculative
  theoretical warnings."
- arXiv 2606.14948 ("Architecture Quality Judge" pattern) — "every claim
  must cite concrete evidence... and receive a confidence score," evaluate
  each architectural axis independently, enumerate every concrete
  divergence rather than a bare pass/fail, static structural analysis only
  (imports, directory structure, dependency direction), no code execution.
- code.claude.com/docs/en/code-review — `REVIEW.md`'s "Verification bar":
  "behavior claims need a file:line citation in the source, not an
  inference from naming."

## Clarification (open items for the orchestrating session, not resolved
by this plan)

1. **Go-code scope** — should `architecture-reviewer` route to the global
   `golang-architecture` skill for any Go files it's asked to review, given
   this branch (`feat/conventions-multilang`) has active Go-indexer work?
   Recommendation: **yes, mirror `pr-self-review`'s existing precedent**
   (treat it as a fixed reviewer skill when Go files are in scope), but
   explicitly document that this is a dependency on a *global*, not
   repo-tracked, skill, and instruct the agent to report — not silently
   skip — if the `Skill` call for `golang-architecture` fails to load.
2. **`ReportFindings` tool availability for project subagents** — genuinely
   unverified from inside a planning session (no access to test a real
   subagent invocation). This plan does **not** put `ReportFindings` in the
   frontmatter `tools:` list for the first-cut file — it specifies the
   output contract using the proven, already-working `pr-self-review`
   `FINDINGS_SCHEMA` shape instead, and flags `ReportFindings` as a
   follow-up the orchestrating session should verify before adding it.

## Scope

- In scope: authoring `.claude/agents/architecture-reviewer.md` (frontmatter
  + system prompt + output contract), and this plan doc itself.
- Out of scope: modifying `onion-architecture`/`frontend-ui-architecture`/
  `golang-architecture`/`pr-self-review` SKILL.md content; wiring
  `architecture-reviewer` into `pr-self-review`'s automated pipeline (that
  skill already runs `onion-architecture`/`golang-architecture` directly as
  parallel reviewers — `.claude/skills/pr-self-review/SKILL.md:176` — so
  this new agent is a distinct, manually-invoked, broader-scope reviewer,
  not a replacement piece of that automation); adding `ReportFindings` to
  `tools:` until verified; any code changes to fix findings the agent would
  report (that's `implementer`'s job).

## Modules Touched

- `.claude/agents/architecture-reviewer.md` (new file) — must follow this
  repo's existing subagent frontmatter shape: `name`, `description`,
  `tools`, `model` (precedent: `.claude/agents/planner.md:1-6`,
  `.claude/agents/implementer.md:1-6`, `.claude/agents/researcher.md:1-6`
  — all three use a comma-separated `tools:` allowlist, none use
  `disallowedTools`).
- `docs/agents/architecture-reviewer-agent-plan.md` (this file) — follows
  the existing `docs/agents/{planner,implementer,researcher}-agent-plan.md`
  precedent format and the root convention at `CLAUDE.md:60-71`.

## Architectural Constraints

- `CLAUDE.md:60-71` — plan must be saved with a `**Status:**` line; this
  agent (the planner persona) does not save files itself.
- `.claude/skills/onion-architecture/SKILL.md:61-67` — the skill's own
  Severity Levels (CRITICAL = breaks dependency rule / couples logic to
  infra / bypasses composition root; HIGH = wrong layer; MEDIUM =
  organizational polish) are the severity vocabulary `architecture-reviewer`
  must defer to when reviewing `server/`/`reviewer-core/`.
- `.claude/skills/frontend-ui-architecture/SKILL.md:26-30` — same
  CRITICAL/HIGH/MEDIUM vocabulary, frontend-specific meaning.
- `.claude/skills/pr-self-review/SKILL.md:202-221` (`FINDINGS_SCHEMA`) and
  `:263-264` (severity bar: "CRITICAL means this skill's own rules call it
  a hard violation, a real bug, or a security hole — not a style
  preference. Return an empty findings array if nothing clears that bar")
  — the precedent output contract and severity-bar phrasing this new
  agent's own output contract should mirror.

## Relevant INSIGHTS.md Gotchas

None apply — "modules touched" for this meta-task is limited to
`.claude/agents/`/`docs/agents/`, neither of which has an `INSIGHTS.md`.

## Skills Implementer Will Need

None to *apply while authoring the file* — this is a prompt-authoring task.
Those skills (`onion-architecture`, `frontend-ui-architecture`,
`golang-architecture`) are instead the *subject matter* the new agent's
system prompt must correctly route to at review time.

## Proposed frontmatter

```yaml
---
name: architecture-reviewer
description: Use this agent to review a diff, PR, branch, or directory for architectural-boundary violations without changing any code. It applies this repo's onion-architecture skill to server/ and reviewer-core/ (dependency rule, ports/adapters, composition-root placement, routes→service→repository layering) and this repo's own frontend-ui-architecture skill to client/ (folder/layering, business-logic placement, data-access boundary) — routing each touched file to the right skill by path, and to golang-architecture for any *.go files if that skill is available in the environment. Every finding requires a file:line citation and cannot rest on inference from naming alone; each architectural axis (layering, dependency direction, composition-root placement, etc.) is evaluated independently; every concrete divergence found is reported, not a single pass/fail verdict. Does not flag style preferences, theoretical/unlikely-precondition issues, or pre-existing violations outside the reviewed diff/target. Has no Write or Edit access — it never fixes what it finds; pass findings to the implementer agent for fixes. If the target to review (which diff/PR/branch/directory) is not stated, it asks before reviewing.
tools: Read, Grep, Glob, Bash, Skill, AskUserQuestion
model: sonnet
---
```

Design decisions:

- **Allowlist over `disallowedTools`**: this repo's three existing
  subagents all use an explicit `tools:` allowlist, none use
  `disallowedTools`. Match that precedent for consistency rather than
  adopting the more-future-proof-but-inconsistent `disallowedTools: Write,
  Edit` pattern. A one-line swap later if the orchestrating session
  prefers the alternative form.
- **`Bash` included**: needed for `git diff`/`git log`/`find`/`rg`-style
  structural discovery — not for running the app or executing code under
  review. The system prompt must state this restriction explicitly.
- **No `ReportFindings`**: not added — see Clarification #2 above. Output
  contract instead uses a markdown/JSON block modeled on `pr-self-review`'s
  `FINDINGS_SCHEMA`.
- **`AskUserQuestion` included**: mirrors `planner`/`researcher`'s "clarify
  first" pattern for when no target (diff/PR/branch/directory) is
  specified.

## System-prompt outline (section by section)

a. **Role statement** — read-only architecture reviewer; never writes or
   edits code; evaluates structure only (imports, directory placement,
   dependency direction) via static reading, never by executing the code
   under review.

b. **Before reviewing** — identify the target (diff, PR number, branch, or
   directory) and the languages/modules it touches. If no target is
   stated, use `AskUserQuestion` rather than guessing scope.

c. **Skill routing table**:
   - Any file under `server/src/modules/*` or `server/src/platform/*` or
     `reviewer-core/**` → load `onion-architecture` via `Skill`.
   - Any file under `client/src/**` → load `frontend-ui-architecture` via
     `Skill`, **and state explicitly that this repo's own copy at
     `.claude/skills/frontend-ui-architecture/SKILL.md` is authoritative**.
   - Any `*.go` file → attempt to load `golang-architecture` via `Skill`
     (a global skill, not tracked in this repo). If the `Skill` call fails
     to resolve it, **report that explicitly as a finding-level note**
     rather than silently skipping Go files or fabricating rules.
   - A file matching none of the above (docs, config, `e2e/`) is out of
     scope — note it as skipped, don't invent architectural rules for it.

d. **Analysis discipline** (per the AQJ pattern):
   - Evaluate each architectural axis independently.
   - Enumerate every concrete divergence found, not a single pass/fail.
   - Every finding requires a file:line citation to the actual source
     under review — never rest a finding on inference from a file or
     function *name* alone.
   - Verification-bar phrasing: "CRITICAL means the matched skill's own
     rules call it a hard violation — not a style preference."

e. **Explicit "do not flag" list**:
   - Style preferences not codified as CRITICAL/HIGH in the routed skill's
     own Severity Levels section.
   - Theoretical/unlikely-precondition issues.
   - Pre-existing violations in code the current diff/target doesn't
     touch, unless explicitly asked for a full-repo sweep.
   - Anything the routed skill's own document doesn't call CRITICAL or
     HIGH — MEDIUM findings are allowed but must be labeled MEDIUM.

f. **Scope boundaries** — never fixes what it finds; never commits/pushes/
   opens PRs; not a substitute for `pr-self-review`'s automated gate (that
   skill already runs `onion-architecture`/`golang-architecture` as
   parallel CI-style reviewers per PR — this agent is for ad hoc/broader/
   manual review instead).

## Output contract

Findings returned as a markdown report with a fenced JSON array:

```json
{
  "findings": [
    {
      "file": "server/src/modules/reviews/service.ts",
      "line": 42,
      "skill": "onion-architecture",
      "severity": "CRITICAL",
      "summary": "service.ts imports drizzle-orm directly",
      "rationale": "Line 42: `import { eq } from 'drizzle-orm'` inside service.ts breaks the dependency rule (.claude/skills/onion-architecture/SKILL.md:73-85) — service layer must only depend on repository methods/port interfaces, never Drizzle directly."
    }
  ]
}
```

Fields: `file`, `line`, `skill` (which routed skill produced this finding —
added relative to `pr-self-review`'s schema since this agent spans multiple
skills in one run), `severity` (`CRITICAL`/`WARNING`/`SUGGESTION`, mapped
from the routed skill's own CRITICAL/HIGH/MEDIUM), `summary`, `rationale`
(must include the specific rule citation). All fields required. Empty
`findings` array is the correct output when nothing clears the severity bar
— never pad with SUGGESTION-tier noise to appear thorough. Report wrapper:
a short prose header naming the target reviewed, which skills were routed
to which files, and any "skipped" notes.

## Discipline (closing section)

- No finding without a file:line citation to the actual reviewed source.
- No `Write`/`Edit` attempt, ever, even via `Bash` file redirection — state
  this explicitly.
- If the routed skill itself can't be loaded, report that as a gap, don't
  invent rules from memory.

## Work Items

1. **Author frontmatter.** File: `.claude/agents/architecture-reviewer.md`.
   Depends on: none. Acceptance: valid YAML frontmatter block, no
   `Write`/`Edit` present anywhere in `tools:`.
2. **Author system-prompt body**, sections a–f above, in order.
3. **Author the output contract** (JSON findings block as specified above).
4. **Add the Discipline closing section.**

## Verification

- `cat .claude/agents/architecture-reviewer.md` — confirm frontmatter
  parses as valid YAML, `tools:` line contains no `Write`/`Edit`.
- **Constructed-violation test** (use a scratchpad dir, not the working
  tree): copy an existing `server/src/modules/*/service.ts`, add a
  top-level `import { eq } from 'drizzle-orm'` line (the exact CRITICAL
  anti-pattern named in `onion-architecture/SKILL.md:73-85`), then invoke
  the new agent against that file. Confirm the returned findings cite the
  exact injected line, mark it `CRITICAL`, cite the skill doc, and confirm
  the agent made no `Write`/`Edit` tool call during the run. Delete the
  scratchpad copy afterward.
- **Frontend-routing test**: invoke it against a real `client/src/**`
  file/diff and confirm the report states it used the repo-local
  `frontend-ui-architecture/SKILL.md`.
- **Ambiguous-target test**: invoke it with no target stated and confirm
  it uses `AskUserQuestion` instead of guessing scope.
- **Go-file-unavailable test** (only if Go scope is confirmed for v1):
  invoke it against a `.go` file in an environment where the global
  `golang-architecture` skill is confirmed absent, and confirm the report
  explicitly states Go architecture was not reviewed.

---

**Sources consulted:**
- `.claude/agents/planner.md`, `.claude/agents/implementer.md`,
  `.claude/agents/researcher.md`
- `.claude/skills/onion-architecture/SKILL.md`,
  `.claude/skills/frontend-ui-architecture/SKILL.md`,
  `.claude/skills/pr-self-review/SKILL.md`
- `docs/golang-architecture-skill-plan.md`
- Anthropic, [Create custom subagents](https://code.claude.com/docs/en/sub-agents)
- Anthropic, [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices)
- Anthropic, [Code Review](https://code.claude.com/docs/en/code-review)
- [Cloudflare Blog — Orchestrating AI Code Review at scale](https://blog.cloudflare.com/ai-code-review/)
- [arXiv 2606.14948 — Architecture Quality Judge](https://arxiv.org/html/2606.14948v2)
