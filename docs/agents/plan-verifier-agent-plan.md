# Development Plan: `plan-verifier` subagent

**Status:** done — `../../.claude/agents/plan-verifier.md` created.

## Context

Fourth stage bound to the existing `implementation-planner` → `implementer` pipeline:
`implementation-planner` produces a Development Plan (`.claude/agents/implementation-planner.md:39-68`),
`implementer` executes it and emits an Implementation Report
(`.claude/agents/implementer.md:45-65`), but nothing in the repo today
independently checks the *resulting code* against every point of that
plan. `implementer` explicitly disclaims that judgment itself: its own
"Scope boundaries" state it does "not perform architectural or security
review" and must push anything it's unsure about into the report's
"Deferred" section rather than verifying it
(`.claude/agents/implementer.md:31-39`). `plan-verifier` closes that gap:
it is a fresh-context, read-only checker that verifies the implementer's
own self-attestation (Completed / Tests Run / Self-Verification,
`.claude/agents/implementer.md:50-57`) against the actual diff and the
actual plan, rather than trusting either document's prose.

This is distinct from the existing `pr-self-review` skill
(`.claude/skills/pr-self-review/SKILL.md:2-3`), which matches a PR's changed
files against the *general* skill catalog and is diff-scoped, not
plan-scoped. `pr-self-review` never reads a specific Development Plan's
Work Items or acceptance criteria; `plan-verifier` does nothing else. Both
may run on the same PR without overlap.

Design grounding (external research supplied by a parallel `researcher`
pass; `implementation-planner` itself has no WebFetch/WebSearch):

- Anthropic, [best-practices](https://code.claude.com/docs/en/best-practices)
  — the documented adversarial-review template is almost exactly this
  role: *"Use a subagent to review the … diff against PLAN.md. Check that
  every requirement is implemented, the listed edge cases have tests, and
  nothing outside the task's scope changed. Report gaps, not style
  preferences."* Also warns a reviewer instructed to "find gaps" will
  over-report even on sound work — *"flag only gaps that affect
  correctness or the stated requirements."*
- Augment Code, "Adversarial Code Review" — measured self-preference/
  leniency bias, worst on flawed code. Prescribes: fresh context (diff +
  criteria only), a skeptical checklist system prompt, read-only tools, a
  "structured verdict with issue list" output — not prose.
- Galileo, "LLM-as-a-Judge mistakes" — a judge call can produce a
  correct-looking verdict with a hallucinated justification; a single
  evaluation call shouldn't be trusted as ground truth (mitigation:
  multiple judge calls/majority vote — noted as *optional future
  enhancement*, this plan defines a single-agent, single-pass verifier).
- Evidently AI — mitigations for grounding verdicts: require reasoning
  before the verdict, require structured (not prose) output, validate
  against concrete evidence rather than assertion.
- BrainGrid, "How to Write Acceptance Criteria Your AI Agent Can Actually
  Verify" — a criterion is verifiable only if there's an unambiguous
  pass/fail procedure; test: *"could two people disagree on whether it
  passed? If yes, it needs more specificity."* This is the load-bearing
  rule for the user's "не підміняючи цю перевірку загальними порадами"
  requirement — `plan-verifier` must refuse to rubber-stamp vague criteria
  as MET/NOT MET and instead flag them UNVERIFIABLE.

## Scope

- In scope: authoring `.claude/agents/plan-verifier.md` (frontmatter +
  system prompt) as a new, read-only, plan-scoped verification subagent.
- In scope: this plan document itself, per root `CLAUDE.md`'s "Feature
  planning" convention (`CLAUDE.md:60-71`).
- Out of scope: updating `.claude/agents/README.md`'s pipeline
  table/diagram to add `plan-verifier` as a fourth stage — flagged as a
  natural fast-follow, not authorized by this plan.
- Out of scope: any change to `implementation-planner.md` or `implementer.md` themselves.
- Out of scope: wiring `plan-verifier` into the `pr-self-review` skill's
  gate logic (`.claude/skills/pr-self-review/SKILL.md:119-128`) — separate,
  explicitly-scoped task.
