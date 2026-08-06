# PR Self Review skill

**Status:** in progress — steps 1, 8, 9, 10 done. Step 11 (real-PR
validation) has now run twice: once against PR #7 (Match-only, no matched
skills, posted nothing — see the 2026-08-06 correction below) and once
against PR #8 (a real feature PR, 4 skills reviewed, gate tripped on 7
CRITICAL findings, posted + labeled — see the 2026-08-06 second correction
below, which found a real design flaw in the enforcement mechanism itself).
A push-triggered re-check is still not exercised.

**2026-08-06 correction, from the first live run:** two real bugs surfaced
running the skill by hand, both now fixed in `SKILL.md`:

1. **`args` arrives as a raw JSON string, not a parsed object**, in this
   harness's `Workflow` tool — confirmed with an isolated smoke test
   (`log(JSON.stringify(args))` printed a *string*, not an object). The
   script now defensively does
   `const parsedArgs = typeof args === 'string' ? JSON.parse(args) : args`
   before reading `.catalog`/`.files`/`.diff` off it. Without this, every
   invocation throws `undefined is not an object (evaluating 'files.join')`
   before a single agent runs.
2. **The catalog-exclusion list didn't actually exclude anything.** Step
   2's `cat .claude/skills/README.md` dumps the catalog *table* verbatim,
   which still lists `engineering-insights`/`mermaid-diagram`/`pr-self-review`
   as rows — omitting their per-skill description blocks (the only filter
   that existed) left them fully visible and selectable from the table.
   First real Match run picked `engineering-insights` for four
   barely-touched `INSIGHTS.md` files (2-line diffs, not the "substantive
   new dated entries" the matcher's own rationale claimed — a second,
   smaller finding: the matcher can narrate an overconfident, factually
   wrong justification for a bad match). Fixed two ways: `grep -Ev` strips
   those three rows from `README.md`'s table before it's ever shown to the
   matcher, **and** the Match prompt now names all three by name as a
   second guard — a stripped row is one bad `grep` away from silently
   reappearing, so don't rely on the table alone.

With both fixes, re-running Match-only against PR #7's scoped diff (the 35
files unique to this branch vs. `origin/feat/findings-by-severity` — see
"Scope note" below) correctly returned zero matches, and the skill posted
nothing — the correct outcome for a diff that's almost entirely new skill
documentation with no real application code in it.

