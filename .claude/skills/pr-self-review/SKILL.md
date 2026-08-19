---
name: pr-self-review
description: "Post-PR gate for this repo's own development: right after `gh pr create` succeeds (and again after any later `git push` to that PR's branch), matches the PR's changed files against every other skill in the catalog, runs each matched skill as an independent parallel reviewer, and posts the result as a real GitHub PR review (always `COMMENT` — GitHub blocks self-REQUEST_CHANGES too) plus a `blocked-critical` label on any CRITICAL finding or incomplete run. Two modes: light (default — critical-tier skills only: security, onion-architecture, golang-architecture, drizzle-orm-patterns, postgresql-table-design, fastify-best-practices, zod) and full (every matched skill), full runs only on request ('/pr-self-review full', 'full review', 'повний огляд') or when Claude proactively proposes it for a security-sensitive or large diff. Use automatically after opening or updating a PR in this repo; also invoke manually on '/pr-self-review', 'review this PR', 'self review', 'check this PR for critical issues'."
version: "1.1.0"
allowed-tools: Bash, Read, Grep, Glob, Workflow
---

# PR Self Review

Gates *merging*, never *creating*. The moment a PR exists (fresh from `gh pr
create`, or updated by a later `git push`), this skill decides which of this
repo's other skills actually apply to what changed, runs each of them as an
independent reviewer, and posts the outcome straight onto the PR as a GitHub
review — visible in `gh pr list` and the PR page, not just this chat.

Full design rationale, the decisions behind each choice below, and the
residual gaps that were consciously accepted live in
[docs/pr-self-review-skill-plan.md](../../../docs/pr-self-review-skill-plan.md)
— read it if something here seems arbitrary.

## When to use

- **Automatically**, immediately after `gh pr create` succeeds in this
  session, against the PR that was just opened.
- **Automatically again** after any `git push` you make to a branch that
  already has an open PR — the gate has to reflect the current head, not
  the first commit.
- **Manually**, on `/pr-self-review`, "review this PR", "self review", or
  "check this PR for critical issues" — same steps, just triggered by the
  user instead of by the create/push convention.

This skill never blocks step 1 (`gh pr create` itself always runs). It only
ever blocks step 2 (`gh pr merge`), and only via what it posts to GitHub.

## Modes

Two modes control how many of the matched skills actually run a review
subagent (step 3). Matching (which skills are relevant at all) always runs
in full — modes only decide which matches get **reviewed**.

- **`light` (default).** Only matched skills in the fixed critical-tier
  list below get a review subagent. Every other match is still shown in
  the report table as skipped, never silently dropped. This is the mode
  for every automatic trigger (post-`gh pr create`, post-`git push`) and
  for a bare manual invocation — it exists specifically to control the
  cost problem flagged in
  [docs/pr-self-review-skill-plan.md](../../../docs/pr-self-review-skill-plan.md)'s
  open questions (N matched skills × one subagent, on every push, was
  already noted as unbounded before this mode existed).
- **`full`.** Every matched skill gets a review subagent, same as this
  skill's original (pre-mode) behavior. Triggered only by explicit
  request — "/pr-self-review full", "full review", "review all skills",
  "повний огляд" — never by the automatic create/push hooks on their own.

**Critical tier** (reviewed in both modes) — a fixed list, not
per-PR-recomputed, because tiering is a property of what a skill *catches*
(security holes, data loss, layering/correctness violations that produce
real bugs), not of the specific diff:

```
security, onion-architecture, golang-architecture, drizzle-orm-patterns,
postgresql-table-design, fastify-best-practices, zod
```

Everything else in the catalog (`frontend-ui-architecture`,
`react-best-practices`, `next-best-practices`, `react-testing-library`,
`typescript-expert`, `dataviz`, `add-language-support`, and any future
skill not explicitly added above) is **standard tier** — reviewed only in
`full` mode. A newly added catalog skill defaults to standard tier; add it
to the list above explicitly if it belongs in light mode too. Keeping the
default on the "skip in light mode" side is deliberate — light mode's
whole point is staying cheap, and a missed standard-tier skill is still
one `full` run away, never permanently lost.

**Proposing `full` proactively.** Even under the default `light` trigger,
if step 3's Match result leaves standard-tier skills skipped *and* any of
the following hold, say so in the chat report (step 5) as a suggestion —
never run `full` without the user asking:

- the diff touches an auth/session, payments, secrets, or migration path;
- a skipped skill's matched files overlap with a file that already has a
  `CRITICAL` finding from a critical-tier skill (same file, compounding
  risk);
