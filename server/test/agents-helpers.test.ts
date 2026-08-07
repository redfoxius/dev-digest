import { describe, it, expect } from 'vitest';
import { toAgentDto } from '../src/modules/agents/helpers.js';
import type { AgentRow } from '../src/modules/agents/repository.js';

/**
 * Unit coverage for `toAgentDto`'s `skills_count` threading. The count itself
 * is computed by the repository's `skillsCountByAgentIds` (one grouped query
 * per batch — see `agents-skills.it.test.ts` for that DB-backed behavior);
 * this file only covers the pure row -> DTO mapping.
 */

function row(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    id: 'agent-1',
    workspaceId: 'ws-1',
    name: 'Test Agent',
    description: '',
    provider: 'openai',
    model: 'gpt-4o-mini',
    systemPrompt: 'Review the diff.',
    outputSchema: null,
    strategy: 'single-pass',
    ciFailOn: 'critical',
    repoIntel: true,
    enabled: true,
    version: 1,
    createdBy: null,
    createdAt: new Date('2026-06-11T00:00:00.000Z'),
    ...overrides,
  } as AgentRow;
}

describe('toAgentDto', () => {
  it('defaults skills_count to 0 when the caller omits it (e.g. a fresh agent)', () => {
    const dto = toAgentDto(row());
    expect(dto.skills_count).toBe(0);
  });

  it('threads through the caller-supplied skills_count unchanged', () => {
    const dto = toAgentDto(row(), 3);
    expect(dto.skills_count).toBe(3);
  });

  it('does not derive skills_count from anything on the row itself', () => {
    // Same row, different counts — proves the row has no bearing on the count;
    // it must come from the repository's grouped query, passed in by the caller.
    const a = toAgentDto(row({ id: 'agent-1' }), 0);
    const b = toAgentDto(row({ id: 'agent-1' }), 5);
    expect(a.skills_count).toBe(0);
    expect(b.skills_count).toBe(5);
  });
});
