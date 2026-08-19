import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Review, UnifiedDiff } from '@devdigest/shared';
import { RunBus } from '../src/platform/sse.js';
import { RunLogger } from '../src/platform/run-logger.js';

/**
 * Agent Skills wiring (docs/skills-feature-plan.md, "run-executor.ts wiring —
 * the critical missing link"): `runOneAgent` must resolve an agent's linked
 * skills (filtered on BOTH the per-link `enabled` AND the skill's own global
 * `enabled`) and thread the resolved bodies into `reviewPullRequest`. Before
 * this wiring, linked skills were silently never injected into the prompt no
 * matter how they were configured in the Agent Editor.
 *
 * `reviewPullRequest` is mocked so this stays a pure unit test of the
 * resolution/threading logic — no LLM, no DB, no repo-intel.
 */

const reviewPullRequest = vi.fn();
const countBlockers = vi.fn(() => 0);

vi.mock('@devdigest/reviewer-core', () => ({
  reviewPullRequest: (...args: unknown[]) => reviewPullRequest(...args),
  countBlockers: (...args: unknown[]) => countBlockers(...args),
}));

/**
 * Project Context Folder (docs/project-context-folder-plan.md Work Item
 * 10-11) — `resolveContextDocs` is mocked at the module boundary so this
 * stays a pure unit test of run-executor's wiring/threading logic (task
 * framing, `specs` omit-when-empty, `RunTrace.specs_read`), not of
 * `resolveContextDocs`'s own fs-read/dedupe/truncation behavior — that's
 * already covered end-to-end by `test/context-docs-resolve.test.ts`.
 */
const resolveContextDocs = vi.fn();
vi.mock('../src/modules/context-docs/resolve.js', () => ({
  resolveContextDocs: (...args: unknown[]) => resolveContextDocs(...args),
}));

// Default: no context docs resolved, for every test in this file (including
// the pre-existing Agent Skills suite below, which doesn't care about this
// feature) — individual tests below override via `mockResolvedValue`.
beforeEach(() => {
  resolveContextDocs.mockReset().mockResolvedValue({ specs: [], specsRead: [], warnings: [] });
});

const { ReviewRunExecutor } = await import('../src/modules/reviews/run-executor.js');

const FIXED_REVIEW: Review = {
  verdict: 'approve',
  summary: 'Looks fine.',
  score: 100,
  findings: [],
};

function makeOutcome() {
  return {
    review: FIXED_REVIEW,
    grounding: '0/0 passed',
    dropped: [],
    mode: 'single-pass' as const,
    assembly: { system: 'sys', skills: null, memory: null, specs: null, user: 'u' },
    chunks: [{ label: 'whole diff' }],
    tokensIn: 10,
    tokensOut: 5,
    costUsd: 0.001,
    raw: 'raw',
  };
}

const DIFF = { files: [{ path: 'src/index.ts', additions: 1, deletions: 0, hunks: [] }] } as unknown as UnifiedDiff;

function linkedSkillRow(body: string, order: number, linkEnabled: boolean, skillEnabled: boolean) {
  return {
    skill: { id: `skill-${order}`, body, enabled: skillEnabled },
    order,
    enabled: linkEnabled,
  } as never;
}