- Out of scope: any multi-call/majority-vote judging (Galileo's mitigation)
  — this plan defines a single-pass verifier.

## Modules Touched

- `.claude/agents/plan-verifier.md` (new file) — must match the frontmatter
  shape of the three existing agents. All three use a positive `tools:`
  allowlist only (confirmed via `grep -n "^tools:" .claude/agents/*.md`);
  for consistency with that established repo convention, this plan uses
  `tools:` (allowlist), not `disallowedTools`.
- `docs/agents/plan-verifier-agent-plan.md` (this file) — `**Status:**`
  line required per `CLAUDE.md:60-71`.

## Architectural Constraints

- Single-responsibility + least-privilege tool scoping — `plan-verifier`
  gets no `Write`/`Edit` and no `Agent`/`Task` tool. It verifies; it does
  not fix, and it does not delegate to other subagents.
- `Bash` is included specifically so the agent can *run* the plan/report's
  cited test/typecheck commands itself and quote real output — not for
  general shell scripting.
- `Skill` is included (read-only — the `Skill` tool only loads skill
  content) so that when checking a plan's "Architectural Constraints" or
  "Skills Implementer Will Need" sections, the verifier can load the
  actual skill text the same way `implementation-planner.md:21-24` does, instead of
  asserting a rule from memory.
- Fresh-context adversarial review pattern — `plan-verifier` runs as its
  own subagent invocation specifically so it does not inherit the
  `implementer` conversation's reasoning trail or self-preference bias; it
  must re-derive every verdict from the plan text, the report text (or
  diff), and direct inspection — never from "the implementer said so."
- `implementer`'s explicit non-verification of architecture/security
  (`.claude/agents/implementer.md:36-39`) is the specific gap
  `plan-verifier` is designed to close for the "Architectural Constraints"
  section of a plan — this must be a first-class checked section in the
  output, not folded into general Work Item checking.
- Plans are self-contained artifacts — `plan-verifier` must be able to run
  against a plan alone (inferring the report from `git diff`/`git log`/
  re-run commands) since a plan may be checked well after the
  implementer's own context is gone.

## Relevant INSIGHTS.md Gotchas

None of this repo's four package `INSIGHTS.md` files are relevant —
`plan-verifier` touches only `.claude/agents/` and `docs/agents/`, neither
of which is one of the four `AGENTS.md`-governed packages listed in root
`CLAUDE.md:11-16`.

## Skills Implementer Will Need

None. Authoring a single `.md` agent-definition file is prose/YAML, not
application code — none of the cataloged skills govern
`.claude/agents/*.md` content.

## Proposed frontmatter

```yaml
---
name: plan-verifier
description: Use this agent to check already-finished code against every point of an already-written Development Plan and its Implementation Report — never as a substitute for that check via generic advice or style opinions. Reads the plan in full (from the implementation-planner agent or a docs/<slug>-plan.md file) and the implementer's Implementation Report in full (or, if none was produced, reconstructs the equivalent from git diff/git log and by re-running the test/typecheck commands the plan or report cite — never trusting a report's claims without re-checking them), then produces one verdict per Work Item/acceptance criterion — MET, NOT MET, or UNVERIFIABLE — each backed by concrete evidence: a file:line citation or an actually-executed command and its real output, never a bare assertion. Explicitly re-checks whether the plan's "Architectural Constraints" section was honored in the resulting code by inspecting the code directly, closing the gap the implementer agent leaves open (implementer does not perform architectural/security review itself). Applies a strict verifiability test to every plan criterion — if two people could reasonably disagree on whether it passed, it is flagged UNVERIFIABLE rather than guessed. Does not fix, edit, or write anything; does not commit, push, or open PRs; does not perform a general/freeform code review beyond what the plan itself specifies. Findings route back to the user or the implementer agent to act on. Trigger on "verify this against the plan", "check the code against docs/<slug>-plan.md", "did the implementer actually finish X", "audit this PR/diff against its plan".
tools: Read, Grep, Glob, Bash, Skill, AskUserQuestion
model: sonnet
---
```

## System-prompt outline (section by section)

- **"Before verifying"**: (a) read the Development Plan in full, including
  every section listed in `implementation-planner.md:39-68` — Context, Scope, Modules
  Touched, Architectural Constraints, INSIGHTS.md Gotchas, Skills
  Implementer Will Need, Work Items, Verification; (b) locate and read the
  Implementation Report in full (`implementer.md:45-65` shape); if none
  exists, reconstruct the equivalent from `git log`/`git diff` and by
  independently re-running every test/typecheck command the plan's
  "Verification" section or the report's "Tests Run" section names — do
  not accept the report's stated pass/fail without re-running it; (c)
  re-read the `AGENTS.md` of every module the plan claims to touch, even
  though the plan already cites it — the plan may be stale.
- **"Clarify first"**: if it's not clear which plan file, which
  implementation (branch/commit/PR), or which report to check, use
  `AskUserQuestion` before verifying.
- **"Verification method"**: for every Work Item / acceptance criterion,
  in order: (1) extract the literal criterion text; (2) apply the
  BrainGrid test — "could two people disagree on whether it passed?" — if
  yes, UNVERIFIABLE as written; record what would need to be added to make
  it checkable, and stop there for that row (never guess MET/NOT MET for
  an ambiguous criterion); (3) otherwise, gather direct evidence — read
  the actual changed files and cite `file:line`, or run the actual command
  and quote its real output — and assign MET or NOT MET from that evidence
  alone. Separately and explicitly re-verify the plan's "Architectural
  Constraints" section against the resulting code by direct inspection
  (not the report's self-attestation). Separately verify "Scope" — scan
  the diff for any change outside the plan's "In scope" bullets and report
  it as a distinct out-of-scope-change finding. Separately spot-check
  "Skills Implementer Will Need" — for each named skill, load its content
  via `Skill` and check the diff against at least its most binding
  rule(s), rather than trusting the report's "skill(s) applied" note.
- **"Anti-genericity rule"** (hard requirement): no overall verdict may
  appear without a fully itemized per-criterion table preceding it; no
  criterion from the plan may be silently dropped from that table; a
  "looks generally fine" remark must never stand in for a missing
  per-criterion row; never produce a prose-only review.
- **"Grounding rule"**: every verdict requires evidence gathered before
  the verdict is written, never a verdict followed by after-the-fact
  justification; if no real evidence can be produced for a criterion, the
  verdict is UNVERIFIABLE, never a confident guess.
- **"Scope boundaries"**: read-only; never edits/fixes what it finds;
  never commits/pushes/opens PRs; not a general/freeform code reviewer —
  stays scoped to the plan's own stated criteria; does not duplicate
  `pr-self-review`'s skill-compliance sweep — if a finding clearly belongs
  to a cataloged skill's rules and isn't already covered by a plan
  criterion, note it as a suggestion to run that skill/`pr-self-review`
  separately rather than adjudicating it itself.
- **Output: "Plan Verification Report"** — template below.
- **"Discipline"**: never let a report's self-attestation stand in as
  evidence — verify independently every time; no verdict without
  evidence; an ambiguous criterion is UNVERIFIABLE, never a coin flip;
  this is a single-pass judge call (no majority vote per Galileo's
  sampling-variance caution) — when a verdict is borderline, prefer
  UNVERIFIABLE over a confident guess.

### Output: Plan Verification Report template

```markdown
## Plan Verification Report

**Plan:** <path or title>
**Implementation Report:** <path, or "reconstructed from git diff <ref> + re-run commands">

### Work Item / Acceptance Criterion Verdicts
| # | Criterion (from plan) | Verdict | Evidence |
|---|---|---|---|
| 1 | <literal criterion text> | MET / NOT MET / UNVERIFIABLE | file:line, or command run + real output |

### Architectural Constraints Verdicts
| Constraint (from plan) | Verdict | Evidence |
|---|---|---|

### Scope Compliance
- In-scope items covered: ...
- Out-of-scope changes detected: ... (or "none found")

### Skills Compliance (spot-check)
| Skill | Verdict | Evidence |
|---|---|---|

### Ambiguous / Under-Specified Criteria
- <criterion> — why it fails the "could two people disagree" test — what would make it verifiable

### Overall Verdict
- PASS / PASS WITH GAPS / FAIL — derivable only from the tables above, no new claims introduced here
```

## Work Items

1. **Write frontmatter** — files: `.claude/agents/plan-verifier.md` (new);
   depends on: none; acceptance: `tools: Read, Grep, Glob, Bash, Skill,
   AskUserQuestion` (no `Write`, `Edit`, `Agent`, `Task`), `model: sonnet`.
2. **Write the system-prompt body** — files: `.claude/agents/plan-verifier.md`;
   depends on: #1; acceptance: contains all named sections above, in
   order.
3. **Define the Output: Plan Verification Report template** — files:
   `.claude/agents/plan-verifier.md`; depends on: #2; acceptance: contains
   the exact tables above, not prose.
4. **Self-consistency pass** — files: `.claude/agents/plan-verifier.md`;
   depends on: #1-#3; acceptance: re-read the finished file end-to-end and
   confirm (a) it never instructs the agent to fix/edit code anywhere in
   the body, contradicting its own `tools:` line; (b) every "Discipline"/
   "Anti-genericity" rule is actually enforced by a concrete instruction
   elsewhere in the prompt, not just asserted as a principle; (c) the file
   is internally consistent with `implementation-planner.md`/`implementer.md`'s template
   vocabulary (Work Items, Architectural Constraints, Modules Touched,
   Scope).

## Verification

- `cat .claude/agents/plan-verifier.md` — frontmatter parses as valid
  YAML; `tools:` contains exactly `Read, Grep, Glob, Bash, Skill,
  AskUserQuestion`; no `Write`, `Edit`, `Agent`, or `Task` anywhere.
- Invoke via `Agent` with `subagent_type: plan-verifier` against a real,
  already-"done" plan+code pair already in this repo —
  `docs/agents/implementation-planner-agent-plan.md` (Status: done) against
  `.claude/agents/implementation-planner.md` — and confirm the output is a filled-in
  per-criterion table with real `file:line`/command-output evidence, not
  a prose summary, and that its "Architectural Constraints Verdicts" table
  is populated from direct code inspection rather than restating the
  plan's own claims.
- Invoke it a second time against a real, *deliberately incomplete* plan
  already in this repo — `docs/pr-self-review-skill-plan.md` (Status: in
  progress, step 11 deferred) — and confirm it correctly marks the undone
  step(s) NOT MET or UNVERIFIABLE with a stated reason, rather than
  rubber-stamping an overall PASS.
- Confirm it refuses to guess on at least one deliberately vague/
  under-specified acceptance criterion (e.g. "improve performance" with no
  threshold) and flags it UNVERIFIABLE with the "could two people
  disagree" reasoning stated explicitly, rather than silently passing or
  failing it.
- Confirm it does not attempt any `Write`/`Edit`/`git commit`/`git push`/
  `gh pr create` during either run.

---

**Sources consulted:**
- `.claude/agents/implementation-planner.md`, `.claude/agents/implementer.md`,
  `.claude/agents/researcher.md`
- `.claude/skills/pr-self-review/SKILL.md`
- `CLAUDE.md`
- Anthropic, [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices)
- [Augment Code — Adversarial Code Review](https://www.augmentcode.com/guides/adversarial-code-review)
- [Galileo — Are You Making These 7 LLM-as-a-Judge Mistakes?](https://galileo.ai/blog/why-llm-as-a-judge-fails)
- [Evidently AI — LLM-as-a-judge: a complete guide](https://www.evidentlyai.com/llm-guide/llm-as-a-judge)
- [BrainGrid — How to Write Acceptance Criteria Your AI Agent Can Actually Verify](https://www.braingrid.ai/blog/how-to-write-acceptance-criteria-ai-agent-can-verify)
