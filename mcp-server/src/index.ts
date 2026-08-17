#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { loadConfig } from './config.js';
import { createContainer } from './container.js';
import type { ToolCallResult } from './tool-contract.js';
import { getAllToolDefinitions } from './tools/index.js';

/**
 * Thin entrypoint (docs/mcp-server-plan.md's Work Item 10): loads config,
 * builds the container (the sole place `FetchDevDigestApiClient` is
 * constructed — see `container.ts`), registers every `tools/index.ts`
 * `ToolDefinition` under the `devdigest_` namespace prefix (applied HERE,
 * not in `tools/index.ts` — that file stays SDK-decoupled by design), and
 * connects a `StdioServerTransport`.
 *
 * SDK API note (installed `@modelcontextprotocol/sdk@1.30.0`, confirmed by
 * reading `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts`
 * rather than assumed from memory — this API has shifted across SDK
 * releases): `McpServer.registerTool<OutputArgs, InputArgs>(name, config,
 * cb)` where `config` is `{title?, description?, inputSchema?, outputSchema?,
 * annotations?, _meta?}` and `InputArgs extends undefined | ZodRawShapeCompat
 * | AnySchema` (`AnySchema = z3.ZodTypeAny | z4.$ZodType`). Because
 * `AnySchema` already covers a full `ZodTypeAny`/`ZodObject`, each tool's
 * `ToolDefinition.inputSchema` (already a full zod schema, not a raw
 * `{field: z.string()}` shape) is passed straight through as `inputSchema`
 * — no raw-shape conversion needed, unlike some MCP SDK examples/older
 * releases that only accepted a raw shape object.
 */

const DEVDIGEST_NAMESPACE_PREFIX = 'devdigest_';

/** Adapts this package's protocol-agnostic-ish `ToolCallResult` (shared by
 *  all 5 `tools/*.ts` handlers, see `tool-contract.ts`) to the SDK's own
 *  `CallToolResult` shape expected as a tool callback's return value. */
function toCallToolResult(result: ToolCallResult): CallToolResult {
  if (result.isError) {
    return { isError: true, content: result.content };
  }
  return {
    isError: result.isError,
    content: result.content,
    ...(result.structuredContent !== undefined
      ? { structuredContent: result.structuredContent as Record<string, unknown> }
      : {}),
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const { client } = createContainer(config);

  const server = new McpServer(
    { name: '@devdigest/mcp-server', version: '0.0.0' },
    { capabilities: { tools: {} } },
  );

  for (const def of getAllToolDefinitions()) {
    server.registerTool(
      `${DEVDIGEST_NAMESPACE_PREFIX}${def.name}`,
      {
        description: def.description,
        inputSchema: def.inputSchema,
        annotations: def.annotations,
      },
      async (input) => toCallToolResult(await def.handler(input, { client, config })),
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('mcp-server failed to start:', err);
  process.exit(1);
});