- the PR is large by this repo's own standard (double-digit file count).

## Workflow

### 1. Scope the PR (Bash, no agent)

The PR is the source of truth, not local working-tree state:

```bash
PR_NUMBER=$(gh pr view --json number -q .number)
OWNER_REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
FILES=$(gh pr view "$PR_NUMBER" --json files -q '.files[].path' \
  | grep -Ev '(^|/)(pnpm-lock\.yaml|package-lock\.json|.*\.snap|dist/|\.next/)')

# Measure before fetching for real: `gh pr diff | wc -c` pipes the diff through the shell
# internally and only returns you a byte count — the diff text itself never enters your
# context here, unlike reading the file or piping it into a tool call would.
DIFF_BYTES=$(gh pr diff "$PR_NUMBER" | wc -c)
LARGE_DIFF=false
if [ "$DIFF_BYTES" -gt 50000 ]; then LARGE_DIFF=true; fi

if [ "$LARGE_DIFF" = "true" ]; then
  DIFF=''  # deferred — see step 3's "Large diffs" note before fetching it for real
else
  DIFF=$(gh pr diff "$PR_NUMBER")
fi
```

**Large-diff deferral.** Above ~50KB (this repo's own dry-run precedent: a
21-file, 175KB PR diff — see `docs/spec-creator-agent-plan.md`'s Round 3 —
cost ~68K tokens to read in full, for a PR where nothing ultimately
matched), don't fetch the diff text for real yet. `LARGE_DIFF=true` carries
into step 3, which runs Match on `diff: ''` first and only pays the real
fetch if something actually matches.

