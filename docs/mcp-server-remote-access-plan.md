# Remote access for `mcp-server/` — Phase 1 (single-user, bearer token)

**Status:** not started

Follow-on doc: [mcp-server-oauth-migration-plan.md](mcp-server-oauth-migration-plan.md)
covers the future multi-user OAuth migration and assumes this phase shipped
first.

## Context

`mcp-server/` today only speaks MCP's **stdio** transport: an MCP client
(Claude Desktop, Claude Code) spawns `node dist/index.js` as a local
subprocess and talks to it over stdin/stdout. It has zero HTTP surface, zero
auth, and its own `DEVDIGEST_API_BASE` config is hard-restricted to loopback
hosts (`mcp-server/src/config.ts`, added as a security fix in the same
session this plan was written in). This was a **deliberate v1 decision**,
written down in `docs/mcp-server-plan.md`'s Architectural Constraints: "the
MCP server sends no bearer token in v1 — an accepted trust boundary, not a
gap to silently patch."

The goal now is to call this same tool set from a different machine over the
internet — e.g. running Claude Desktop/Code on a laptop while DevDigest
itself runs on a home server/VPS — for a **single user** (the account
holder). That reverses the v1 decision on purpose, so it gets its own plan
rather than a quiet patch.

## Why this shape

- MCP's current spec transport for non-stdio servers is **Streamable HTTP**.
  The installed SDK (`@modelcontextprotocol/sdk@1.30.0`) already ships
  `StreamableHTTPServerTransport`
  (`node_modules/@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.d.ts`)
  — it wraps Node's native `http.createServer` (`IncomingMessage`/
  `ServerResponse`), no Express/Fastify needed. Confirmed by reading the
  installed `.d.ts`, not assumed — same discipline `index.ts`'s own header
  comment already documents for this SDK.
- It supports a **stateless** mode (`sessionIdGenerator: undefined` in the
  constructor options) — no session store, no `Mcp-Session-Id` bookkeeping.
  Right fit for one user hitting one process; skip the stateful/session-store
  path entirely.
- The SDK also ships a full OAuth authorization-server toolkit
  (`server/auth/router.js`, `providers/proxyProvider.js`,
  `middleware/bearerAuth.js`, …) — but `bearerAuth.js`'s
  `requireBearerAuth()` returns an **Express** `RequestHandler` and expects
  an `OAuthTokenVerifier`. Pulling that in for a single static token would
  add an Express dependency and force-fit a non-OAuth secret into an
  OAuth-shaped interface, breaking `mcp-server/`'s explicit "no framework"
  stack convention for no real benefit. This phase hand-rolls a ~20-line
  bearer check instead; the OAuth toolkit is exactly the right tool for the
  migration doc's Phase 2.
- The token itself follows the repo's existing secrets convention (root
  `AGENTS.md`: "Secrets live in `~/.devdigest/secrets.json` (mode 0600), not
  `.env`, not DB") — same file `server/src/adapters/secrets/local.ts` writes
  to, new key, read the same way (`readFile` + `JSON.parse`, mode 0600). This
  is literally the contingency `mcp-server/AGENTS.md` already flagged: "if
  the server ever adds real bearer-token auth, the token is added as a new
  key to the *existing* `~/.devdigest/secrets.json`."
- `server/`'s Fastify API keeps binding `0.0.0.0:3001` as it does today, but
  that's fine **only if the VPS firewall never exposes 3001 externally** —
  the reverse proxy is the sole public listener. This must be explicit in
  the deployment checklist below, not left implicit.

## New/changed files

- **`mcp-server/src/config.ts`** — add `DEVDIGEST_MCP_HTTP_HOST` (default
  `127.0.0.1` — the Node process itself never binds a public interface, the
  reverse proxy does) and `DEVDIGEST_MCP_HTTP_PORT` (default e.g. `3900`).
- **`mcp-server/src/secrets.ts`** (new) — narrow, read-only reader for
  `~/.devdigest/secrets.json`'s new `MCP_BEARER_TOKEN` key. Mirrors
  `LocalSecretsProvider.load()`'s try/catch-on-missing-file shape but stays
  a free function, not a class — this package has exactly one secret to
  read, not a pluggable provider.
- **`mcp-server/src/auth.ts`** (new) — `verifyBearerToken(req, expected):
  boolean`, comparing the `Authorization: Bearer <token>` header with
  `crypto.timingSafeEqual` (not `===`, to avoid a timing side-channel on the
  one secret this whole scheme rests on). Missing/malformed header or
  mismatch → the HTTP handler in `http-server.ts` writes a 401 and never
  reaches the MCP transport.
- **`mcp-server/src/register-tools.ts`** (new, extracted from `index.ts`) —
  the `for (const def of getAllToolDefinitions()) { server.registerTool(...) }`
  loop currently inline in `index.ts:59-69`, pulled out so both `index.ts`
  (stdio) and the new `http-server.ts` share it instead of duplicating the
  namespace-prefix + `toCallToolResult` wiring.