**Scope note, not itself a bug:** PR #7 is based on `main`, which doesn't
have PR #5 (`feat/findings-by-severity`) merged yet — so PR #7's *full*
diff via `gh pr diff` is 71 files (everything PR #5 already carries, plus
this branch's own 2 commits). Reviewing that whole thing would have been
expensive and pointless (re-reviewing already-written, already-reviewed
work). This run instead scoped to `git diff origin/feat/findings-by-severity...HEAD`
— the 35 files actually unique to this branch. `SKILL.md`'s own "scope the
PR" step (step 1) doesn't account for a PR stacked on an unmerged parent;
worth a follow-up note in `SKILL.md` if this repo keeps stacking PRs this
way, but not fixed now since it didn't affect this particular run's
correctness.

**2026-08-06 second correction, from the first gate-tripping run (PR #8):**
a real design flaw in the "post GitHub `REQUEST_CHANGES`" enforcement
mechanism itself — the core premise of the whole "block merging" story:

`gh api .../reviews` with `event: REQUEST_CHANGES` came back
**`422 Unprocessable Entity — "Review Can not request changes on your own
pull request"`** — GitHub blocks self-`REQUEST_CHANGES` with the exact same
rule as self-`APPROVE`, which the skill had only ever guarded against for
`APPROVE`. Since this skill's entire use case is a single account (the
fork-only workflow, [[feedback_fork_workflow]]) opening AND reviewing its
own PRs, `REQUEST_CHANGES` can **never** actually post here — the plan's
original mental model ("post `REQUEST_CHANGES`, that's the real GitHub-side
block") was wrong from the start; that specific mechanism doesn't apply to
self-authored PRs at all, on any repo, regardless of branch protection.

Fixed: `event` is now unconditionally `'COMMENT'` in `SKILL.md`'s
`Workflow` script; `gateTripped` still drives the `blocked-critical` label
and this session's own refusal to run `gh pr merge` — those two are now
the *actual* enforcement, not a side note. The review body's header text
still reads "Changes requested" as plain-English status copy, it's just
carried by a `COMMENT`-type review now. Confirmed working end-to-end on PR
#8: 4 skills reviewed (cost-scoped, not the full 9-match catalog — that
scoping choice itself was also asked and confirmed, not a fallback), 7
CRITICAL findings (an SSRF via unrestricted server-side `fetch` on a
user-supplied URL, a decompression-bomb via uncapped in-memory archive
extraction, three non-transactional multi-step DB writes, a raw-`fetch`
onion-architecture port violation, a zod validation-boundary gap), review
posted as `COMMENT`, `blocked-critical` label attached, merge refused in
chat.

Still not started/exercised: a push-triggered re-check (posting a second,
correcting review after a fix lands), and the full 9-skill match on a real
feature PR (PR #8 deliberately ran only 4 of its 9 matches to control
cost — a real, recurring tension worth watching: this repo's PRs are
getting large enough that even the narrowed-scope-diff-per-subagent fix
from the PR #7 correction isn't enough on its own; matching may need its
own cost cap eventually, not just diff-scoping).

## Context

Every skill in `.claude/skills/` today is invoked ad hoc — the agent decides
relevance from its own description on the fly. There's no gate that runs
*all* applicable skills over a diff and actually stops a bad PR from being
merged.

Goal: a new skill, `pr-self-review`, used during local feature development
on *this* repo. Flow: the user asks Claude to build something and open a
PR; the moment `gh pr create` succeeds, `pr-self-review` runs automatically
against that PR's diff, figures out which *other* skills in the catalog
apply to the files touched, runs each matched skill as an independent
reviewer over just its relevant files, and — if any finding comes back
`CRITICAL` — posts that as a real GitHub-visible signal so the PR can't be
casually merged, not just a chat warning.

**Correction from the first pass of this plan:** originally scoped as a
*pre*-PR-creation gate with chat-only enforcement. The user clarified the
actual flow — creation should never be blocked, only merge, and the block
has to be visible on GitHub itself (someone could still click Merge in the
web UI even if Claude refuses in chat). A local git hook doesn't reach that
either — hooks fire on local `git` plumbing (commit/push), never on
GitHub's remote merge action — so this version drops the hook idea
entirely in favor of a real GitHub review state.

Decisions already made (asked the user directly, since these are real
architecture forks, not implementation detail):

- **Trigger: automatic, immediately after `gh pr create` succeeds**, inside
  the same Claude Code session that created the PR. Not a separate manual
  step, not conditional on the user remembering to ask.
- **Block mechanism: post a real GitHub PR review, `REQUEST_CHANGES`,
  when ≥1 `CRITICAL` finding survives** — via `gh pr review <n>
  --request-changes --body "<report>"`. This is the exact mechanism
  DevDigest's own product already uses for *its* reviews: severity →
  event is computed deterministically in
  `reviewer-core/src/output/to-review.ts` (`gateTriggered()`,
  `SEV_RANK`/`FAIL_ON_MIN_RANK`, default `ci_fail_on: 'critical'` in
  `server/src/vendor/shared/contracts/knowledge.ts:187`). This skill is
  the self-hosted version of that same pattern, run on dev-digest's own
  PRs instead of a customer's. Claude also refuses to run `gh pr merge`
  itself for the rest of the session unless the user explicitly overrides.
  **Explicitly out of scope for this plan:** configuring GitHub branch
  protection (`Require approvals` / `Require status checks`) on `main` so
  the merge button is actually greyed out for *everyone*, not just
  advisory. Without it, a collaborator with write access can still click
  Merge past a pending Request-changes review — a known, accepted gap;
  revisit only if the user asks for that infra change separately (it
  edits shared GitHub repo config and needs its own explicit go-ahead).
- **Orchestration is parallel subagents via the `Workflow` tool.** One
  subagent per matched-skill × its relevant files, run through
  `pipeline()`, not one agent serially loading every skill. Scales to
  however many skills match without ballooning one context window, and
  `Workflow`'s own tool contract explicitly allows a skill's instructions
  to trigger it without the user separately opting in.
- **Severity taxonomy is borrowed, not invented.** DevDigest's own review
  engine already defines `Severity = z.enum(['CRITICAL', 'WARNING',
  'SUGGESTION'])` in `server/src/vendor/shared/contracts/findings.ts:11`
  (mirrored in `client/src/vendor/shared/contracts/findings.ts`). This
  meta-skill reuses those exact three labels, and the same gate logic, so
  "critical" means the same thing here as it does inside the app it's
  built for.
- **Findings post as inline PR comments, not one wall-of-text body.** Same
  shape the app's own `GitHubReviewPayload` already supports (body +
  optional inline comments, posted via
  `octokit.rest.pulls.createReviewComment` in
  `server/src/adapters/github/octokit.ts:228`) — anchor each finding at its
  `file:line` instead of dumping a flat list into the review body.