**Mode:** `MODE=light` unless the invocation explicitly asked for `full`
("/pr-self-review full", "full review", "review all skills", "повний
огляд") — every automatic trigger (post-`gh pr create`, post-`git push`)
and every bare manual invocation defaults to `light`. See
[Modes](#modes) above for the critical-tier list and when to *propose*
`full` without running it unasked.

**Self-edit guard:** if every line in `$FILES` is under
`.claude/skills/pr-self-review/`, stop here and report "self-edit, nothing
to review" — never run this skill against its own diff.

**Zero files after filtering** (e.g. the PR only touched a lockfile) → stop
here too, report "nothing reviewable in this diff," post nothing.

### 2. Build the skill catalog (Bash, no agent)

```bash
CATALOG=$(
  # `cat`-ing README.md's catalog table verbatim still lists engineering-insights/
  # mermaid-diagram/pr-self-review as rows — strip those three before the matcher
  # ever sees them, don't rely on omitting their description blocks alone (that
  # alone still leaves them selectable from the table; caught during this skill's
  # first live run — see docs/pr-self-review-skill-plan.md).
  grep -Ev '^\| \[(engineering-insights|mermaid-diagram|pr-self-review)\]' .claude/skills/README.md
  echo
  for f in .claude/skills/*/SKILL.md; do
    name=$(basename "$(dirname "$f")")
    case "$name" in
      engineering-insights|mermaid-diagram|pr-self-review) continue ;;
    esac
    echo "== $name =="
    sed -n '/^description:/p' "$f"
  done
)
```

`engineering-insights` and `mermaid-diagram` are process/meta skills, not
code reviewers — excluded from the candidate pool along with this skill
itself, from both the table rows and the description blocks. Repeat the
exclusion by name in the Match agent's prompt (step 3) too, as a second
guard — a stripped row is still one bad `grep` away from silently
reappearing.

### 3. Match + review, via `Workflow`

Call the `Workflow` tool with the script below, passing
`args: { catalog: CATALOG, files: FILES.split('\n'), diff: DIFF, mode: MODE }`
(`MODE` from step 1, `'light'` or `'full'`; `DIFF` is `''` when step 1 set
`LARGE_DIFF=true`). This is the one genuine multi-agent orchestration step
(one agent to match, one parallel subagent per matched skill to review) —
everything before and after it is plain `Bash`/`gh` run directly by you,
the calling agent. Note that the Match phase below never reads `diff` at
all — only Review does — which is exactly what step 3's large-diff
deferral relies on.

```js
export const meta = {
  name: 'pr-self-review-gate',
  description: "Match a PR diff against this repo's skill catalog, run each matched skill as an independent parallel reviewer, and return a deterministic GitHub review decision.",
  phases: [
    { title: 'Match', detail: 'one agent maps changed files to genuinely relevant catalog skills' },
    { title: 'Review', detail: 'one subagent per matched skill, parallel, each scoped to its own files' },
  ],
}

// `args` has been observed coming through as a raw JSON string rather than a parsed object in this
// harness (confirmed by a smoke test during this skill's first live run) — parse defensively.
const parsedArgs = typeof args === 'string' ? JSON.parse(args) : args
const catalog = parsedArgs.catalog
const files = parsedArgs.files
const diff = parsedArgs.diff
const mode = parsedArgs.mode === 'full' ? 'full' : 'light'

// Fixed critical tier — see SKILL.md's "Modes" section for the rationale (a property of what a
// skill catches, not of the specific diff). Reviewed in both modes; everything else in the
// catalog is standard tier and only reviewed under `full`.
const CRITICAL_SKILLS = new Set([
  'security',
  'onion-architecture',
  'golang-architecture',
  'drizzle-orm-patterns',
  'postgresql-table-design',
  'fastify-best-practices',
  'zod',
])

const MATCH_SCHEMA = {
  type: 'object',
  properties: {
    matches: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          skill: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          reason: { type: 'string' },
        },
        required: ['skill', 'files', 'reason'],
      },
    },
  },
  required: ['matches'],
}

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'number' },
          severity: { type: 'string', enum: ['CRITICAL', 'WARNING', 'SUGGESTION'] },
          summary: { type: 'string' },
          rationale: { type: 'string' },
        },
        required: ['file', 'line', 'severity', 'summary', 'rationale'],
      },
    },
  },
  required: ['findings'],
}

phase('Match')
const matchResult = await agent(
  [
    "You are matching a PR's changed files against a catalog of Claude Code skills.",
    '',
    'Catalog:',
    catalog,
    '',
    'Changed files in this PR:',
    files.join('\n'),
    '',
    'Return only skills genuinely relevant to what these files actually contain — reason about content,',
    "not just directory or the catalog's coarse scope label. Do not blanket-match every \"Full-stack\"-scoped",
    'skill to every file just because it could theoretically apply. Group files under each matched skill.',
    'Never match engineering-insights, mermaid-diagram, or pr-self-review — they are process/meta skills,',
    'not code reviewers, excluded from this pool regardless of what the catalog text above still shows.',
  ].join('\n'),
  { schema: MATCH_SCHEMA },
)
const matches = matchResult?.matches ?? []

if (matches.length === 0) {
  return { matched: false, gateTripped: false, event: null, body: null, comments: [], mode }
}

const reviewMatches = mode === 'full' ? matches : matches.filter((m) => CRITICAL_SKILLS.has(m.skill))
const skippedMatches = mode === 'full' ? [] : matches.filter((m) => !CRITICAL_SKILLS.has(m.skill))

phase('Review')
const outcomes = await parallel(
  reviewMatches.map((m) => () =>
    agent(
      [
        `Load the "${m.skill}" skill via the Skill tool. Apply ONLY that skill's rules to review this PR`,
        `diff, restricting your findings to these files: ${m.files.join(', ')} (ignore every other file in`,
        'the diff, even though you can see them).',
        '',
        'Diff:',
        diff,
        '',
        "Severity bar: CRITICAL means this skill's own rules call it a hard violation, a real bug, or a",
        'security hole — not a style preference. Return an empty findings array if nothing clears that bar.',
      ].join('\n'),
      { schema: FINDINGS_SCHEMA, phase: 'Review', label: `review:${m.skill}` },
    ),
  ),
)

const errored = []
const completed = []
outcomes.forEach((r, i) => {
  if (r == null) errored.push(reviewMatches[i].skill)
  else completed.push({ skill: reviewMatches[i].skill, files: reviewMatches[i].files, findings: r.findings })
})

const seen = new Set()
const findings = []
for (const c of completed) {
  for (const f of c.findings) {
    const key = `${f.file}:${f.line}:${c.skill}`
    if (seen.has(key)) continue
    seen.add(key)
    findings.push({ ...f, skill: c.skill })
  }
}

const criticalCount = findings.filter((f) => f.severity === 'CRITICAL').length
// Fail closed: an incomplete run is never evidence of "clean," it trips the gate same as a CRITICAL.
const gateTripped = criticalCount > 0 || errored.length > 0

function countFor(list, sev) {
  return list.filter((f) => f.severity === sev).length
}

