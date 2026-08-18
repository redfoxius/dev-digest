import { describe, it, expect } from 'vitest';
import type { Finding } from '@devdigest/shared';
import { exitCodeForFindings, EXIT_OK, EXIT_BLOCKING_FINDINGS } from '../../src/cli/output.js';

function finding(severity: Finding['severity']): Finding {
  return {
    id: `f-${severity}`,
    severity,
    category: 'bug',
    title: 'x',
    file: 'a.ts',
    start_line: 1,
    end_line: 1,
    rationale: 'r',
    confidence: 0.9,
    kind: 'finding',
  } as Finding;
}

describe('cli/output exitCodeForFindings', () => {
  it('is EXIT_OK with no findings', () => {
    expect(exitCodeForFindings([])).toBe(EXIT_OK);
  });

  it('is EXIT_OK when only WARNING/SUGGESTION findings exist', () => {
    expect(exitCodeForFindings([finding('WARNING'), finding('SUGGESTION')])).toBe(EXIT_OK);
  });

  it('is EXIT_BLOCKING_FINDINGS when a CRITICAL finding exists (same gate as toReviewPayload)', () => {
    expect(exitCodeForFindings([finding('WARNING'), finding('CRITICAL')])).toBe(EXIT_BLOCKING_FINDINGS);
  });
});
