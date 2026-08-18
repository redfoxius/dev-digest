# `devdigest review --mode working` — CLI plan

**Status:** done

Blast Radius runs after a PR exists. This CLI command moves the same review
earlier — into the local working copy, before `git push` — by reusing the
exact engine and domain logic `server/` uses for PR reviews, run in-process
(no Postgres/API needs to be up).

## Problem

`server/`'s review pipeline (`reviewPullRequest` in `reviewer-core/`) only
ever runs against a persisted PR row, fed a diff loaded from a managed clone
(`server/clones/`). A working-tree diff is neither: it's the user's live,
uncommitted local checkout, which the server never sees. The CLI has to
collect that diff itself and hand it to the *same* engine — not a second,
parallel reviewer implementation.

## Decision: in-process reuse, not HTTP

Considered calling a new server HTTP endpoint instead (keeping `mcp-server`'s
existing "HTTP-only, never import server/ internals" rule intact). Rejected:
it would require Postgres+API booted just to lint a local diff before push,
defeating the point of moving the check earlier. `reviewer-core` is
side-effect-free by design (its own docstring: "shared by the server... and
the agent-runner (CI)") — a third TS-source consumer is exactly what it's
for, and `reviewer-core`'s own tests already cross-import
`server/src/adapters/mocks.ts` in-process, so this isn't a new precedent in
the repo, just the first time `mcp-server/` does it.

This amends `mcp-server/AGENTS.md`'s "no tsconfig paths aliases into
server/reviewer-core" bullet — narrowly, via named single-file aliases (not
a wildcard into all of `server/src`), so only these specific pure,
side-effect-free files are reachable:

- `@devdigest/reviewer-core` / `@devdigest/reviewer-core/*` → `reviewer-core/src` (mirrors `server/tsconfig.json`)
- `@devdigest/shared` / `@devdigest/shared/*` → `server/src/vendor/shared` (a live reference to server's existing vendor copy, not a third hand-copy)
- `@devdigest/server/diff-parser` → `server/src/adapters/git/diff-parser.ts` (pure unified-diff parser, zero I/O)
- `@devdigest/server/review-defaults` → `server/src/db/seed-prompts.ts` (pure string constants + `DEFAULT_PROVIDER`/`DEFAULT_MODEL`, new exports — see below)
- `@devdigest/server/review-constants` → `server/src/modules/reviews/constants.ts` (`REVIEW_STRATEGY`)

No DB, Fastify, Drizzle, Octokit, or `dotenv/config`-importing file is ever
reachable through these aliases.

## Decision: default reviewer, no agent selection

`--mode working` has no PR/DB, so there's no `Agent` row to pick a system
prompt/model from. It reviews with the exact same built-in "General
Reviewer" the server seeds by default: `GENERAL_REVIEWER_PROMPT` +
`openrouter`/`deepseek-v4-flash` + `single-pass` strategy + `critical` gate —
literally the same prompt text and constants, not a rewritten copy.

`server/src/db/seed.ts` currently declares `DEFAULT_PROVIDER`/`DEFAULT_MODEL`
as local (unexported) consts. Moved to `seed-prompts.ts` (already pure, zero
imports) and re-exported from there so both `seed.ts` and the CLI import the
same source of truth instead of the CLI hand-copying the literal string.

Needs `OPENROUTER_API_KEY` — read from `~/.devdigest/secrets.json` (the
existing, only secrets file in this repo) with an env-var fallback, mirroring
`LocalSecretsProvider.get()`'s read behavior. `mcp-server` gets its own tiny
read-only reader (not a `LocalSecretsProvider` import) since the file lives
in `server/src/adapters/secrets/local.ts`, which is not on the "pure,
zero-I/O" allowlist above — mirroring its ~15-line read path is simpler and
safer than widening the alias list for a class whose `set()` this CLI never
needs.

## CLI surface

```
devdigest review --mode working [--help]
```

1. Resolve the git root via `git rev-parse --show-toplevel` from `cwd`.
2. Collect the diff via `git diff HEAD` (staged + unstaged, tracked files
   only — this is `git diff`'s own contract, not a limitation we impose).
3. Collect untracked files via `git status --porcelain=v1` (`??` entries) —
   never fed to the reviewer; if any exist, print a `WARNING` line listing
   them (so their absence from the review is never silent) and say so in
   `--help`.
4. If the tracked diff is empty: print "No local changes to review" and
   exit 0 (not a failure — no changes is not an error).
5. Parse the diff (`parseUnifiedDiff`), build `ReviewInput` (prompt, model,
   diff, an injected `OpenRouterProvider`, `strategy: REVIEW_STRATEGY`,
   `task: 'Review local working tree changes'`), call `reviewPullRequest`
   from `reviewer-core` — the same call shape `run-executor.ts` uses, minus
   repo-intel/skills/intent (no repo row to resolve them from) and minus
   persistence (no DB).
6. Print findings to the terminal: severity, `file:line`, title, rationale
   — one per line, most severe first.
7. Exit code, using `reviewer-core`'s own `gateTriggered(findings,
   'critical')` (the exact function `toReviewPayload` uses to decide
   REQUEST_CHANGES) — never a second, hand-rolled severity check:
   - `0` — review completed, no CRITICAL finding (or no changes to review)
   - `1` — review completed, ≥1 CRITICAL finding (gate tripped)
   - `2` — the review itself could not be completed (not a git repo, no
     tracked changes AND the diff genuinely errors, missing
     `OPENROUTER_API_KEY`, git/LLM/parse failure) — never a silent false-clean

This contract is documented in `--help` output and `mcp-server/README.md`,
matching this repo's PR #18 lesson (`docs/pr-diff-reindex-plan.md`): fail
loud, never hand back an empty/clean result that isn't actually clean.

## Future modes (not implemented here)

`--mode staged` / `--mode branch` are recognized by the arg parser as valid
enum values so the CLI surface doesn't need a breaking change later, but
each currently exits 2 with "not yet implemented" rather than silently
falling through to `working`'s behavior.

## Files touched

- `server/src/db/seed-prompts.ts` — add `DEFAULT_PROVIDER`/`DEFAULT_MODEL` exports
- `server/src/db/seed.ts` — import them instead of redeclaring
- `mcp-server/tsconfig.json` — the 5 named aliases above
- `mcp-server/package.json` — `openai` dependency, `bin: devdigest`, `cli` dev script
- `mcp-server/src/cli/index.ts` — arg parsing + dispatch
- `mcp-server/src/cli/modes/working.ts` — orchestration
- `mcp-server/src/cli/git.ts` — root/diff/untracked collection (child_process, injectable exec for tests)
- `mcp-server/src/cli/secrets.ts` — `OPENROUTER_API_KEY` reader
- `mcp-server/src/cli/review.ts` — builds `ReviewInput`, calls `reviewPullRequest` (accepts an injected `LLMProvider` for testability)
- `mcp-server/src/cli/output.ts` — terminal formatting + exit-code decision
- `mcp-server/test/cli/*.test.ts` — hermetic unit tests (fake exec, fake LLM, temp secrets file)
- `mcp-server/AGENTS.md` — amend the "no server/reviewer-core aliases" bullet
- `mcp-server/README.md` — document the command + exit-code contract

## Verification

- `npm run typecheck` (mcp-server) clean
- `npm test` (mcp-server) — new hermetic CLI tests pass
- Manual: run `npm run cli -- review --mode working` inside a repo with a
  real uncommitted change and a set `OPENROUTER_API_KEY`, confirm findings
  print and exit code matches the contract; confirm exit 0 on a clean tree;
  confirm an untracked-only file produces the warning and is excluded.
