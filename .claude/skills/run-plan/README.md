# Run Plan Skill

Implementation Plan executor for the DevDigest project. One command takes an **already-approved**
plan and drives it to reviewed code — dispatching the implementer/reviewer agents, keeping its own
context lean (only short agent reports), and resolving review comments in a bounded fix loop.

Spec authoring (`spec-creator`) and planning (`implementation-planner`) are run **separately and
manually** beforehand. This command starts from the plan.

## What it does

Runs in the main session as the **orchestrator**. It never implements or reviews itself — it spawns
the agents, runs independent ones concurrently, and resolves architecture-review + traceability
comments through a bounded fix loop. It never pushes or merges.

```
args: plan:<path>  [mode:multi|single]  [max-fix:N]
  └─ read plan (tasks · DAG · owned paths · execution mode)
       └─ AC-N preflight   (mechanical grep/diff, spec ↔ plan — no agent, stops here on a gap)
            └─ implementer ×N   (multi-agent by DAG / non-overlapping owned paths, or single-agent)
                 └─ test-writer ×(touched packages)   (once, against the full changed set — not per task)
                      └─ architecture-reviewer ‖ plan-verifier   (parallel, read-only, Sonnet)
                           └─ fix loop ×≤max-fix   (implementer fixes crit/high + missing/partial → re-review changed files)
                                └─ final canary   (plain Bash, full suite per package, quiet reporter — no agent)
                                     └─ final report  +  "run pr-self-review before push"
```

## When to invoke

- `/run-plan plan:docs/plans/<feature>.md` (optionally `mode:single`, `max-fix:2`)
- Phrases: "run the plan", "execute the plan", "implement docs/plans/<x>.md".

## Inputs

| Token | Meaning | Default |
|-------|---------|---------|
| `plan:<path>` | Approved Implementation Plan. **Required.** | — |
| free-text prose | Notes/constraints for this run | — |
| `mode:multi` / `mode:single` | Override the plan's Execution mode | read from plan |
| `max-fix:<n>` | Cap on the fix loop | `3` |

## Agents orchestrated

| Stage | Agent | Model | Role |
|-------|-------|-------|------|
| Preflight | — (mechanical) | — | `grep`/diff spec `AC-N`s vs. plan `satisfies:` — no agent spawned |
| Build | `implementer` ×N | sonnet | One task each; parallel by non-overlapping owned paths; scoped self-verify |
| Test | `test-writer` ×(packages) | sonnet | One per touched package, once, against the full changed set — never per task |
| Review | `architecture-reviewer` | sonnet | Structural contracts (read-only) |
| Review | `plan-verifier` | sonnet | Requirement traceability / completeness (read-only) |
| Fix | `implementer` ×N | sonnet | Resolve critical/high + missing/partial findings |
| Canary | — (mechanical) | — | One full-suite pass per package, plain `Bash`, quiet reporter — no agent |

**Not invoked here:** `spec-creator`, `implementation-planner` (run manually beforehand).

## Guardrails

- Starts from a plan — never authors a spec or a plan.
- AC-N preflight and the final canary are plain mechanical steps run by the orchestrator itself —
  never spawn an agent for either.
- `test-writer` runs once per touched package after all implementers finish, never once per task —
  that would multiply the same unscoped-test-run cost this workflow is designed to avoid.
- Every test-running agent (`implementer`, `test-writer`) scopes its self-verification to the files
  it touched and uses a quiet reporter — never a bare package-wide test command.
- Never `git push`, merge, or open a PR — ends with a recommendation to run `pr-self-review`.
- Fix loop is bounded by `max-fix`; remaining findings are reported for a human, never looped forever.
- Concurrent implementers (build, test-writer, or fix loop) must own non-overlapping paths.
- Orchestrator keeps only short agent reports in context — heavy work stays isolated per agent.

## File structure

```
run-plan/
├── SKILL.md     ← orchestrator — phased execution algorithm + bounded fix loop
├── tile.json    ← skill metadata
└── README.md    ← this file
```

## Relationship to `pr-self-review`

`run-plan` builds and reviews a feature **before** push (deep structural + traceability gate via the
dedicated agents). `pr-self-review` is the **broad pre-push gate** (security, npm audit, contract
sync, test-coverage, react/next checks) that runs at `git push`. Run `run-plan` to build the feature,
then `pr-self-review` as the final gate before pushing.
