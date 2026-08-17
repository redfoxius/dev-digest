import type { ToolDefinition } from '../tool-contract.js';
import { createGetBlastRadiusTool } from './get-blast-radius.js';
import { createGetConventionsTool } from './get-conventions.js';
import { createGetFindingsTool } from './get-findings.js';
import { createListAgentsTool } from './list-agents.js';
import { createRunAgentOnPrTool } from './run-agent-on-pr.js';

/**
 * Pure aggregator of the 5 tool factories' `ToolDefinition`s
 * (docs/mcp-server-plan.md's Work Item 10). Deliberately does NOT apply the
 * `devdigest_` namespace prefix — that happens in `index.ts` at actual SDK
 * registration time, so this file stays decoupled from
 * `@modelcontextprotocol/sdk` specifics, same as `tool-contract.ts` itself.
 */
export function getAllToolDefinitions(): ToolDefinition[] {
  // Each factory returns `ToolDefinition<SpecificInput>`; widening to the
  // default `ToolDefinition` (Input=unknown) is a deliberate, safe cast here
  // — `index.ts` only ever calls `def.handler(input, deps)` with `input`
  // already validated against `def.inputSchema` by the MCP SDK before the
  // handler runs, so the runtime shape always matches regardless of this
  // array's static element type.
  return [
    createListAgentsTool() as ToolDefinition,
    createRunAgentOnPrTool() as ToolDefinition,
    createGetFindingsTool() as ToolDefinition,
    createGetConventionsTool() as ToolDefinition,
    createGetBlastRadiusTool() as ToolDefinition,
  ];
}
