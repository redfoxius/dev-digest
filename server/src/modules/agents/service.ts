import type { Container } from '../../platform/container.js';
import type {
  Agent,
  AgentContextDocLink,
  AgentSkillLink,
  AgentVersion,
  CiFailOn,
  ModelInfo,
  Provider,
  ReviewStrategy,
} from '@devdigest/shared';
import { AgentsRepository } from './repository.js';
import { toAgentDto, toAgentVersionDto } from './helpers.js';

/**
 * A2 — agents service. Business logic for the Agents tab + Agent Editor.
 * Provider/model selection uses the LLM adapter's dynamic model list.
 *
 * An Agent = provider + model + system_prompt + linked skills + output_schema +
 * enabled. Config changes are versioned via `agent_versions` (repository).
 */

// Re-exported for backwards compatibility; implementation lives in ./helpers.
export { toAgentDto } from './helpers.js';

export interface CreateAgentInput {
  name: string;
  description?: string;
  provider: Provider;
  model: string;
  system_prompt: string;
  output_schema?: unknown;
  strategy?: ReviewStrategy;
  ci_fail_on?: CiFailOn;
  repo_intel?: boolean;
  enabled?: boolean;
}

export interface UpdateAgentInput {
  name?: string;
  description?: string;
  provider?: Provider;
  model?: string;
  system_prompt?: string;
  output_schema?: unknown;
  strategy?: ReviewStrategy;
  ci_fail_on?: CiFailOn;
  repo_intel?: boolean;
  enabled?: boolean;
}

export class AgentsService {
  private repo: AgentsRepository;

  constructor(private container: Container) {
    this.repo = new AgentsRepository(container.db);
  }

  async list(workspaceId: string): Promise<Agent[]> {
    const rows = await this.repo.list(workspaceId);
    const counts = await this.repo.skillsCountByAgentIds(rows.map((r) => r.id));
    return rows.map((row) => toAgentDto(row, counts.get(row.id) ?? 0));
  }

