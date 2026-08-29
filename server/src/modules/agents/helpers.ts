import type { Agent, AgentVersion, CiFailOn, LLMProvider, Provider, ReviewStrategy } from '@devdigest/shared';
import { AgentVersionConfig } from '@devdigest/shared';
import type { AgentRow, AgentVersionRow, LinkedSkillRow } from './repository.js';
import { buildStackFraming } from '../reviews/helpers.js';
import { REVIEW_STRATEGY } from '../reviews/constants.js';

/**
 * Pure helpers for the agents module — DB row ⇄ DTO mapping and the
 * config-version-bump rule. No I/O; behaviour-identical to the previous inline
 * implementations.
 */

/**
 * Map a persisted agent row to the public `Agent` DTO. `skillsCount` — linked
 * skills with BOTH the link's `enabled` AND the skill's own global `enabled`
 * true — is computed by the caller via one grouped query per batch (see
 * `AgentsRepository.skillsCountByAgentIds`), not looked up per-row here.
 */
export function toAgentDto(row: AgentRow, skillsCount = 0): Agent {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    provider: row.provider as Provider,
    model: row.model,
    system_prompt: row.systemPrompt,
    output_schema: row.outputSchema ?? null,
    enabled: row.enabled,
    version: row.version,
    strategy: row.strategy as ReviewStrategy,
    ci_fail_on: row.ciFailOn as CiFailOn,
    repo_intel: row.repoIntel,
    skills_count: skillsCount,
  };
}

/**
 * Map a persisted `agent_versions` row to the public `AgentVersion` DTO. The
 * stored `config_json` is untyped jsonb (a snapshot from an older config shape
 * could drift), so it is parsed through `AgentVersionConfig` — a malformed
 * snapshot throws here rather than leaking an unvalidated blob to the client.
 */
export function toAgentVersionDto(row: AgentVersionRow): AgentVersion {
  return {
    agent_id: row.agentId,
    version: row.version,
    config: AgentVersionConfig.parse(row.configJson),
    created_at: row.createdAt.toISOString(),
  };
}

/** Fields whose change bumps the agent's config version (anything but `enabled`). */
export interface ConfigChangePatch {
  name?: string;
  description?: string;
  provider?: Provider;
  model?: string;
  systemPrompt?: string;
  outputSchema?: unknown;
  strategy?: ReviewStrategy;
  ciFailOn?: CiFailOn;
  repoIntel?: boolean;
}

/**
 * True when a patch changes config (vs. just toggling `enabled`) relative to the
 * existing row — a config change bumps the version and snapshots agent_versions.
 */
export function isConfigChange(
  existing: Pick<
    AgentRow,
    | 'name'
    | 'description'
    | 'provider'
    | 'model'
    | 'systemPrompt'
    | 'strategy'
    | 'ciFailOn'
    | 'repoIntel'
  >,
  patch: ConfigChangePatch,
): boolean {
  return (
    (patch.name !== undefined && patch.name !== existing.name) ||
    (patch.description !== undefined && patch.description !== existing.description) ||
    (patch.provider !== undefined && patch.provider !== existing.provider) ||
    (patch.model !== undefined && patch.model !== existing.model) ||
    (patch.systemPrompt !== undefined && patch.systemPrompt !== existing.systemPrompt) ||
    (patch.strategy !== undefined && patch.strategy !== existing.strategy) ||
    (patch.ciFailOn !== undefined && patch.ciFailOn !== existing.ciFailOn) ||
    (patch.repoIntel !== undefined && patch.repoIntel !== existing.repoIntel) ||
    patch.outputSchema !== undefined
  );
}

// ===========================================================================
// resolveAgentRunConfig — the shared "current effective config for this
// agent" recipe (specs/cross-cutting/eval-pipeline/plan.md WI-6 Step 0).
// ===========================================================================

/** The subset of an agent's current, LIVE run config — provider client,
 *  model, strategy, resolved (linked + BOTH-enabled) skill bodies, and the
 *  final system prompt (base + stack-framing addendum). Everything
 *  repo-bound (repo-intel enrichment, Project Context Folder docs, Intent
 *  Layer text, task framing) stays OUTSIDE this shape — an eval case has no
 *  bound live repo (spec §4), and a real review's `ReviewRunExecutor`
 *  resolves those separately, around this. */
export interface ResolvedAgentRunConfig {
  llm: LLMProvider;
  model: string;
  strategy: ReviewStrategy;
  /** Resolved bodies of every linked skill whose link AND own global
   *  `enabled` are both true, in `order` — an empty array (never omitted)
   *  when none resolve; the caller decides whether to pass an empty vs.
   *  omitted `skills` key downstream. */
  skills: string[];
  /** Same skills' ids, parallel to `skills` — for run-level bookkeeping
   *  (e.g. `recordRunSkills`) that an eval run doesn't need but a real
   *  review does; kept here so callers never re-fetch `linkedSkills` twice. */
  skillIds: string[];
  systemPrompt: string;
}

/**
 * Resolve an agent's CURRENT effective run config: the exact
 * provider/model/strategy/skill-filter/system-prompt recipe
 * `ReviewRunExecutor.runOneAgent` (`reviews/run-executor.ts`) already applied
 * inline before this extraction, and `EvalsService.runCases`
 * (`evals/service.ts`) now ALSO calls — so an eval run reflects a real
 * review's config by construction, rather than duplicating (and risking
 * silently drifting from) this recipe
 * (specs/cross-cutting/eval-pipeline/plan.md, "Shared agent-run-config
 * resolution" Architectural Constraint).
 *
 * Deliberately narrow dependencies (a bound `llm` resolver + the
 * `agentsRepo.linkedSkills` shape, not a whole `Container`/`AgentsRepository`)
 * so this stays trivially unit-testable and avoids a helpers.ts ⇄
 * repository.ts import cycle beyond the one already established
 * (`repository.ts` already imports `isConfigChange` from this file).
 */
export async function resolveAgentRunConfig(
  llm: (provider: Provider) => Promise<LLMProvider>,
  agentsRepo: { linkedSkills(agentId: string): Promise<LinkedSkillRow[]> },
  agent: Pick<AgentRow, 'id' | 'provider' | 'model' | 'strategy' | 'systemPrompt'>,
  diffFiles: string[],
): Promise<ResolvedAgentRunConfig> {
  const resolvedLlm = await llm(agent.provider as Provider);

  const linked = await agentsRepo.linkedSkills(agent.id);
  const attached = linked.filter((l) => l.enabled && l.skill.enabled);
  const skills = attached.map((l) => l.skill.body);
  const skillIds = attached.map((l) => l.skill.id);

  const stackFraming = buildStackFraming(diffFiles);
  const systemPrompt = stackFraming ? `${agent.systemPrompt}\n\n${stackFraming}` : agent.systemPrompt;

  const strategy = (agent.strategy as ReviewStrategy | null) ?? REVIEW_STRATEGY;

  return { llm: resolvedLlm, model: agent.model, strategy, skills, skillIds, systemPrompt };
}
