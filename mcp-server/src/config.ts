import { z } from 'zod';

/**
 * Local config, read from `process.env` only — no secrets file. Nothing this
 * package needs today is sensitive: the API base URL isn't a secret, and
 * `server/src/modules/_shared/context.ts`'s `LocalNoAuthProvider` means no
 * bearer token is required in v1 (see docs/mcp-server-plan.md's
 * Architectural Constraints). If the server ever adds real bearer-token
 * auth, the token belongs as a new key in the *existing*
 * `~/.devdigest/secrets.json` (`server/src/platform/config.ts`'s
 * `secretsPath`, read the way `LocalSecretsProvider` does,
 * `server/src/adapters/secrets/local.ts`) — never a second secrets file.
 */
const EnvSchema = z.object({
  // Matches server/src/platform/config.ts's API_PORT default (3001).
  DEVDIGEST_API_BASE: z.string().url().default('http://localhost:3001'),
  // 45s default: must sit under the MCP SDK Client's own default per-call
  // request timeout (DEFAULT_REQUEST_TIMEOUT_MSEC = 60000ms,
  // node_modules/@modelcontextprotocol/sdk/dist/esm/shared/protocol.js:8),
  // confirmed live during this package's E2E verification — otherwise a
  // real client without an explicit longer per-call timeout hits a generic
  // SDK protocol timeout before this tool's own "still running" fallback
  // ever gets a chance to fire (the SDK's timeout always wins that race).
  // ~15s margin below 60s covers the resolve/trigger/poll HTTP round-trips.
  DEVDIGEST_MCP_POLL_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  DEVDIGEST_MCP_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2_000),
});

export interface DevDigestMcpConfig {
  apiBase: string;
  pollTimeoutMs: number;
  pollIntervalMs: number;
}

/** Parses `process.env` (or an injected map, for tests) into config —
 *  throws a ZodError with a specific field/message on malformed input
 *  rather than silently falling back, mirroring server/src/platform/config.ts. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): DevDigestMcpConfig {
  const parsed = EnvSchema.parse(env);
  return {
    apiBase: parsed.DEVDIGEST_API_BASE,
    pollTimeoutMs: parsed.DEVDIGEST_MCP_POLL_TIMEOUT_MS,
    pollIntervalMs: parsed.DEVDIGEST_MCP_POLL_INTERVAL_MS,
  };
}
