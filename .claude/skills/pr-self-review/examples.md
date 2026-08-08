# Examples

## 1. Light mode (default) still catches the critical bug

A PR touches two files:

- `client/src/app/repos/[repoId]/pulls/PRRow.tsx`
- `server/src/modules/pulls/routes.ts`

**Match step** returns (matching always runs in full, regardless of mode):

```json
{
  "matches": [
    { "skill": "frontend-ui-architecture", "files": ["client/src/app/repos/[repoId]/pulls/PRRow.tsx"], "reason": "new component-folder file under client/src/app" },
    { "skill": "react-best-practices", "files": ["client/src/app/repos/[repoId]/pulls/PRRow.tsx"], "reason": "adds local state + an effect" },
    { "skill": "onion-architecture", "files": ["server/src/modules/pulls/routes.ts"], "reason": "route handler in server/src/modules" },
    { "skill": "fastify-best-practices", "files": ["server/src/modules/pulls/routes.ts"], "reason": "Fastify route + schema" }
  ]
}
```

No mode was requested, so this run defaults to `light`. Of the four
matches, `onion-architecture` and `fastify-best-practices` are
critical-tier — they get a review subagent. `frontend-ui-architecture` and
`react-best-practices` are standard-tier — skipped, but still listed in
the report.

`drizzle-orm-patterns` and `security` are **not matched at all** —
nothing in the diff touches a schema/query or an auth/input boundary. This
is the "reason about content, not the scope label" rule in action:
`routes.ts` is technically "Backend" scope like `drizzle-orm-patterns`,
but this diff doesn't touch anything that skill actually covers.

**Review step** — the `onion-architecture` subagent finds:

```json
{
  "findings": [
    {
      "file": "server/src/modules/pulls/routes.ts",
      "line": 42,
      "severity": "CRITICAL",
      "summary": "Route handler queries Drizzle directly, bypassing the repository layer",
      "rationale": "`app.get('/pulls/:id/findings', ...)` calls `container.db.select().from(t.findings)...` inline instead of going through `PullsRepository`. Per onion-architecture, `routes.ts` should only validate + delegate; the only file allowed to import the Drizzle schema for this module is `repository.ts`."
    }
  ]
}
```

`fastify-best-practices` comes back clean.

**Aggregate + decide**: `criticalCount = 1` → `gateTripped = true`.
`skippedMatches = [frontend-ui-architecture, react-best-practices]`.

**Posted to GitHub**:

- An inline comment on `server/src/modules/pulls/routes.ts:42` with the
  finding's summary + rationale (the line is confirmed part of the diff's
  new side, so it anchors cleanly — no 422).
- A review body opening with `## pr-self-review (light mode) — Changes
  requested`, a note that 2 standard-tier skills were skipped under light
  mode (naming them, with a pointer to `/pr-self-review full`), a table
  showing all four matches — the two reviewed skills with their counts,
  the two skipped ones marked `⏭️ skipped (light mode)` — then the full
  finding list.
- `gh pr edit <n> --add-label blocked-critical`.

**In chat**: `🚫 [light mode] Posted "Changes requested" — 1 critical
finding — do not merge until resolved.` Claude also names the two skipped
skills, but the diff doesn't touch an auth/payments/secrets/migration path
and isn't a large PR, so none of the proactive-`full` criteria fire —
Claude doesn't suggest escalating. Claude refuses `gh pr merge` on this PR
for the rest of the session.

## 2. A skipped skill matters — Claude proposes `full`

Same shape of diff, but this time `routes.ts` is under
`server/src/modules/auth/` and the finding from `onion-architecture` is on
a file that `react-best-practices` also matched (the login form component
re-implements token storage inline). Light mode still runs and still trips
the gate on the `onion-architecture` finding, exactly as example 1. But
now two of the proactive-`full` criteria from `SKILL.md`'s Modes section
are true at once: the diff touches an auth path, and the skipped
`react-best-practices` match shares a file with an already-`CRITICAL`
finding.

**In chat**, after the same posted review + label as example 1: `🚫
[light mode] ... 1 critical finding. Also skipped react-best-practices —
this touches an auth path and overlaps a file with the critical finding
above, want a full run too?` Claude does **not** run `full` on its own;
it waits for the user to say yes before invoking the skill again with
`mode: full`.

## 3. Full mode, requested explicitly

The user says "/pr-self-review full" on the same PR from example 1. Step 1
sets `MODE=full`. All four matches from the Match step get a review
subagent this time, including `frontend-ui-architecture` and
`react-best-practices`. Say `react-best-practices` also comes back with a
`WARNING` (missing `useCallback` on a handler passed to a memoized child).

**Aggregate + decide**: `criticalCount = 1` (same `onion-architecture`
finding as before), `skippedMatches = []`.

**Posted to GitHub**: review body opens with `## pr-self-review (full
mode) — Changes requested`, no "skipped under light mode" note, table
shows all four skills with real counts (`react-best-practices` shows
`0 🔴 · 1 🟡 · 0 🔵`). Same inline comment + label as example 1, plus the
`WARNING` appears in the finding list (FYI only, doesn't affect
`gateTripped`).

**In chat**: `🚫 [full mode] Posted "Changes requested" — 1 critical
finding — do not merge until resolved.` The `WARNING` is listed as FYI.

## 4. Fail-closed: an incomplete review blocks too

Same PR as example 1, still `light` mode, but this time the
`fastify-best-practices` review subagent errors out mid-run (e.g. a
transient API failure) and `agent()` resolves that slot to `null`.
`onion-architecture` (the other critical-tier match) comes back clean —
**zero** `CRITICAL` findings anywhere among the skills that did run.

Aggregate step: `criticalCount = 0`, but `errored =
['fastify-best-practices']` → `gateTripped = true` anyway (fail-closed: an
incomplete run is never treated as "clean" — this applies the same way
regardless of mode, since `errored` is only ever computed from
`reviewMatches`, the skills that were actually attempted).

**Posted to GitHub**:

- Review body opens with `## pr-self-review (light mode) — ⚠️ Review
  incomplete (1/2 skill review(s) failed)`, followed by `Treat this PR as
  **NOT verified** — fastify-best-practices did not complete. Do not
  merge until re-run.` The two standard-tier skills still show as
  `⏭️ skipped (light mode)`, unrelated to the error.
- `event: COMMENT`, same `blocked-critical` label — visually identical
  merge-block to example 1, distinguishable only by the wording.

**In chat**: `⚠️ Review incomplete — do not merge, treat as unverified.`
Same refusal to run `gh pr merge`. Re-running the skill (e.g. after the
transient failure clears) posts a fresh review; if it comes back fully
clean this time, the label is removed and a `COMMENT` review supersedes
this one — its opening line should say so explicitly, since GitHub reviews
are immutable and the incomplete one stays visible in the PR's history.
