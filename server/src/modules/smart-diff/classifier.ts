import type { PrFile, SmartDiffRole } from '@devdigest/shared';
import {
  BOILERPLATE_BASENAME_PATTERNS,
  BOILERPLATE_SUBSTRING_PATTERNS,
  WIRING_BASENAME_PATTERNS,
  WIRING_ESCALATION_LINE_THRESHOLD,
  WIRING_SUBSTRING_PATTERNS,
} from './constants.js';

/** Last `/`-separated segment of a path. */
function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? path : path.slice(idx + 1);
}

/**
 * Deterministic, no-LLM classification of a changed file's review-risk role.
 * Mirrors the substring-match style already used by `isJunkPath`/
 * `JUNK_PATH_PATTERNS` in `repo-intel/service.ts` — lowercase, deterministic
 * substring/basename checks, no regex needed.
 *
 * 1. `boilerplate` if the basename or path matches any boilerplate pattern —
 *    checked first, never escalated.
 * 2. Else `wiring` if the basename or path matches any wiring pattern, unless
 *    `additions + deletions` exceeds the escalation threshold, in which case
 *    `core`.
 * 3. Else `core` (the default).
 */
export function classifyFile(
  file: Pick<PrFile, 'path' | 'additions' | 'deletions'>,
): SmartDiffRole {
  const path = file.path.toLowerCase();
  const base = basename(path);
  // Leading synthetic slash so a `/x/`-shaped directory pattern also matches
  // a top-level directory (e.g. `dist/bundle.js`, `vendor/foo.go`) — PR file
  // paths are repo-relative and never start with a real leading slash.
  const pathForSegmentMatch = `/${path}`;

  const isBoilerplate =
    BOILERPLATE_BASENAME_PATTERNS.some((p) => base === p.toLowerCase()) ||
    BOILERPLATE_SUBSTRING_PATTERNS.some((p) => pathForSegmentMatch.includes(p.toLowerCase()));
  if (isBoilerplate) return 'boilerplate';

  const isWiring =
    WIRING_BASENAME_PATTERNS.some((p) => base === p.toLowerCase()) ||
    WIRING_SUBSTRING_PATTERNS.some((p) => path.includes(p.toLowerCase()));
  if (isWiring) {
    const size = file.additions + file.deletions;
    return size > WIRING_ESCALATION_LINE_THRESHOLD ? 'core' : 'wiring';
  }

  return 'core';
}
