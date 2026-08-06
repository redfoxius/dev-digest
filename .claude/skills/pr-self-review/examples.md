# Examples

## 1. Critical finding trips the gate

A PR touches two files:

- `client/src/app/repos/[repoId]/pulls/PRRow.tsx`
- `server/src/modules/pulls/routes.ts`

**Match step** returns:

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

`drizzle-orm-patterns` and `security` are **not** matched — nothing in the
diff touches a schema/query or an auth/input boundary. This is the
"reason about content, not the scope label" rule in action: `routes.ts` is
technically "Backend" scope like `drizzle-orm-patterns`, but this diff
doesn't touch anything that skill actually covers.

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

**Aggregate + decide**: `criticalCount = 1` → `gateTripped = true` →
`event: REQUEST_CHANGES`.

**Posted to GitHub**:

- An inline comment on `server/src/modules/pulls/routes.ts:42` with the
  finding's summary + rationale (the line is confirmed part of the diff's
  new side, so it anchors cleanly — no 422).
- A review body opening with `## pr-self-review — Changes requested`, a
  table showing all four matched skills and their per-skill counts (the
  three clean skills show `0 🔴 · 0 🟡 · 0 🔵`), then the full finding list.
- `gh pr edit <n> --add-label blocked-critical`.

**In chat**: `🚫 Posted "Changes requested" — 1 critical finding — do not
merge until resolved.` Claude refuses `gh pr merge` on this PR for the rest
of the session.

## 2. Fail-closed: an incomplete review blocks too

Same PR, but this time the `fastify-best-practices` review subagent errors
out mid-run (e.g. a transient API failure) and `agent()` resolves that slot
to `null`. The other three skills all come back clean — **zero** `CRITICAL`
findings anywhere.

Aggregate step: `criticalCount = 0`, but `errored = ['fastify-best-practices']`
→ `gateTripped = true` anyway (fail-closed: an incomplete run is never
treated as "clean").

**Posted to GitHub**:

- Review body opens with
  `## pr-self-review — ⚠️ Review incomplete (1/4 skill review(s) failed)`,
  followed by `Treat this PR as **NOT verified** — fastify-best-practices
  did not complete. Do not merge until re-run.`
- The catalog table marks that row `⚠️ review incomplete` instead of a
  severity count.
- `event: REQUEST_CHANGES`, same `blocked-critical` label — visually
  identical merge-block to example 1, distinguishable only by the wording.

**In chat**: `⚠️ Review incomplete — do not merge, treat as unverified.`
Same refusal to run `gh pr merge`. Re-running the skill (e.g. after the
transient failure clears) posts a fresh review; if it comes back fully
clean this time, the label is removed and a `COMMENT` review supersedes
this one — its opening line should say so explicitly, since GitHub reviews
are immutable and the incomplete one stays visible in the PR's history.
