---
name: pr-self-review
description: "Post-PR gate for this repo's own development: right after `gh pr create` succeeds (and again after any later `git push` to that PR's branch), matches the PR's changed files against every other skill in the catalog, runs each matched skill as an independent parallel reviewer, and posts the result as a real GitHub PR review — `REQUEST_CHANGES` + a `blocked-critical` label on any CRITICAL finding or incomplete run, `COMMENT` otherwise. Use automatically after opening or updating a PR in this repo; also invoke manually on '/pr-self-review', 'review this PR', 'self review', 'check this PR for critical issues'."
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

## Workflow

### 1. Scope the PR (Bash, no agent)

The PR is the source of truth, not local working-tree state:

```bash
PR_NUMBER=$(gh pr view --json number -q .number)
OWNER_REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
FILES=$(gh pr view "$PR_NUMBER" --json files -q '.files[].path' \
  | grep -Ev '(^|/)(pnpm-lock\.yaml|package-lock\.json|.*\.snap|dist/|\.next/)')
DIFF=$(gh pr diff "$PR_NUMBER")
```

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
`args: { catalog: CATALOG, files: FILES.split('\n'), diff: DIFF }`. This is
the one genuine multi-agent orchestration step (one agent to match, one
parallel subagent per matched skill to review) — everything before and
after it is plain `Bash`/`gh` run directly by you, the calling agent.

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
  return { matched: false, gateTripped: false, event: null, body: null, comments: [] }
}

phase('Review')
const outcomes = await parallel(
  matches.map((m) => () =>
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
  if (r == null) errored.push(matches[i].skill)
  else completed.push({ skill: matches[i].skill, files: matches[i].files, findings: r.findings })
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

const SEV_EMOJI = { CRITICAL: '🔴', WARNING: '🟡', SUGGESTION: '🔵' }
const SEV_RANK = { CRITICAL: 3, WARNING: 2, SUGGESTION: 1 }
const findingLines = findings
  .slice()
  .sort((a, b) => (SEV_RANK[b.severity] ?? 0) - (SEV_RANK[a.severity] ?? 0))
  .map(
    (f) =>
      `- ${SEV_EMOJI[f.severity] ?? '•'} **${f.summary}** (\`${f.skill}\`, ${f.severity.toLowerCase()}) — \`${f.file}:${f.line}\`\n  - ${f.rationale}`,
  )

const header =
  errored.length > 0
    ? `## pr-self-review — ⚠️ Review incomplete (${errored.length}/${matches.length} skill review(s) failed)`
    : gateTripped
      ? '## pr-self-review — Changes requested'
      : '## pr-self-review — No critical findings'

const bodyParts = [header, '']
if (errored.length > 0) {
  bodyParts.push(
    `Treat this PR as **NOT verified** — ${errored.join(', ')} did not complete. Do not merge until re-run.`,
    '',
  )
}
bodyParts.push('| Skill | Files | Findings |', '|---|---|---|', ...rows, '')
bodyParts.push(findings.length ? findingLines.join('\n') : '_No findings from any matched skill._')
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

return { matched: true, gateTripped, criticalCount, errored, event: gateTripped ? 'REQUEST_CHANGES' : 'COMMENT', body, comments }
```

### 4. Post the result (Bash, no agent)

Take the Workflow result (`matched`, `event`, `body`, `comments`, `gateTripped`)
and act on it directly:

- **`matched: false`** → report in chat that nothing matched, post nothing to
  GitHub.
- **Otherwise** → write `{ body, event, comments }` to a temp JSON file
  (`/tmp` or the scratchpad) and post it as one review:

  ```bash
  gh api "repos/$OWNER_REPO/pulls/$PR_NUMBER/reviews" \
    --method POST --input /path/to/review-payload.json
  ```

  Then toggle the visibility label (idempotent — safe to run every time):

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

- `event: REQUEST_CHANGES`, tripped by a `CRITICAL` →
  `🚫 Posted "Changes requested" — N critical finding(s) — do not merge
  until resolved.` Refuse to run `gh pr merge` on this PR for the rest of
  the session unless the user explicitly overrides.
- `event: REQUEST_CHANGES`, tripped by an errored review (no criticals
  found, but a skill didn't finish) →
  `⚠️ Review incomplete — do not merge, treat as unverified.` Same refusal
  to run `gh pr merge`.
- `event: COMMENT` → `✅ No critical findings — posted as a comment,
  mergeable.` Still list warnings/suggestions as FYI; never block on those.
- `matched: false` → say so plainly; this is not a failure.

## Fail-closed policy

An incomplete run is not evidence of "clean." If any matched skill's review
subagent errors out, the gate trips exactly like a `CRITICAL` finding would
— `REQUEST_CHANGES`, `blocked-critical` label, refuse `gh pr merge` — just
with "review incomplete" wording instead of a finding list. Never post
`COMMENT`/clean on a run that didn't finish.

## Anti-patterns

- **Approving your own PR.** Never post `event: APPROVE` — GitHub rejects
  self-approval, and the PR author here is the same account `gh` is
  authenticated as (see [[feedback_fork_workflow]]). The clean path posts
  `COMMENT`, not `APPROVE`.
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