  async get(workspaceId: string, id: string): Promise<Agent | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    if (!row) return undefined;
    const counts = await this.repo.skillsCountByAgentIds([row.id]);
    return toAgentDto(row, counts.get(row.id) ?? 0);
  }

  /** Delete an agent (and its versions/skill-links, via cascade). */
  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  async create(workspaceId: string, input: CreateAgentInput, userId?: string): Promise<Agent> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      provider: input.provider,
      model: input.model,
      systemPrompt: input.system_prompt,
      outputSchema: input.output_schema,
      ...(input.strategy !== undefined ? { strategy: input.strategy } : {}),
      ...(input.ci_fail_on !== undefined ? { ciFailOn: input.ci_fail_on } : {}),
      ...(input.repo_intel !== undefined ? { repoIntel: input.repo_intel } : {}),
      enabled: input.enabled,
      createdBy: userId ?? null,
    });
    return toAgentDto(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateAgentInput,
  ): Promise<Agent | undefined> {
    const row = await this.repo.update(workspaceId, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
      ...(patch.model !== undefined ? { model: patch.model } : {}),
      ...(patch.system_prompt !== undefined ? { systemPrompt: patch.system_prompt } : {}),
      ...(patch.output_schema !== undefined ? { outputSchema: patch.output_schema } : {}),
      ...(patch.strategy !== undefined ? { strategy: patch.strategy } : {}),
      ...(patch.ci_fail_on !== undefined ? { ciFailOn: patch.ci_fail_on } : {}),
      ...(patch.repo_intel !== undefined ? { repoIntel: patch.repo_intel } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    });
    if (!row) return undefined;
    const counts = await this.repo.skillsCountByAgentIds([row.id]);
    return toAgentDto(row, counts.get(row.id) ?? 0);
  }

  /**
   * Config history for an agent, newest version first. Workspace-scoped: returns
   * undefined when the agent isn't in this workspace (the route maps that to 404)
   * so version snapshots can't be read across tenants.
   */
  async listVersions(workspaceId: string, agentId: string): Promise<AgentVersion[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const rows = await this.repo.listVersions(agentId);
    return rows.map(toAgentVersionDto);
  }

  /**
   * A single config snapshot for an agent. Returns undefined when the agent isn't
   * in this workspace OR that version was never recorded (route → 404).
   */
  async getVersion(
    workspaceId: string,
    agentId: string,
    version: number,
  ): Promise<AgentVersion | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const row = await this.repo.getVersion(agentId, version);
    return row ? toAgentVersionDto(row) : undefined;
  }

  /** Linked skills for an agent as AgentSkillLink[] (ordered). */
  async skillLinks(agentId: string): Promise<AgentSkillLink[]> {
    const links = await this.repo.linkedSkills(agentId);
    return links.map((l) => ({
      agent_id: agentId,
      skill_id: l.skill.id,
      order: l.order,
      enabled: l.enabled,
    }));
  }

  /**
   * Set / reorder the agent's linked skills. If `skillIds` is provided, replaces
   * the whole set in that order. Returns the resulting ordered links.
   */
  async setSkills(
    workspaceId: string,
    agentId: string,
    skillIds: string[],
  ): Promise<AgentSkillLink[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    await this.repo.setSkills(agentId, skillIds);
    return this.skillLinks(agentId);
  }

  /** Link a single skill (append or set order) — additive to existing links. */
  async linkSkill(
    workspaceId: string,
    agentId: string,
    skillId: string,
    order?: number,
  ): Promise<AgentSkillLink[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const existing = await this.repo.linkedSkills(agentId);
    const resolvedOrder = order ?? existing.length;
    await this.repo.linkSkill(agentId, skillId, resolvedOrder);
    return this.skillLinks(agentId);
  }

  /**
   * The Agent Editor's unified Skills-tab checkbox: checking a not-yet-linked
   * skill both attaches it (appended at the end of the current order) AND
   * enables it in one call; unchecking a linked skill flips `enabled` off
   * without unlinking it. Returns the resulting ordered links, or undefined
   * if the agent isn't in this workspace (route → 404).
   */
  async setSkillEnabled(
    workspaceId: string,
    agentId: string,
    skillId: string,
    enabled: boolean,
  ): Promise<AgentSkillLink[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    await this.repo.setSkillEnabled(agentId, skillId, enabled);
    return this.skillLinks(agentId);
  }

  /** Attached context docs for an agent within one repo, as
   *  AgentContextDocLink[] (ordered), each joined against the current
   *  `context_documents` catalog to populate `document` (`null` once a path
   *  no longer resolves — AC-22's backend half). */
  private async contextDocLinks(agentId: string, repoId: string): Promise<AgentContextDocLink[]> {
    const links = await this.repo.linkedContextDocs(agentId, repoId);
    if (links.length === 0) return [];
    const paths = new Set(links.map((l) => l.path));
    // Cross-module read of the `context_documents` catalog via
    // `container.contextDocsRepo` (not this module's own repository.ts —
    // onion-architecture: repositories stay drizzle-only, cross-module
    // orchestration lives here in the service). No batch-by-paths method
    // exists on `ContextDocsRepository`, so `listByRepo` is filtered
    // client-side to the paths this agent has attached.
    const [allDocs, usedByCounts] = await Promise.all([
      this.container.contextDocsRepo.listByRepo(repoId),
      this.container.contextDocsRepo.usedByCounts(repoId),
    ]);
    const docsByPath = new Map(allDocs.filter((d) => paths.has(d.path)).map((d) => [d.path, d]));
    return links.map((l) => {
      const doc = docsByPath.get(l.path);
      const usedBy = usedByCounts.get(l.path) ?? { agents: 0, skills: 0 };
      return {
        path: l.path,
        order: l.order,
        enabled: l.enabled,
        document: doc
          ? {
              id: doc.id,
              path: doc.path,
              root: doc.root,
              size_bytes: doc.sizeBytes,
              chunk_count: doc.chunkCount,
              index_status: doc.indexStatus,
              used_by_agents: usedBy.agents,
              used_by_skills: usedBy.skills,
              last_indexed_at: doc.lastIndexedAt.toISOString(),
            }
          : null,
      };
    });
  }

  /** Resolves the workspace-scoped agent AND the workspace-scoped repo (a
   *  repo id from another workspace never resolves — AC-40), returning
   *  `undefined` (route → 404) if either check fails. */
  private async assertAgentAndRepoInWorkspace(
    workspaceId: string,
    agentId: string,
    repoId: string,
  ): Promise<boolean> {
    const [agent, repo] = await Promise.all([
      this.repo.getById(workspaceId, agentId),
      this.container.reposRepo.getById(workspaceId, repoId),
    ]);
    return Boolean(agent) && Boolean(repo);
  }

  /** GET /agents/:id/context-docs — the Agent Editor Context tab's list. */
  async getContextDocLinks(
    workspaceId: string,
    agentId: string,
    repoId: string,
  ): Promise<AgentContextDocLink[] | undefined> {
    if (!(await this.assertAgentAndRepoInWorkspace(workspaceId, agentId, repoId))) return undefined;
    return this.contextDocLinks(agentId, repoId);
  }

  /**
   * POST /agents/:id/context-docs — bulk set/reorder (AC-20). Replaces the
   * full ordered list; a not-previously-attached path defaults to
   * `enabled: false` (never silently enables an unrelated unchecked row —
   * see `AgentsRepository.setAgentContextDocs`).
   */
  async setContextDocs(
    workspaceId: string,
    agentId: string,
    repoId: string,
    paths: string[],
  ): Promise<AgentContextDocLink[] | undefined> {
    if (!(await this.assertAgentAndRepoInWorkspace(workspaceId, agentId, repoId))) return undefined;
    await this.repo.setAgentContextDocs(agentId, repoId, paths);
    return this.contextDocLinks(agentId, repoId);
  }

  /**
   * PATCH /agents/:id/context-docs/:path — the Context tab checkbox: attach
   * + enable (if not yet attached) or toggle `enabled` (if attached), never
   * deleting the row on uncheck (AC-18, AC-19).
   */
  async setContextDocEnabled(
    workspaceId: string,
    agentId: string,
    repoId: string,
    path: string,
    enabled: boolean,
  ): Promise<AgentContextDocLink[] | undefined> {
    if (!(await this.assertAgentAndRepoInWorkspace(workspaceId, agentId, repoId))) return undefined;
    await this.repo.setAgentContextDocEnabled(agentId, repoId, path, enabled);
    return this.contextDocLinks(agentId, repoId);
  }

  /**
   * Dynamic model list from the provider adapter's /models. Degrades gracefully
   * to [] if the provider key is not configured (the editor still renders).
   */
  async listModels(provider: Provider): Promise<ModelInfo[]> {
    try {
      const llm = await this.container.llm(provider);
      return await llm.listModels();
    } catch {
      return [];
    }
  }
}