describe('ReviewRunExecutor — Agent Skills resolution', () => {
  let linkedSkills: ReturnType<typeof vi.fn>;
  let repo: {
    insertReview: ReturnType<typeof vi.fn>;
    insertFindings: ReturnType<typeof vi.fn>;
    completeAgentRun: ReturnType<typeof vi.fn>;
    saveRunTrace: ReturnType<typeof vi.fn>;
    recordRunSkills: ReturnType<typeof vi.fn>;
  };
  let agents: { linkedSkills: ReturnType<typeof vi.fn> };
  let container: { runBus: RunBus; llm: ReturnType<typeof vi.fn> };
  let executor: InstanceType<typeof ReviewRunExecutor>;
  let runId: string;
  let seq = 0;

  const pull = { id: 'pr-1', number: 42, title: 'Fix things', author: 'octo', repoId: 'repo-1', base: 'main', headSha: 'sha1', body: null } as never;
  const repoRow = { owner: 'acme', name: 'widgets' } as never;

  function agentFixture() {
    return {
      id: 'agent-1',
      name: 'Test Agent',
      provider: 'openai',
      model: 'gpt-4.1',
      systemPrompt: 'You are a reviewer.',
      strategy: 'single-pass',
      ciFailOn: 'critical',
      // Skip repo-intel enrichment entirely — irrelevant to skills resolution
      // and keeps this a pure unit test (no repoIntel mock needed).
      repoIntel: false,
      version: 1,
    } as never;
  }

  beforeEach(() => {
    reviewPullRequest.mockReset();
    countBlockers.mockReset().mockReturnValue(0);
    reviewPullRequest.mockResolvedValue(makeOutcome());

    linkedSkills = vi.fn();
    agents = { linkedSkills };
    repo = {
      insertReview: vi.fn().mockResolvedValue({ id: 'review-1' }),
      insertFindings: vi.fn().mockResolvedValue([]),
      completeAgentRun: vi.fn().mockResolvedValue(undefined),
      saveRunTrace: vi.fn().mockResolvedValue(undefined),
      recordRunSkills: vi.fn().mockResolvedValue(undefined),
    };
    container = {
      runBus: new RunBus(),
      llm: vi.fn().mockResolvedValue({}),
      // Minimal AppConfig stub — this suite predates any code path reading
      // container.config; only the fields actually read by run-executor.ts
      // need to be present.
      config: { promptAssemblyDebug: false },
    };
    executor = new (ReviewRunExecutor as unknown as new (
      container: unknown,
      repo: unknown,
      agents: unknown,
    ) => InstanceType<typeof ReviewRunExecutor>)(container, repo, agents);
    runId = `run-${seq++}`;
  });

  async function runOneAgent(agent: unknown) {
    const parentLog = new RunLogger(container.runBus, [runId]);
    return (executor as unknown as { runOneAgent: (...a: unknown[]) => Promise<unknown> }).runOneAgent(
      'ws-1',
      pull,
      repoRow,
      DIFF,
      agent,
      runId,
      parentLog,
    );
  }

  it('resolves linked+enabled skill bodies, in `order`, filtering out a disabled link', async () => {
    linkedSkills.mockResolvedValue([
      linkedSkillRow('BODY-1', 0, true, true),
      linkedSkillRow('BODY-DISABLED-LINK', 1, false, true), // link disabled → excluded
      linkedSkillRow('BODY-2', 2, true, true),
    ]);

    await runOneAgent(agentFixture());

    expect(linkedSkills).toHaveBeenCalledWith('agent-1');
    const call = reviewPullRequest.mock.calls[0]![0] as { skills?: string[] };
    expect(call.skills).toEqual(['BODY-1', 'BODY-2']);
  });

  it('excludes a globally-disabled skill even when its link is enabled', async () => {
    linkedSkills.mockResolvedValue([
      linkedSkillRow('BODY-1', 0, true, true),
      linkedSkillRow('BODY-UNVETTED', 1, true, false), // skill.enabled: false → excluded
    ]);

    await runOneAgent(agentFixture());

    const call = reviewPullRequest.mock.calls[0]![0] as { skills?: string[] };
    expect(call.skills).toEqual(['BODY-1']);
  });

  it('logs "skills: N attached" matching the repo map / callers digest log convention', async () => {
    linkedSkills.mockResolvedValue([linkedSkillRow('BODY-1', 0, true, true), linkedSkillRow('BODY-2', 1, true, true)]);

    await runOneAgent(agentFixture());

    const messages = container.runBus.buffer(runId).map((e) => e.msg);
    expect(messages).toContain('skills: 2 attached');
  });

  it('records the resolved skill ids for the Stats tab (agent_run_skills), excluding disabled links/skills', async () => {
    linkedSkills.mockResolvedValue([
      linkedSkillRow('BODY-1', 0, true, true),
      linkedSkillRow('BODY-DISABLED-LINK', 1, false, true),
      linkedSkillRow('BODY-2', 2, true, true),
    ]);

    await runOneAgent(agentFixture());

    expect(repo.recordRunSkills).toHaveBeenCalledWith(runId, ['skill-0', 'skill-2']);
  });

  it('does not call recordRunSkills when nothing resolves', async () => {
    linkedSkills.mockResolvedValue([]);

    await runOneAgent(agentFixture());

    expect(repo.recordRunSkills).not.toHaveBeenCalled();
  });

  it('omits the `skills` key entirely (not an empty array) when nothing resolves', async () => {
    linkedSkills.mockResolvedValue([]);

    await runOneAgent(agentFixture());

    const call = reviewPullRequest.mock.calls[0]![0] as Record<string, unknown>;
    expect(call).not.toHaveProperty('skills');
    const messages = container.runBus.buffer(runId).map((e) => e.msg);
    expect(messages.some((m) => m.startsWith('skills:'))).toBe(false);
  });

  it('failure-path trace reflects the resolved skills instead of hardcoded null', async () => {
    linkedSkills.mockResolvedValue([linkedSkillRow('BODY-1', 0, true, true), linkedSkillRow('BODY-2', 1, true, true)]);
    reviewPullRequest.mockRejectedValue(new Error('LLM exploded'));

    await expect(runOneAgent(agentFixture())).rejects.toThrow('LLM exploded');

    expect(repo.saveRunTrace).toHaveBeenCalledTimes(1);
    const trace = repo.saveRunTrace.mock.calls[0]![1] as { prompt_assembly: { skills: string | null } };
    expect(trace.prompt_assembly.skills).toBe('BODY-1\n\nBODY-2');
  });

  it('failure-path trace has `skills: null` (not resolved bodies) when nothing resolved', async () => {
    linkedSkills.mockResolvedValue([]);
    reviewPullRequest.mockRejectedValue(new Error('LLM exploded'));

    await expect(runOneAgent(agentFixture())).rejects.toThrow('LLM exploded');

    const trace = repo.saveRunTrace.mock.calls[0]![1] as { prompt_assembly: { skills: string | null } };
    expect(trace.prompt_assembly.skills).toBeNull();
  });
});

