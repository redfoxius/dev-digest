import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import { AgentsService } from '../src/modules/agents/service.js';
import { AgentsRepository } from '../src/modules/agents/repository.js';
import type { Container } from '../src/platform/container.js';
import type { Db } from '../src/db/client.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[agents-skills] Docker not available — skipping integration tests.');
}

/**
 * Agent <-> Skill links (`agent_skills`, per-link `enabled`) — the API the
 * Agent Editor's unified Skills-tab checkbox/drag-reorder relies on.
 * Covers: `linkedSkills` surfaces each link's `enabled`; `setSkillEnabled`
 * attach+enable in one call and toggle-without-unlink; `setSkills` preserves
 * unrelated skills' `enabled` state across a pure reorder (the correctness
 * fix — a reorder must never silently flip an unchecked skill to enabled);
 * every skill-link mutation bumps the agent's version + snapshots
 * `agent_versions`; `skills_count` filters on BOTH the link's and the
 * skill's own global `enabled`.
 */
d('agent_skills links', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  async function makeAgent(repo: AgentsRepository, name: string) {
    return repo.insert({
      workspaceId,
      name,
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'Review the diff.',
    });
  }

  async function makeSkill(db: Db, name: string, enabled = true) {
    const [row] = await db
      .insert(t.skills)
      .values({
        workspaceId,
        name,
        description: '',
        type: 'custom',
        source: 'manual',
        body: `# ${name}`,
        enabled,
      })
      .returning();
    return row!;
  }

  it('linkedSkills returns each link\'s enabled, ordered ascending by order', async () => {
    const { db } = pg.handle;
    const repo = new AgentsRepository(db);
    const agent = await makeAgent(repo, 'Linked Skills Order');
    const skillA = await makeSkill(db, 'skill-a');
    const skillB = await makeSkill(db, 'skill-b');

    await repo.setSkillEnabled(agent.id, skillA.id, true);
    await repo.setSkillEnabled(agent.id, skillB.id, false);

    const links = await repo.linkedSkills(agent.id);
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({ order: 0, enabled: true });
    expect(links[0]!.skill.id).toBe(skillA.id);
    expect(links[1]).toMatchObject({ order: 1, enabled: false });
    expect(links[1]!.skill.id).toBe(skillB.id);
  });

  it('setSkillEnabled attaches AND enables an unlinked skill in one call', async () => {
    const { db } = pg.handle;
    const repo = new AgentsRepository(db);
    const agent = await makeAgent(repo, 'Attach And Enable');
    const skill = await makeSkill(db, 'unattached-skill');

    // Not linked yet.
    expect(await repo.linkedSkills(agent.id)).toHaveLength(0);

    await repo.setSkillEnabled(agent.id, skill.id, true);

    const links = await repo.linkedSkills(agent.id);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ order: 0, enabled: true });
    expect(links[0]!.skill.id).toBe(skill.id);
  });

  it('setSkillEnabled on an already-linked skill flips enabled without touching order', async () => {
    const { db } = pg.handle;
    const repo = new AgentsRepository(db);
    const agent = await makeAgent(repo, 'Toggle Without Reorder');
    const skillA = await makeSkill(db, 'first');
    const skillB = await makeSkill(db, 'second');

    await repo.setSkillEnabled(agent.id, skillA.id, true); // order 0
    await repo.setSkillEnabled(agent.id, skillB.id, true); // order 1

    // Uncheck skillA — row persists, keeps order 0, just enabled: false.
    await repo.setSkillEnabled(agent.id, skillA.id, false);

    const links = await repo.linkedSkills(agent.id);
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({ order: 0, enabled: false });
    expect(links[0]!.skill.id).toBe(skillA.id);
    expect(links[1]).toMatchObject({ order: 1, enabled: true });
    expect(links[1]!.skill.id).toBe(skillB.id);

    // Re-check it — same row, same order, enabled flips back.
    await repo.setSkillEnabled(agent.id, skillA.id, true);
    const relinked = await repo.linkedSkills(agent.id);
    expect(relinked[0]).toMatchObject({ order: 0, enabled: true });
  });

  it(
    'setSkills preserves each skill\'s current enabled state across a pure reorder, ' +
      'defaulting only never-linked ids to false',
    async () => {
      const { db } = pg.handle;
      const repo = new AgentsRepository(db);
      const agent = await makeAgent(repo, 'Reorder Preserves Enabled');
      const skillA = await makeSkill(db, 'a-enabled');
      const skillB = await makeSkill(db, 'b-disabled');
      const skillC = await makeSkill(db, 'c-never-linked');

      await repo.setSkillEnabled(agent.id, skillA.id, true);
      await repo.setSkillEnabled(agent.id, skillB.id, false);
      // skillC was never linked before this reorder.

      // A pure reorder (drag) submitted from the catalog list — includes the
      // previously-unlinked skillC too, per the unified-list drag semantics.
      await repo.setSkills(agent.id, [skillC.id, skillB.id, skillA.id]);

      const links = await repo.linkedSkills(agent.id);
      const byId = new Map(links.map((l) => [l.skill.id, l]));

      // skillB stays disabled — a reorder-only drag must NOT flip it on just
      // because it appears in the reordered array.
      expect(byId.get(skillB.id)).toMatchObject({ order: 1, enabled: false });
      // skillA keeps its prior enabled: true.
      expect(byId.get(skillA.id)).toMatchObject({ order: 2, enabled: true });
      // skillC, never linked before, defaults to false (attaching via drag
      // alone does not enable it — only the checkbox / setSkillEnabled does).
      expect(byId.get(skillC.id)).toMatchObject({ order: 0, enabled: false });
    },
  );

  it('every skill-link mutation bumps the agent version and snapshots agent_versions', async () => {
    const { db } = pg.handle;
    const repo = new AgentsRepository(db);
    const agent = await makeAgent(repo, 'Version Bump Coverage');
    const skillA = await makeSkill(db, 'v-skill-a');
    const skillB = await makeSkill(db, 'v-skill-b');
    expect(agent.version).toBe(1);

    await repo.linkSkill(agent.id, skillA.id, 0);
    let current = await repo.getById(workspaceId, agent.id);
    expect(current!.version).toBe(2);

    await repo.setSkillEnabled(agent.id, skillB.id, true);
    current = await repo.getById(workspaceId, agent.id);
    expect(current!.version).toBe(3);

    await repo.setSkills(agent.id, [skillB.id, skillA.id]);
    current = await repo.getById(workspaceId, agent.id);
    expect(current!.version).toBe(4);

    await repo.unlinkSkill(agent.id, skillB.id);
    current = await repo.getById(workspaceId, agent.id);
    expect(current!.version).toBe(5);

    const versions = await repo.listVersions(agent.id);
    // v1 (insert) + one snapshot per mutation above (2,3,4,5).
    expect(versions.map((v) => v.version).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    // Each skill-link snapshot captures the linked skill ids at that point.
    const v5 = versions.find((v) => v.version === 5)!;
    expect((v5.configJson as { skills: string[] }).skills).toEqual([skillA.id]);
  });

  it(
    'skills_count counts only links where BOTH the link and the skill itself are enabled',
    async () => {
      const { db } = pg.handle;
      const repo = new AgentsRepository(db);
      const agent1 = await makeAgent(repo, 'Skills Count Agent 1');
      const agent2 = await makeAgent(repo, 'Skills Count Agent 2');

      const enabledSkill = await makeSkill(db, 'globally-enabled', true);
      const disabledSkill = await makeSkill(db, 'globally-disabled', false);

      // agent1: link enabled to enabled skill (counts), disabled to disabled skill
      // (doesn't count — skill itself is off).
      await repo.setSkillEnabled(agent1.id, enabledSkill.id, true);
      await repo.setSkillEnabled(agent1.id, disabledSkill.id, true);

      // agent2: link the enabled skill, but the LINK itself is off — doesn't count.
      await repo.setSkillEnabled(agent2.id, enabledSkill.id, false);

      const counts = await repo.skillsCountByAgentIds([agent1.id, agent2.id]);
      expect(counts.get(agent1.id)).toBe(1);
      expect(counts.get(agent2.id) ?? 0).toBe(0);
    },
  );

  it('service.list / service.get surface skills_count on the Agent DTO', async () => {
    const { db } = pg.handle;
    const repo = new AgentsRepository(db);
    const service = new AgentsService({ db } as unknown as Container);
    const agent = await makeAgent(repo, 'DTO Skills Count');
    const skill = await makeSkill(db, 'dto-skill', true);

    expect((await service.get(workspaceId, agent.id))!.skills_count).toBe(0);

    await repo.setSkillEnabled(agent.id, skill.id, true);

    const fromGet = await service.get(workspaceId, agent.id);
    expect(fromGet!.skills_count).toBe(1);

    const list = await service.list(workspaceId);
    const fromList = list.find((a) => a.id === agent.id);
    expect(fromList!.skills_count).toBe(1);
  });

  it('PATCH /agents/:id/skills/:skillId attaches+enables, then GET reflects skills_count', async () => {
    const app = await makeApp();
    const created = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: 'Route Skills Count',
        provider: 'openai',
        model: 'gpt-4o-mini',
        system_prompt: 'Review.',
      },
    });
    const agentId = created.json().id as string;
    const skill = await makeSkill(pg.handle.db, 'route-skill', true);

    const patched = await app.inject({
      method: 'PATCH',
      url: `/agents/${agentId}/skills/${skill.id}`,
      payload: { enabled: true },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toEqual([
      { agent_id: agentId, skill_id: skill.id, order: 0, enabled: true },
    ]);

    const got = await app.inject({ method: 'GET', url: `/agents/${agentId}` });
    expect(got.json().skills_count).toBe(1);

    // Uncheck — row persists, skills_count drops back to 0.
    const unpatched = await app.inject({
      method: 'PATCH',
      url: `/agents/${agentId}/skills/${skill.id}`,
      payload: { enabled: false },
    });
    expect(unpatched.statusCode).toBe(200);
    const gotAfter = await app.inject({ method: 'GET', url: `/agents/${agentId}` });
    expect(gotAfter.json().skills_count).toBe(0);

    await app.close();
  });

  it('PATCH /agents/:id/skills/:skillId 404s for an agent outside the workspace', async () => {
    const app = await makeApp();
    const { db } = pg.handle;
    const [otherWs] = await db.insert(t.workspaces).values({ name: 'other-skills' }).returning();
    const repo = new AgentsRepository(db);
    const foreign = await repo.insert({
      workspaceId: otherWs!.id,
      name: 'Foreign Agent',
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'x',
    });
    const skill = await makeSkill(db, 'foreign-skill', true);

    const res = await app.inject({
      method: 'PATCH',
      url: `/agents/${foreign.id}/skills/${skill.id}`,
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('rejects a non-boolean enabled body with 422', async () => {
    const app = await makeApp();
    const created = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: 'Bad Body Agent',
        provider: 'openai',
        model: 'gpt-4o-mini',
        system_prompt: 'Review.',
      },
    });
    const agentId = created.json().id as string;
    const skill = await makeSkill(pg.handle.db, 'bad-body-skill', true);

    const res = await app.inject({
      method: 'PATCH',
      url: `/agents/${agentId}/skills/${skill.id}`,
      payload: { enabled: 'yes' },
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });
});