const rows = completed
  .map((c) => {
    const own = findings.filter((f) => f.skill === c.skill)
    return `| ${c.skill} | ${c.files.join(', ')} | ${countFor(own, 'CRITICAL')} 🔴 · ${countFor(own, 'WARNING')} 🟡 · ${countFor(own, 'SUGGESTION')} 🔵 |`
  })
  .concat(
    errored.map((skill) => {
      const m = matches.find((mm) => mm.skill === skill)
      return `| ${skill} | ${m ? m.files.join(', ') : ''} | ⚠️ review incomplete |`
    }),
  )
  .concat(
    skippedMatches.map((m) => `| ${m.skill} | ${m.files.join(', ')} | ⏭️ skipped (light mode) |`),
  )

const SEV_EMOJI = { CRITICAL: '🔴', WARNING: '🟡', SUGGESTION: '🔵' }
const SEV_RANK = { CRITICAL: 3, WARNING: 2, SUGGESTION: 1 }
const findingLines = findings
  .slice()
  .sort((a, b) => (SEV_RANK[b.severity] ?? 0) - (SEV_RANK[a.severity] ?? 0))
  .map(
    (f) =>
      `- ${SEV_EMOJI[f.severity] ?? '•'} **${f.summary}** (\`${f.skill}\`, ${f.severity.toLowerCase()}) — \`${f.file}:${f.line}\`\n  - ${f.rationale}`,
  )

const modeTag = mode === 'full' ? 'full mode' : 'light mode'
const header =
  errored.length > 0
    ? `## pr-self-review (${modeTag}) — ⚠️ Review incomplete (${errored.length}/${reviewMatches.length} skill review(s) failed)`
    : gateTripped
      ? `## pr-self-review (${modeTag}) — Changes requested`
      : `## pr-self-review (${modeTag}) — No critical findings`

const bodyParts = [header, '']
if (errored.length > 0) {
  bodyParts.push(
    `Treat this PR as **NOT verified** — ${errored.join(', ')} did not complete. Do not merge until re-run.`,
    '',
  )
}
if (skippedMatches.length > 0) {
  bodyParts.push(
    `⏭️ ${skippedMatches.length} standard-tier skill(s) skipped under light mode: ${skippedMatches.map((m) => m.skill).join(', ')} — run \`/pr-self-review full\` to include them.`,
    '',
  )
}
bodyParts.push('| Skill | Files | Findings |', '|---|---|---|', ...rows, '')
bodyParts.push(findings.length ? findingLines.join('\n') : '_No findings from any reviewed skill._')
const body = bodyParts.join('\n')

// Only anchor an inline comment to a line that's actually part of the new-side diff — GitHub returns
// 422 "Line could not be resolved" for anything else, and rejects the WHOLE review for one bad line.
// (Same landmine this repo's own reviewer-core/src/output/to-review.ts already had to solve.) Every
// finding still appears in `body` above regardless — only the inline placement is best-effort.
function newSideLines(diffText) {
  const idx = new Map()
  let file = null
  let newLine = null
  for (const raw of diffText.split('\n')) {
    if (raw.startsWith('+++ b/')) {
      file = raw.slice('+++ b/'.length)
      if (!idx.has(file)) idx.set(file, new Set())
      continue
    }
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (hunk) {
      newLine = Number(hunk[1])
      continue
    }
    if (file == null || newLine == null) continue
    if (raw.startsWith('+') || raw.startsWith(' ')) {
      idx.get(file).add(newLine)
      newLine++
    }
    // '-' lines are old-side only; the new-line counter doesn't advance for them.
  }
  return idx
}

const lineIndex = newSideLines(diff)
const comments = findings
  .filter((f) => lineIndex.get(f.file)?.has(f.line))
  .map((f) => ({
    path: f.file,
    line: f.line,
    body: `**${f.summary}** (\`${f.skill}\`, ${f.severity.toLowerCase()})\n\n${f.rationale}`,
  }))

