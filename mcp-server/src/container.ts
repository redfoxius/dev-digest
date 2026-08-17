import type { DevDigestMcpConfig } from './config.js';
import { FetchDevDigestApiClient } from './http-client.js';
import type { DevDigestApiClient } from './ports.js';

/**
 * Composition root (docs/mcp-server-plan.md's Work Item 10 / "Port &
 * Composition Root" section). This is the ONLY file in the package that
 * writes `new FetchDevDigestApiClient(...)` — every other file (`resolve.ts`,
 * every `tools/*.ts` factory) depends on the `DevDigestApiClient` port type
 * from `ports.ts`, never on `http-client.ts`'s concrete class directly.
 * `index.ts` calls `createContainer(config)` once at startup and hands the
 * resulting `client` down to each tool's `ToolDeps`.
 */
export interface Container {
  client: DevDigestApiClient;
}

export function createContainer(config: DevDigestMcpConfig): Container {
  const client: DevDigestApiClient = new FetchDevDigestApiClient(config);
  return { client };
}
