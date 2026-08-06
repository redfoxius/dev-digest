import type { CommunitySkill } from '@devdigest/shared';

/** Constants for the skills module. */

/** Initial config version recorded for a newly-created skill. */
export const INITIAL_SKILL_VERSION = 1;

/** Default skill description when none is supplied on insert. */
export const DEFAULT_SKILL_DESCRIPTION = '';

/**
 * Hard cap on an uploaded file/archive's size (bytes), also used as the
 * `@fastify/multipart` per-file limit and the URL-import fetch size guard.
 * Generous for a markdown skill package; small enough that in-memory
 * extraction (never streamed to disk) stays cheap.
 */
export const MAX_ARCHIVE_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Hard cap on an archive's total DECOMPRESSED size — `MAX_ARCHIVE_BYTES`
 * only bounds the compressed upload; without this a small crafted zip/gzip
 * (a decompression bomb) can expand to gigabytes in memory. Generous for a
 * markdown skill package with a few supporting docs; small enough to make
 * that class of attack pointless.
 */
export const MAX_DECOMPRESSED_BYTES = 20 * 1024 * 1024; // 20 MB

/** Extensions treated as "the whole file IS the skill body" (no extraction). */
export const ALLOWED_MARKDOWN_EXTENSIONS = ['.md', '.markdown'];

/** Extensions recognized as an in-memory-extractable archive. */
export const ARCHIVE_EXTENSIONS = ['.zip', '.tar.gz', '.tgz', '.tar'];

/**
 * Static curated seed for `GET /skills/community` +
 * `POST /skills/community/:name/import`. Course-scope demo data — NOT a live
 * registry fetch (see docs/skills-feature-plan.md, "Server: new `skills`
 * module"). Matches the design mockup's four entries exactly.
 */
export const COMMUNITY_SKILLS_SEED: CommunitySkill[] = [
  {
    name: 'owasp-top-10-review',
    repo: 'secdev/agent-skills',
    stars: 1240,
    lang: 'any',
    desc: 'Maps diff changes to the OWASP Top 10 with CWE references.',
  },
  {
    name: 'react-hooks-rules',
    repo: 'frontend-guild/skills',
    stars: 842,
    lang: 'TypeScript',
    desc: 'Detects conditional hooks, missing deps, stale closures.',
  },
  {
    name: 'sql-injection-gate',
    repo: 'secdev/agent-skills',
    stars: 690,
    lang: 'any',
    desc: 'Flags string-concatenated SQL and unparameterized queries.',
  },
  {
    name: 'a11y-jsx-audit',
    repo: 'a11y-collective/skills',
    stars: 318,
    lang: 'TypeScript',
    desc: 'Checks JSX for missing alt text, ARIA, and focus traps.',
  },
];
