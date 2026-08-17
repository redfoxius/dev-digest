# Remote access for `mcp-server/` — Phase 2 (multi-user, OAuth 2.1)

**Status:** not started

This is a **follow-on** to [mcp-server-remote-access-plan.md](mcp-server-remote-access-plan.md)
(Phase 1: single-user, static bearer token, VPS + reverse proxy). It assumes
Phase 1 already shipped and is running. This doc exists so Phase 1's design
doesn't box this out — it is not scheduled work, just the recorded upgrade
path for when a second real user needs access.

## Trigger to actually start this

A second real user needing access — not a fixed date. Phase 1's bearer token
continues to work fine for a single user indefinitely; there's no forced
migration deadline baked into this plan.

## What changes vs. Phase 1

- **Auth model**: swap the hand-rolled bearer check in `mcp-server/src/http-server.ts`
  for the MCP SDK's own OAuth toolkit it already ships
  (`@modelcontextprotocol/sdk`'s `server/auth/router.js` for the
  authorization-server HTTP routes, `providers/proxyProvider.js` if
  delegating to an external IdP like GitHub OAuth/Auth0, or a custom
  `OAuthServerProvider` per `server/auth/provider.d.ts` if DevDigest issues
  its own tokens). This is the exact SDK machinery Phase 1 deliberately
  skipped because a single static secret didn't need it — here is where it
  earns its keep.
- **Identity/tenancy**: `server/src/db/schema/core.ts` already has `users`,
  `workspaces`, and `workspace_members` tables (currently populated only by
  the single seeded system user/workspace — `server/src/db/seed.ts`'s
  `SYSTEM_USER_EMAIL`/`DEFAULT_WORKSPACE_NAME`) — these are the "future
  lesson" tables the root `CLAUDE.md` already flags as shipped-but-empty.
  This phase fills them for real instead of adding new ones.
- **`server/`'s `AuthProvider` seam is the intended swap point** — already a
  clean port (`AuthProvider.currentUser(req)` /
  `currentWorkspace(req)`, `server/src/adapters/auth/local.ts`), already
  wired through one line in `server/src/platform/container.ts:99`
  (`this.auth = overrides.auth ?? new LocalNoAuthProvider(db)`). This phase
  adds a new adapter (e.g. `server/src/adapters/auth/oauth.ts`) implementing
  the same `AuthProvider` interface — resolving the validated OAuth token's
  subject to a real `users`/`workspace_members` row instead of always
  returning the one seeded system user — and wires it in behind an env flag
  (e.g. `AUTH_MODE=oauth`) so `LocalNoAuthProvider` stays the default for
  local single-user dev.
- **`server/`'s Fastify API itself likely needs to leave loopback-only** at
  this point too, if multiple remote users are meant to use the *studio*
  (`client/`), not just the MCP tools — that's a materially bigger
  perimeter than Phase 1's "only the MCP HTTP endpoint is public." Revisit
  `server/src/app.ts`'s single-origin CORS (`config.webOrigin`) and the
  global rate limit (currently `120/min` flat) for a multi-tenant,
  multi-origin setting at that time — don't carry Phase 1's single-user
  assumptions forward silently.
- **`mcp-server/`'s own config** (`DEVDIGEST_API_BASE` restricted to
  loopback, added as a security fix) stays correct unchanged **only if**
  `mcp-server/` and `server/` keep running co-located on the same host — if
  this phase ever splits them across hosts, that loopback restriction
  becomes the blocker to revisit first (it's an intentional fix, not
  something to quietly loosen).
- **Secrets**: `MCP_BEARER_TOKEN` (Phase 1's single static secret) is
  retired in favor of per-user OAuth client credentials / refresh tokens,
  which are DB-backed (per-workspace/user), not a single
  `~/.devdigest/secrets.json` key — that file stays for genuinely
  host-global secrets (BYO LLM keys), not per-user auth material.

## Not part of this doc

Concrete file-by-file implementation steps, migration SQL, and a verification
plan for this phase are deliberately not written yet — they depend on
decisions only worth making once a second real user is actually onboarding
(which IdP, whether DevDigest issues its own tokens vs. proxies an external
one, whether `client/` needs multi-tenant UI changes too). Write those out as
a proper Development Plan (via the `planner` agent, per this repo's session
protocol) at that point, using this doc as the starting context.