- **Re-check on every push to an open PR, not just at creation.** A single
  run right after `gh pr create` only covers the first commit; if the user
  asks Claude to push a fix into the same PR, the gate has to re-run
  automatically then too, and post a fresh review reflecting the new head
  SHA.
- **Fail closed on internal errors.** If the skill-matching agent or a
  review subagent errors out (`agent()`/`pipeline()` resolve that slot to
  `null` per the `Workflow` tool's own contract), that is **not** the same
  as "no findings." Treat an incomplete run the same as a tripped gate —
  don't post a clean "mergeable" comment on partial results.
- **A visible PR label, in addition to the review state.** Toggle
  `blocked-critical` (create the label once if missing) on/off as the gate
  trips/clears — shows up in `gh pr list` and the GitHub PR list view
  without opening the PR, and doesn't depend on the branch-protection
  change that's explicitly out of scope.
- **Skip itself.** If the PR's diff touches `.claude/skills/pr-self-review/**`,
  don't include `pr-self-review` in its own candidate pool for step 3 — no
  reviewing-itself recursion.

## Plan

1. `.claude/skills/pr-self-review/SKILL.md` — new skill. Frontmatter:
   `name: pr-self-review`, `allowed-tools: Bash, Read, Grep, Glob,
   Workflow`, `description` covering trigger phrases — "review this PR",
   "self review", "/pr-self-review", "check this PR for critical issues"
   — **and** explicitly: "invoke automatically, immediately after `gh pr
   create` succeeds, and again after any `git push` to a branch that has
   an open PR, against that PR." Body documents steps 2–7 below as agent
   instructions (prose, not code — the actual orchestration logic lives in
   the `Workflow` script the skill tells the agent to run).

2. **Scope the diff** (plain `Bash`, no agent) — the PR itself is the
   source of truth, not local working-tree state: `gh pr view <number>
   --json number,headRefName,baseRefName,files` for the touched-file list,
   `gh pr diff <number>` for the actual hunks. Exclude lockfiles and
   generated paths (`pnpm-lock.yaml`, `package-lock.json`, `*.snap`,
   `dist/**`, `.next/**`) before anything downstream sees the list — no
   skill can meaningfully review those. If the file list is entirely under
   `.claude/skills/pr-self-review/**`, skip straight to reporting "self-edit,
   nothing to review" — never invoke this skill on its own diff.

3. **Match skills to files** — one `agent()` call, schema-constrained to
   `{matches: [{skill: string, files: string[], reason: string}]}`.
   Prompt includes: the full catalog table from
   `.claude/skills/README.md`, each candidate skill's `description`
   frontmatter, and the scoped file list from step 2. Exclude
   `engineering-insights`, `mermaid-diagram`, and `pr-self-review` itself
   from the candidate pool — they're process/meta skills, not code
   reviewers. Instruct the matcher explicitly to reason about actual file
   content, not just the README's coarse Backend/Frontend/Full-stack
   `Scope` column — e.g. `zod` should match only if a touched file has a
   `z.object`/`z.string()` schema, not every full-stack file by default.

4. **Parallel review** — `pipeline(matches, m => agent(...))`, one call per
   matched `{skill, files}` pair, `phase: 'Review'`. Each subagent's prompt:
   load the matched skill via the `Skill` tool, then apply only that
   skill's rules to the diff hunks for its assigned files (not the whole
   diff). Schema-constrained output:
   `{findings: [{file, line, severity: 'CRITICAL'|'WARNING'|'SUGGESTION',
   summary, rationale}]}`, severity values matching `findings.ts:11`
   verbatim. Per the `Workflow` tool's own contract, a stage that throws
   drops that item to `null` — after the `pipeline()` call, explicitly
   separate `results.filter(Boolean)` (completed reviews) from the matches
   whose result came back `null` (failed/errored reviews) instead of
   letting `.filter(Boolean)` silently erase the failures.

5. **Aggregate + decide** — plain JS in the workflow script: flatten every
   completed stage's findings, dedupe identical `(file, line, skill)`
   triples, and keep the list of skills whose review errored from step 4
   alongside them. Reuse the app's own gate shape rather than reinventing
   it — mirror `gateTriggered()`/`FAIL_ON_MIN_RANK` from
   `reviewer-core/src/output/to-review.ts` with `ci_fail_on: 'critical'` as
   the fixed default: gate trips iff ≥1 `CRITICAL` finding **or** any
   matched skill's review errored (fail closed — an incomplete review is
   never treated as evidence of "clean"). Build the review body: a table
   of skill → files reviewed → finding counts by severity (with errored
   skills marked `⚠️ review incomplete`, not silently omitted), then the
   full finding list — same shape the app already renders into a GitHub
   review body, so `to-review.ts`'s markdown formatting can be
   reused/mirrored instead of invented fresh. Also build the inline-comment
   list for step 6: one `{path, line, body}` entry per finding.

6. **Post the GitHub review + report in chat** — `SKILL.md` instructs the
   calling agent to call `gh api repos/{owner}/{repo}/pulls/{number}/reviews
   -f event=... -f body=... -f 'comments[]=...'` (or the equivalent
   `octokit`-style payload if run from a script — mirrors
   `GitHubReviewPayload`'s body + inline-comments shape from
   `reviewer-core/src/output/to-review.ts`), anchoring each finding at its
   `file:line` via the comments array rather than dumping a flat list into
   the body:
   - Gate tripped by a `CRITICAL` finding → `event: REQUEST_CHANGES`, then
     tell the user `🚫 Posted "Changes requested" — N critical finding(s)
     — do not merge until resolved`, and refuse to run `gh pr merge` on
     this PR for the rest of the session unless the user explicitly
     overrides.
   - Gate tripped by an errored review (no `CRITICAL` found, but a skill
     didn't finish) → also `event: REQUEST_CHANGES`, body opens with
     `⚠️ Review incomplete — N/M skill reviews failed to run, treat as NOT
     verified`. Tell the user the same "do not merge" line — fail-closed
     means an incomplete run blocks exactly like a critical finding, just
     with a different message.
   - Gate not tripped → `event: COMMENT` (**not** `APPROVE` — GitHub
     rejects self-approval, and the PR author here is the same account
     `gh` is authenticated as per [[feedback_fork_workflow]]'s fork-only
     setup). Tell the user `✅ No critical findings — posted as a comment,
     mergeable`, still listing warnings/suggestions as FYI.
   - Zero skills matched (e.g. a docs-only diff) → skip posting a review
     entirely, report that plainly in chat, not as a failure.
   - Re-run on the same PR (a later push) → the body's opening line notes
     which prior review, if any, this supersedes (GitHub reviews are
     immutable events — this posts a new one, it doesn't edit the old one).

7. **Toggle a visibility label** — same step, right after posting the
   review: `gh label create blocked-critical --color B60205 --description
   "pr-self-review found a critical finding" 2>/dev/null || true` (idempotent,
   repo-wide one-time creation), then `gh pr edit <number> --add-label
   blocked-critical` when the gate is tripped (by a critical finding *or*
   an errored review), `--remove-label blocked-critical` when it clears.
   Shows up in `gh pr list` / the GitHub PR list view without opening the
   PR — doesn't depend on the branch-protection change that's out of scope.

8. Root `AGENTS.md` — add one line under **Session protocol**:
   "Immediately after `gh pr create` succeeds, and again after any `git
   push` to a branch with an open PR, invoke the `pr-self-review` skill
   against that PR — not optional, and its posted GitHub review + label
   are the actual merge gate, not chat text. Treat a resulting `Changes
   requested` state (including an incomplete-review one) as a hard stop on
   `gh pr merge` unless the user explicitly overrides in the same session."
   Note the residual gap explicitly in the same line or a footnote: this
   re-trigger is a session convention Claude follows, not a real git
   hook — a push made outside a Claude Code session won't re-trigger it.

9. `.claude/skills/README.md` — add a `pr-self-review` row to the catalog
   table, `Scope: Meta`, description: "Post-PR gate — matches a newly
   opened/updated PR's diff against every other skill, runs matched skills
   as parallel reviewers, posts inline `Changes requested` + a
   `blocked-critical` label on any `CRITICAL` finding or incomplete run."

10. New `.claude/skills/pr-self-review/examples.md` (per this repo's own
    skill-authoring convention — see README.md's "Creating New Skills"
    section) — one worked example: a PR touching
    `client/src/app/repos/[repoId]/pulls/PRRow.tsx` and
    `server/src/modules/pulls/routes.ts` → matches
    `frontend-ui-architecture` + `react-best-practices` on the first file,
    `onion-architecture` + `fastify-best-practices` on the second; sample
    `CRITICAL` finding (route handler importing Drizzle directly, bypassing
    the repository layer) that trips the gate, followed by the inline
    comment + `gh api ... reviews` call it produces and the
    `blocked-critical` label landing on the PR. Add a second, short example
    of the fail-closed path (one skill's subagent errors, no criticals
    found) producing the same `Changes requested` outcome with the
    "incomplete" wording.

11. **Validate before calling this done** — open a real (throwaway is
    fine) PR on the user's fork with a deliberately introduced
    critical-worthy issue (e.g. a route bypassing the repository layer),
    let the skill run automatically, and confirm with `gh pr view <n>` that
    a `Changes requested` review with inline comments actually landed, the
    `blocked-critical` label is on the PR, and Claude refuses `gh pr merge`
    afterward in-chat. Push a fix into the same PR and confirm the skill
    re-triggers, posts a clean `COMMENT` review, and removes the label.
    Separately: dry-run against a docs-only PR to confirm the zero-match
    path reports cleanly without posting anything, and force one matched
    skill's subagent to fail (e.g. a bad prompt) to confirm the fail-closed
    path blocks even with zero `CRITICAL` findings.

## Open questions / risks

- **Matching consistency.** LLM-based skill matching (step 3) can vary
  run-to-run. `examples.md` (step 10) exists specifically to pin down
  "genuinely relevant" vs. coarse Scope-column matching with a concrete
  worked case — expand it if drift shows up during validation (step 11).
- **Severity calibration.** Reviewer subagents tend to over-call
  `CRITICAL`. `SKILL.md` needs an explicit bar in its instructions: critical
  = would cause a bug, a security hole, or an architecture-rule violation
  the matched skill itself treats as a hard rule — not a style preference.
  This matters more now than in the chat-only version: an over-eager
  `CRITICAL` posts a real `Changes requested` review on GitHub, not just a
  chat message.
- **Branch-protection gap.** Without `main` configured to require
  approvals/status checks, a collaborator with write access can still
  click Merge past a pending `Changes requested` review or a
  `blocked-critical` label — both are real, visible signals but still
  advisory by default on GitHub. Explicitly deferred per the decision
  above; revisit only if the user asks for that infra change separately.
- **Re-trigger is session-scoped, not a real hook.** The push-triggered
  re-check (step 8) only fires when the push happens through a Claude Code
  session that knows this convention — a manual `git push` from a raw
  terminal, or a push from another machine/session, won't re-run the gate.
  Same category of gap as the original "chat-only" limitation, just
  narrower now that the *first* run's block is a real GitHub state.
- **Cost.** N matched skills × one subagent each, on every creation *and*
  every subsequent push, is real token spend per PR. Acceptable for this
  course project; flag if it becomes a concern later.
