# @devdigest/mcp-server

A local [MCP](https://modelcontextprotocol.io) server that lets an MCP
client (Claude Desktop, Claude Code, etc.) drive DevDigest's PR review
workflow — list agents, kick off a review run, fetch findings, list a
repo's extracted conventions — without leaving the chat. It talks to
DevDigest's existing Fastify API (`server/`, `http://localhost:3001` by
default) over plain HTTP; it never imports `server/` code in-process, and it
requires no new secrets.

See [docs/mcp-server-plan.md](../docs/mcp-server-plan.md) for the full
design rationale, and [AGENTS.md](AGENTS.md) for this package's own
conventions.

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
| `devdigest_get_findings` | Fetches the findings/verdict of an already-completed run by `run_id` — no re-run needed. |
| `devdigest_get_conventions` | Lists the coding conventions DevDigest has extracted for a repo. Empty list if extraction hasn't run yet — not an error. |
| `devdigest_get_blast_radius` | **Not yet implemented.** Always returns an error explaining the gap; stays registered so it's discoverable. Use `get_findings`/`get_conventions` instead for now. |

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

For Claude Desktop / Claude Code, add a stdio server entry pointing at the
built entrypoint (adjust the path to this checkout):

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