- **`mcp-server/src/http-server.ts`** (new) — second entrypoint. Builds the
  same `McpServer` + container as `index.ts`, but instead of
  `StdioServerTransport`: creates one `StreamableHTTPServerTransport({
  sessionIdGenerator: undefined })`, connects it to the `McpServer` once at
  startup, and serves it via `http.createServer((req, res) => { if
  (!verifyBearerToken(req, token)) return reject401(res); return
  transport.handleRequest(req, res); })`, listening on
  `config.httpHost:config.httpPort`. `index.ts` itself is untouched — stdio
  stays the default local path, this is purely additive.
- **`mcp-server/package.json`** — add `"dev:http": "tsx watch
  src/http-server.ts"` and `"start:http": "node dist/http-server.js"`,
  mirroring the existing `dev`/`start` pair. No new dependencies — everything
  needed (`node:http`, `node:crypto`, `StreamableHTTPServerTransport`) is
  already available.
- **`mcp-server/README.md`** — new "Remote access (HTTP mode)" section:
  `MCP_BEARER_TOKEN` setup step, `DEVDIGEST_MCP_HTTP_HOST`/`_PORT` env vars,
  and a remote-client config example analogous to the existing stdio one
  (exact JSON shape for pointing Claude Desktop/Code at a remote HTTP MCP
  server should be pulled from that client's own current docs at
  implementation time, not guessed here).
- **`mcp-server/AGENTS.md`** — the Stack section currently states "stdio
  transport only — no HTTP/SSE transport, no OAuth" and the Non-default
  conventions section states "No secrets file for this package" — both need
  a dated revision note once this phase ships, since they're no longer true
  and this repo's own convention is dated correction lines, not silent
  rewrites.

## Deployment checklist

- Host: VPS or home server, same host as `server/`'s API (co-located — see
  "out of scope" below for why).
- Reverse proxy: Caddy (automatic TLS) or nginx, `reverse_proxy
  127.0.0.1:3900` (or whatever `DEVDIGEST_MCP_HTTP_PORT` is set to),
  forwarding the `Authorization` header through unmodified.
- Process supervision: a systemd unit running `node dist/http-server.js`
  with `Restart=on-failure`, env vars set (`DEVDIGEST_API_BASE`,
  `DEVDIGEST_MCP_HTTP_HOST=127.0.0.1`, `DEVDIGEST_MCP_HTTP_PORT`).
- Firewall: only 80/443 open externally. 3001 (API) and 3900 (MCP HTTP)
  reachable only from loopback — verify with an external `curl`/`nc` against
  those ports from outside the VPS, not just asserted.

## Explicitly out of scope for this phase

- No CORS handling — Claude Desktop/Code's remote-HTTP client is not a
  browser fetch, so no `Access-Control-Allow-Origin` is needed yet. Revisit
  only if a browser-based MCP client (e.g. a future claude.ai web connector)
  is targeted — which also means OAuth, i.e. the migration doc.
- `server/`'s existing Fastify config, CORS, and `LocalNoAuthProvider` —
  none of that changes here. The API stays a same-host, loopback-only
  dependency of the MCP process, same as it is for the stdio path today.
- No token rotation UI/CLI — a documented manual step (generate a random
  token, e.g. `openssl rand -hex 32`, drop it into
  `~/.devdigest/secrets.json` under `MCP_BEARER_TOKEN`) is enough for one
  user's own token.
- No app-level rate limiting on the new HTTP endpoint — rely on the reverse
  proxy (Caddy/nginx both support this natively) plus the existing
  `server/`-side `10/min` route limit on `POST /pulls/:id/review` that
  `run_agent_on_pr` already surfaces as a `DomainError` on 429.

## Verification

1. `npm run typecheck` / `npm test` in `mcp-server/` (existing commands,
   must still pass with the new files).
2. Local smoke test: `DEVDIGEST_MCP_HTTP_PORT=3900 npm run dev:http`, then
   `npx @modelcontextprotocol/inspector` pointed at
   `http://127.0.0.1:3900/mcp` with the bearer token set in Inspector's
   Authorization field — confirm all 5 `devdigest_*` tools list and
   `run_agent_on_pr` round-trips against a running `server/` (`./scripts/dev.sh`
   from repo root).
3. Negative test: same Inspector session with a wrong/missing token → 401,
   no tool calls reachable.
4. After deploying behind the reverse proxy: repeat step 2 from a **different
   machine** against the public HTTPS URL; then confirm `curl
   http://<vps-ip>:3001/health` and `curl http://<vps-ip>:3900/mcp` both
   fail/time out from outside the VPS (firewall check).
5. Confirm the existing stdio path (`npm run dev` / the current Claude
   Desktop config in `README.md`) still works unchanged — this phase must be
   additive, not a replacement.