/**
 * Project Context Folder (spec §6.7, docs/project-context-folder-plan.md
 * Work Item 10-11, AC-12/AC-26–AC-33/AC-39) — `resolveContextDocs` itself
 * (fs reads, dedupe, truncation) is covered by
 * `test/context-docs-resolve.test.ts`; this suite covers only what
 * `run-executor.ts` does with its result: threading `specs` into
 * `reviewPullRequest`'s input (omit-when-empty), appending the citation-
 * framing sentence to `task` iff something resolved, and populating
 * `RunTrace.specs_read` on both the success and failure paths.
 */
describe('ReviewRunExecutor — Project Context Folder resolution', () => {
  let repo: {
    insertReview: ReturnType<typeof vi.fn>;
    insertFindings: ReturnType<typeof vi.fn>;
    completeAgentRun: ReturnType<typeof vi.fn>;
    saveRunTrace: ReturnType<typeof vi.fn>;
    recordRunSkills: ReturnType<typeof vi.fn>;
  };
  let agents: { linkedSkills: ReturnType<typeof vi.fn> };
  let container: { runBus: RunBus; llm: ReturnType<typeof vi.fn>; config: { promptAssemblyDebug: boolean } };
  let executor: InstanceType<typeof ReviewRunExecutor>;
  let runId: string;
  let seq = 0;

  const pull = { id: 'pr-1', number: 42, title: 'Fix things', author: 'octo', repoId: 'repo-1', base: 'main', headSha: 'sha1', body: null } as never;
  const repoRow = { id: 'repo-1', owner: 'acme', name: 'widgets', clonePath: '/fake/clone' } as never;

  function agentFixture() {
    return {
      id: 'agent-1',
      name: 'Test Agent',
      provider: 'openai',
      model: 'gpt-4.1',
      systemPrompt: 'You are a reviewer.',
      strategy: 'single-pass',
      ciFailOn: 'critical',
      repoIntel: false,
      version: 1,
    } as never;
  }

  beforeEach(() => {
    reviewPullRequest.mockReset();
    countBlockers.mockReset().mockReturnValue(0);
    reviewPullRequest.mockResolvedValue(makeOutcome());

    agents = { linkedSkills: vi.fn().mockResolvedValue([]) };
    repo = {
      insertReview: vi.fn().mockResolvedValue({ id: 'review-1' }),
      insertFindings: vi.fn().mockResolvedValue([]),
      completeAgentRun: vi.fn().mockResolvedValue(undefined),
      saveRunTrace: vi.fn().mockResolvedValue(undefined),
      recordRunSkills: vi.fn().mockResolvedValue(undefined),
    };
    container = {
      runBus: new RunBus(),
      llm: vi.fn().mockResolvedValue({}),
      config: { promptAssemblyDebug: false },
    };
    executor = new (ReviewRunExecutor as unknown as new (
      container: unknown,
      repo: unknown,
      agents: unknown,
    ) => InstanceType<typeof ReviewRunExecutor>)(container, repo, agents);
    runId = `run-${seq++}`;
  });

  async function runOneAgent(agent: unknown) {
    const parentLog = new RunLogger(container.runBus, [runId]);
    return (executor as unknown as { runOneAgent: (...a: unknown[]) => Promise<unknown> }).runOneAgent(
      'ws-1',
      pull,
      repoRow,
      DIFF,
      agent,
      runId,
      parentLog,
    );
  }

  it('includes the citation-framing sentence in `task` when at least one context doc resolves', async () => {
    resolveContextDocs.mockResolvedValue({
      specs: ['### specs/a.md\n\nRule A'],
      specsRead: ['specs/a.md'],
      warnings: [],
    });

    await runOneAgent(agentFixture());

    const call = reviewPullRequest.mock.calls[0]![0] as { task: string };
    expect(call.task).toContain(
      'When a finding is grounded in a rule stated by one of the attached project-context documents below, cite that document by its filename (e.g. "architecture-invariants.md") in the finding\'s rationale.',
    );
  });

  it('omits the citation-framing sentence from `task` when nothing resolves', async () => {
    resolveContextDocs.mockResolvedValue({ specs: [], specsRead: [], warnings: [] });

    await runOneAgent(agentFixture());

    const call = reviewPullRequest.mock.calls[0]![0] as { task: string };
    expect(call.task).not.toContain('attached project-context documents');
  });

  it('omits the `specs` key entirely (not an empty array) when nothing resolves', async () => {
    resolveContextDocs.mockResolvedValue({ specs: [], specsRead: [], warnings: [] });

    await runOneAgent(agentFixture());

    const call = reviewPullRequest.mock.calls[0]![0] as Record<string, unknown>;
    expect(call).not.toHaveProperty('specs');
  });

  it("threads resolved specs through to reviewPullRequest's `specs` key", async () => {
    resolveContextDocs.mockResolvedValue({
      specs: ['### specs/a.md\n\nRule A', '### specs/b.md\n\nRule B'],
      specsRead: ['specs/a.md', 'specs/b.md'],
      warnings: [],
    });

    await runOneAgent(agentFixture());

    const call = reviewPullRequest.mock.calls[0]![0] as { specs?: string[] };
    expect(call.specs).toEqual(['### specs/a.md\n\nRule A', '### specs/b.md\n\nRule B']);
  });

  it('populates the saved RunTrace.specs_read with exactly the resolved paths on success', async () => {
    resolveContextDocs.mockResolvedValue({
      specs: ['### specs/a.md\n\nRule A'],
      specsRead: ['specs/a.md'],
      warnings: [],
    });

    await runOneAgent(agentFixture());

    expect(repo.saveRunTrace).toHaveBeenCalledTimes(1);
    const trace = repo.saveRunTrace.mock.calls[0]![1] as { specs_read: string[] };
    expect(trace.specs_read).toEqual(['specs/a.md']);
  });

  it('failure-path trace reflects the resolved specs_read (and prompt_assembly.specs) instead of empty/null', async () => {
    resolveContextDocs.mockResolvedValue({
      specs: ['### specs/a.md\n\nRule A'],
      specsRead: ['specs/a.md'],
      warnings: [],
    });
    reviewPullRequest.mockRejectedValue(new Error('LLM exploded'));

    await expect(runOneAgent(agentFixture())).rejects.toThrow('LLM exploded');

    expect(repo.saveRunTrace).toHaveBeenCalledTimes(1);
    const trace = repo.saveRunTrace.mock.calls[0]![1] as {
      specs_read: string[];
      prompt_assembly: { specs: string | null };
    };
    expect(trace.specs_read).toEqual(['specs/a.md']);
    expect(trace.prompt_assembly.specs).toBe('specs/a.md');
  });

  it('failure-path trace has `specs_read: []` / `prompt_assembly.specs: null` when nothing resolved before the failure', async () => {
    resolveContextDocs.mockResolvedValue({ specs: [], specsRead: [], warnings: [] });
    reviewPullRequest.mockRejectedValue(new Error('LLM exploded'));

    await expect(runOneAgent(agentFixture())).rejects.toThrow('LLM exploded');

    const trace = repo.saveRunTrace.mock.calls[0]![1] as {
      specs_read: string[];
      prompt_assembly: { specs: string | null };
    };
    expect(trace.specs_read).toEqual([]);
    expect(trace.prompt_assembly.specs).toBeNull();
  });

  it('AC-12 regression: a run against an agent with never-indexed/embedded context docs still succeeds, injects the resolved specs, and never touches an embedding path', async () => {
    // Stands in for the chunk/embedding mechanism (AC-12): resolveContextDocs
    // itself is proven never to call this in test/context-docs-resolve.test.ts;
    // here we additionally confirm run-executor's own wiring never reaches for
    // it either — the resolved specs come solely from the mocked function's
    // return value, never a fallback embed/re-index path.
    const embedderSpy = vi.fn();
    (container as unknown as { embedder: typeof embedderSpy }).embedder = embedderSpy;
    resolveContextDocs.mockResolvedValue({
      specs: ['### specs/never-indexed.md\n\nThis document was never chunked or embedded.'],
      specsRead: ['specs/never-indexed.md'],
      warnings: [],
    });

    const outcome = (await runOneAgent(agentFixture())) as { review: unknown };

    expect(outcome.review).toBeDefined();
    const call = reviewPullRequest.mock.calls[0]![0] as { specs?: string[] };
    expect(call.specs).toEqual(['### specs/never-indexed.md\n\nThis document was never chunked or embedded.']);
    expect(embedderSpy).not.toHaveBeenCalled();
  });

  it('AC-39 regression: resolved spec content never leaks into `task`/`systemPrompt` — only the static citation sentence does, specs travel solely via the `specs` key', async () => {
    const specBody = '### specs/secret-rule.md\n\nUNIQUE_MARKER_TEXT_1234';
    resolveContextDocs.mockResolvedValue({
      specs: [specBody],
      specsRead: ['specs/secret-rule.md'],
      warnings: [],
    });

    await runOneAgent(agentFixture());

    const call = reviewPullRequest.mock.calls[0]![0] as { task: string; systemPrompt: string; specs?: string[] };
    expect(call.task).not.toContain('UNIQUE_MARKER_TEXT_1234');
    expect(call.systemPrompt).not.toContain('UNIQUE_MARKER_TEXT_1234');
    expect(call.specs).toEqual([specBody]);
  });
});
