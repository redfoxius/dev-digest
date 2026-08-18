# @devdigest/mcp-server

Two things live here:

1. A local [MCP](https://modelcontextprotocol.io) server that lets an MCP
   client (Claude Desktop, Claude Code, etc.) drive DevDigest's PR review
   workflow — list agents, kick off a review run, fetch findings, list a
   repo's extracted conventions — without leaving the chat. It talks to
   DevDigest's existing Fastify API (`server/`, `http://localhost:3001` by
   default) over plain HTTP; it never imports `server/` code in-process, and
   it requires no new secrets.
2. The `devdigest` CLI (`devdigest review --mode working`) — moves that same
   review earlier, into your local working copy before `git push`, by
   reusing the exact same reviewer engine **in-process**. Needs no running
   API/DB, but does need `OPENROUTER_API_KEY`. See [CLI](#cli) below.

See [docs/mcp-server-plan.md](../docs/mcp-server-plan.md) (the MCP tools) and
[docs/cli-working-review-plan.md](../docs/cli-working-review-plan.md) (the
CLI) for the full design rationale, and [AGENTS.md](AGENTS.md) for this
package's own conventions.

## Prerequisites

The DevDigest stack must already be running — this server is a thin client,
not a replacement for it:

```sh
# from the repo root
./scripts/dev.sh
```

## Tools

All 5 tools are namespaced `devdigest_*`. `repo` params take GitHub-native
`owner/repo` form; PRs are addressed by number — both are resolved
internally to DevDigest's DB uuids, so no MCP client ever has to know them.

| Tool | What it does |
| --- | --- |
| `devdigest_list_agents` | Lists the reviewer agents configured in this workspace. Call first to get a valid `agent` id/name for `run_agent_on_pr`. |
| `devdigest_run_agent_on_pr` | Runs one agent on a PR and returns its verdict + findings in one call (creates the run, polls until done or timeout — up to ~45s by default). |
| `devdigest_get_findings` | Fetches findings/verdicts for a whole PR, across every agent that has reviewed it — one entry per agent (latest run) by default, or the full run history with `all_runs:true`. |
| `devdigest_get_conventions` | Lists the ACCEPTED coding conventions DevDigest has extracted for a repo (pending/rejected candidates are never returned). Empty list if extraction hasn't run yet, or nothing's been accepted — not an error. |
| `devdigest_get_blast_radius` | Fetches the impact map (`GET /pulls/:id/blast`) for the PR's changed symbols. |

## Configuration

Environment variables (all optional, sensible local defaults):

| Var | Default | Meaning |
| --- | --- | --- |
| `DEVDIGEST_API_BASE` | `http://localhost:3001` | Base URL of the running DevDigest API. |
| `DEVDIGEST_MCP_POLL_TIMEOUT_MS` | `45000` (45s) | How long `run_agent_on_pr` polls for a run to finish before returning a `status:'running'` fallback. Kept under the MCP SDK `Client`'s default 60s per-call request timeout so this fallback actually fires instead of a raw protocol timeout — see `mcp-server/INSIGHTS.md`. |
| `DEVDIGEST_MCP_POLL_INTERVAL_MS` | `2000` | Poll interval while waiting for a run to finish. |

No API key or token is required — the server has no real auth boundary
today (`LocalNoAuthProvider`); see [AGENTS.md](AGENTS.md)'s Non-default
conventions for what happens if that changes later.

## Running it

```sh
npm install
npm run build
node dist/index.js
```

or, without a build step, during development:

```sh
npm run dev   # tsx watch src/index.ts
```

## Pointing an MCP client at it

Claude Code auto-connects to this server via the repo-root `.mcp.json`
(relative path to `mcp-server/dist/index.js`) — just run `npm install &&
npm run build` in this directory once so `dist/` exists, then reopen/reload
the project.

For Claude Desktop, or any other client, add a stdio server entry pointing
at the built entrypoint (adjust the path to this checkout):

```json
{
  "mcpServers": {
    "devdigest": {
      "command": "node",
      "args": ["/absolute/path/to/dev-digest/mcp-server/dist/index.js"],
      "env": {
        "DEVDIGEST_API_BASE": "http://localhost:3001"
      }
    }
  }
}
```

For manual, client-free verification, use the MCP Inspector:

```sh
npx @modelcontextprotocol/inspector node dist/index.js
```

## CLI

`devdigest review --mode working` reviews your **local working tree** —
staged + unstaged changes to tracked files (`git diff HEAD`) — with the same
`reviewPullRequest` engine and built-in General Reviewer prompt/model
`server/` uses for a PR, run **in-process** (no Postgres/API needs to be
running). See
[docs/cli-working-review-plan.md](../docs/cli-working-review-plan.md) for
the full design.

```sh
npm run build
node dist/cli/index.js review --mode working
```

or, without a build step:

```sh
npm run cli -- review --mode working
```

Requires `OPENROUTER_API_KEY`, read the same way `server/`'s
`LocalSecretsProvider` does — from `~/.devdigest/secrets.json`, falling back
to the environment.

**Only tracked changes are reviewed.** `git diff HEAD` doesn't see untracked
files by design; if any exist, the command prints a `WARNING` naming them so
their exclusion is never silent. `git add` them (or wait for `--mode
staged`, not yet implemented) to include them.

**Exit codes** (a deliberate contract, not an accident — never a silent
false-clean):

| Code | Meaning |
| --- | --- |
| `0` | Review completed; no CRITICAL finding (or there was nothing to review). |
| `1` | Review completed; at least one CRITICAL finding was reported. |
| `2` | The review could not be completed — not a git repo, a `git` failure, a missing `OPENROUTER_API_KEY`, or an LLM/parse error. |

`--mode staged` and `--mode branch` are recognized by the arg parser as
future work but currently exit `2` with "not yet implemented."
