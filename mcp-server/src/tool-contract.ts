import type { ZodTypeAny } from 'zod';
import type { DevDigestApiClient } from './ports.js';
import type { DevDigestMcpConfig } from './config.js';
import type { ToolErrorResult } from './errors.js';

/**
 * Shared shape every `tools/*.ts` factory returns. Deliberately decoupled
 * from `@modelcontextprotocol/sdk`'s own `registerTool`/`tool` call signature
 * — that signature has shifted across SDK releases (docs/mcp-server-plan.md's
 * Work Item 10 note) — so each tool file can be implemented and typechecked
 * independently of which exact SDK version `container.ts`/`index.ts` (Phase
 * C) end up wiring against. Phase C adapts `ToolDefinition` to whatever the
 * installed SDK expects; tool factories never call the SDK directly.
 */

export interface ToolSuccessResult {
  isError?: false;
  content: [{ type: 'text'; text: string }];
  /** Optional machine-readable payload alongside the text summary — MCP's
   *  `structuredContent`, when the SDK version in use supports it. */
  structuredContent?: unknown;
}

export type ToolCallResult = ToolSuccessResult | ToolErrorResult;

/** Mirrors MCP's tool annotations — hints only, per this session's MCP
 *  research (clients must treat them as untrusted unless from a trusted
 *  server, but they're what lets a client skip a confirmation dialog for a
 *  read-only tool). */
export interface ToolAnnotations {
  title?: string;
  readOnlyHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface ToolDeps {
  client: DevDigestApiClient;
  config: DevDigestMcpConfig;
}

export interface ToolDefinition<Input = unknown> {
  /** Unqualified tool name, e.g. `list_agents` — `container.ts`/`index.ts`
   *  applies the `devdigest_` namespace prefix at registration time, so
   *  individual tool files don't hard-code it. */
  name: string;
  /** ≤~100 tokens, states *when* to call it — see
   *  docs/mcp-server-plan.md's "Tool Descriptions" section for the exact
   *  approved text per tool; use it verbatim. */
  description: string;
  inputSchema: ZodTypeAny;
  annotations: ToolAnnotations;
  handler: (input: Input, deps: ToolDeps) => Promise<ToolCallResult>;
}
