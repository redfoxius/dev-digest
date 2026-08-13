import { describe, it, expect } from 'vitest';
import type { Finding } from '@devdigest/shared';
import { filterByScope } from '../src/index.js';

/**
 * filterByScope must never make an out-of-scope finding disappear — only
 * soften it by one severity rank. `in_scope` is derived from
 * attacker-controlled PR content by a cheap LLM classifier; an unconditional
 * drop would let a crafted PR description erase a genuine finding outright.
 */

function finding(overrides: Partial<Finding>): Finding {
  return {
    id: 'f1',
    severity: 'WARNING',
    category: 'bug',
    title: 'a finding',
    file: 'src/x.ts',
    start_line: 1,
    end_line: 1,
    rationale: 'because',
    confidence: 0.9,
    kind: 'finding',
    ...overrides,
  } as Finding;
}

describe('filterByScope', () => {
  it('keeps in-scope findings untouched', () => {
    const f = finding({ in_scope: true, severity: 'CRITICAL' });
    const { kept, downgraded } = filterByScope([f]);
    expect(kept).toEqual([f]);
    expect(downgraded).toHaveLength(0);
  });

  it('keeps every out-of-scope finding, softened one severity rank, instead of dropping it', () => {
    const findings = [
      finding({ id: 'a', in_scope: false, severity: 'CRITICAL' }),
      finding({ id: 'b', in_scope: false, severity: 'WARNING' }),
      finding({ id: 'c', in_scope: false, severity: 'SUGGESTION' }),
    ];
    const { kept, downgraded } = filterByScope(findings);

    expect(kept).toHaveLength(3);
    expect(downgraded).toHaveLength(3);
    expect(kept.find((f) => f.id === 'a')!.severity).toBe('WARNING');
    expect(kept.find((f) => f.id === 'b')!.severity).toBe('SUGGESTION');
    expect(kept.find((f) => f.id === 'c')!.severity).toBe('SUGGESTION'); // floored, not dropped
  });

  it('never drops a finding regardless of how many are out of scope', () => {
    const findings = Array.from({ length: 5 }, (_, i) =>
      finding({ id: `f${i}`, in_scope: false, severity: 'CRITICAL' }),
    );
    const { kept } = filterByScope(findings);
    expect(kept).toHaveLength(5);
  });

  it('always passes through safety-critical kinds regardless of declared scope', () => {
    const secret = finding({ id: 'secret', in_scope: false, kind: 'secret_leak', severity: 'CRITICAL' });
    const { kept, downgraded } = filterByScope([secret]);
    expect(kept).toEqual([secret]); // untouched — not even downgraded
    expect(downgraded).toHaveLength(0);
  });
});