return {
  matched: true,
  gateTripped,
  criticalCount,
  errored,
  event: 'COMMENT',
  body,
  comments,
  mode,
  skippedMatches: skippedMatches.map((m) => ({ skill: m.skill, files: m.files })),
}
```

**Why `event` is always `'COMMENT'`, never `REQUEST_CHANGES`**: confirmed on
this skill's first real (non-docs-only) run — GitHub's API rejects
`REQUEST_CHANGES` on your own PR with a 422 (*"Review Can not request
changes on your own pull request"*), the exact same rejection as
self-`APPROVE`. Since the PR author here is always the account `gh` is
authenticated as (fork-only workflow, [[feedback_fork_workflow]]),
`REQUEST_CHANGES` can **never** actually post here — don't build the gate
around it. `gateTripped` still drives the label and the chat-side refusal
below; the review body's own header text still says "Changes requested" as
a plain-English status, it's just carried by a `COMMENT`-type review, not
GitHub's `REQUEST_CHANGES` review state.

### 3b. Large diffs: defer, then resume (only when `LARGE_DIFF=true`)

If step 1 set `LARGE_DIFF=true`, the call above ran with `diff: ''` —
Match still saw the real `catalog`/`files`, so its verdict is
trustworthy, but Review (if dispatched) would have reviewed against an
empty diff, which is wrong. Branch on the result:

- **`matched: false`** — nothing to review. Skip straight to step 4 with
  this result as-is; the real diff was never needed, and the ~50KB+ it
  would have cost to inline was avoided entirely. This is the common case
  for a docs/prompt/config-only PR (confirmed on this repo's own
  `spec-creator` PR: 21 files, 175KB diff, zero matches, deferred diff
  never fetched).
- **`matched: true`** — something needs a real review. *Now* fetch the
  diff for real (`DIFF=$(gh pr diff "$PR_NUMBER")`) and re-invoke the
  same `Workflow` script via `resumeFromRunId` (the run id from the first
  call), passing the **same** `catalog`/`files`/`mode` plus the now-real
  `diff`:

  ```
  Workflow({ scriptPath: <the persisted script path from the first call>,
             resumeFromRunId: <run id from the first call>,
             args: { catalog: CATALOG, files: FILES.split('\n'), diff: DIFF, mode: MODE } })
  ```

  The Match `agent()` call's `(prompt, opts)` is unchanged (`diff` never
  entered its prompt), so it replays from cache instantly at zero extra
  cost — only the Review `agent()` calls run fresh, now against the real
  diff. Use **this** result for step 4, not the first call's.

Skip this step entirely when `LARGE_DIFF` was never set to `true` — the
single call in step 3 already carried a real diff and its result is
final.

### 4. Post the result (Bash, no agent)

Take the Workflow result (`matched`, `body`, `comments`, `gateTripped`,
`mode`, `skippedMatches` — `event` is always `'COMMENT'`, see above) and
act on it directly:

- **`matched: false`** → report in chat that nothing matched, post nothing to
  GitHub.
- **Otherwise** → write `{ body, event: 'COMMENT', comments }` to a temp
  JSON file (`/tmp` or the scratchpad) and post it as one review:

  ```bash
  gh api "repos/$OWNER_REPO/pulls/$PR_NUMBER/reviews" \
    --method POST --input /path/to/review-payload.json
  ```

  The **label is the actual enforcement signal on GitHub itself** now that
  the review event can't be `REQUEST_CHANGES` — toggle it every time
  (idempotent):

  ```bash
  gh label create blocked-critical --color B60205 \
    --description "pr-self-review found a critical finding or an incomplete run" 2>/dev/null || true

  if [ "$GATE_TRIPPED" = "true" ]; then
    gh pr edit "$PR_NUMBER" --add-label blocked-critical
  else
    gh pr edit "$PR_NUMBER" --remove-label blocked-critical
  fi
  ```

  If this PR already carries an earlier `pr-self-review` review (a prior
  push triggered a run), the first line of the new report should say so —
  GitHub reviews are immutable events, this posts a **new** one, it never
  edits the old one, so silence about that reads as contradictory history.

### 5. Tell the user, and hold the merge gate yourself

State the mode used (`light` or `full`) in every chat report, not just in
the posted review — the user should never have to open GitHub to find out
which one ran.

- `gateTripped: true`, caused by a `CRITICAL` →
  `🚫 [light|full mode] Posted findings (as a comment — GitHub blocks
  self-Request-changes too) + added blocked-critical — N critical
  finding(s) — do not merge until resolved.` Refuse to run `gh pr merge`
  on this PR for the rest of the session unless the user explicitly
  overrides.
- `gateTripped: true`, caused by an errored review (no criticals found,
  but a skill didn't finish) →
  `⚠️ Review incomplete — do not merge, treat as unverified.` Same
  refusal to run `gh pr merge`.
- `gateTripped: false` → `✅ [light|full mode] No critical findings —
  posted as a comment, label cleared, mergeable.` Still list
  warnings/suggestions as FYI; never block on those.
- `matched: false` → say so plainly; this is not a failure.

**If `mode: 'light'` and `skippedMatches` is non-empty**, always name the
skipped skills, and additionally propose `full` (per [Modes](#modes)'s
criteria — sensitive path, compounding risk on an already-flagged file, or
a large diff) when those criteria are met: `N standard-tier skill(s)
skipped (list) — this diff touches <reason>, want a full run too?` Never
run `full` on that suggestion alone; wait for the user to say yes.

## Fail-closed policy

An incomplete run is not evidence of "clean." If any matched skill's review
subagent errors out, the gate trips exactly like a `CRITICAL` finding would
— posted comment + `blocked-critical` label + refuse `gh pr merge` — just
with "review incomplete" wording instead of a finding list. Never post a
clean comment / clear the label on a run that didn't finish.

## Anti-patterns

- **Trying to `APPROVE` or `REQUEST_CHANGES` your own PR.** GitHub rejects
  **both** — not just self-`APPROVE` — with a 422 when the reviewer and PR
  author are the same account, which they always are here (fork-only
  workflow, [[feedback_fork_workflow]]). `event` is always `'COMMENT'`;
  the `blocked-critical` label plus this session's own refusal to run
  `gh pr merge` are the real enforcement, not the review's GitHub-side
  state. (Discovered on this skill's first non-docs-only run, which
  originally tried `REQUEST_CHANGES` and got the same 422 self-approval
  blocks — see `docs/pr-self-review-skill-plan.md`.)
- **Blanket-matching by scope label.** A skill's `Scope: Full-stack` in
  `README.md`'s catalog table is a hint, not a rule — the Match step must
  reason about actual file content (e.g. `zod` only if a file has a
  `z.object`/`z.string()` schema), not select every full-stack skill for
  every file.
- **Reviewing lockfiles or generated output.** Filtered out in step 1
  before anything downstream sees the file list.
- **Reviewing itself.** Skipped in step 1's self-edit guard — a diff that
  only touches this skill's own directory never gets matched against
  anything, including itself.
- **Silently dropping an inline comment.** If a finding's line isn't part
  of the diff's new side, it drops from `comments` (would 422) but stays
  in `body` — never disappears from the report entirely.
- **Running `full` by default, "just to be safe."** Defeats the point —
  `light` exists specifically to bound the N-matched-skills × one-subagent
  cost on every automatic create/push trigger (see
  [Modes](#modes)). Escalate to `full` only on explicit request or an
  explicit, stated proposal the user agreed to.
- **Skipping a standard-tier skill without saying so.** `skippedMatches`
  always renders as its own row (`⏭️ skipped (light mode)`) in the posted
  table and gets named in the chat report — never quietly absent, even
  though its review subagent never ran.
- **Eagerly inlining a large diff before Match has had a chance to return
  zero matches.** `Workflow`'s script has no filesystem access, so any
  `diff` value has to pass through the calling agent's own context to
  reach `args` — for a large, docs/prompt-only PR that cost is pure waste
  when nothing was ever going to match. Step 1's `LARGE_DIFF` check +
  step 3b's deferred-fetch-and-resume exist specifically to avoid this
  (see `docs/retros/ledger.md`'s `pr-self-review-pr20-match` row for the
  real cost this pattern was retired to prevent).

## References

- [docs/pr-self-review-skill-plan.md](../../../docs/pr-self-review-skill-plan.md)
  — full design rationale and the decisions behind each choice above.
- `reviewer-core/src/output/to-review.ts` — the deterministic
  severity→event gate (`gateTriggered`, `SEV_RANK`, `FAIL_ON_MIN_RANK`) and
  the body/inline-comment composition this skill's `Workflow` script
  mirrors; also the source of the "one bad line 422s the whole review"
  gotcha this script guards against.
- `server/src/vendor/shared/contracts/findings.ts:11` — the `Severity`
  enum (`CRITICAL`/`WARNING`/`SUGGESTION`) this skill reuses verbatim.
- `server/src/adapters/github/octokit.ts` (`postReview`,
  `createReviewComment`) — the API shape `gh api .../reviews` mirrors.
- `.claude/skills/README.md` — the catalog this skill matches against.
- `docs/retros/ledger.md` (`pr-self-review-pr20-match` row) — the
  `/workflow-retro` run that measured the real cost of eagerly inlining a
  large diff (~$0.07 wasted on a placeholder-args false start, plus the
  avoided ~68K-token cost of reading a 175KB diff for a PR that matched
  nothing) and motivated step 1/3b's large-diff deferral.
