/**
 * smart-diff constants. Phase-tagged like `repo-intel/constants.ts`'s
 * [T1]/[T2] convention: [Phase1] used now (classifier), [Phase2] exported
 * early for the not-yet-implemented route.
 */
import { EXCLUDED_DIRS } from '../repo-intel/constants.js';

// --- [Phase1] Wiring patterns ------------------------------------------------
// Exact basenames spanning every language repo-intel already indexes, not
// just JS/TS — bootstrap/entrypoint/config files, not business logic.
export const WIRING_BASENAME_PATTERNS = [
  // JS/TS
  'index.ts',
  'index.tsx',
  'index.js',
  'index.jsx',
  'server.ts',
  'server.js',
  'app.ts',
  'app.js',
  'main.ts',
  'main.js',
  'config.ts',
  'config.js',
  'container.ts',
  'di.ts',
  // Go
  'main.go',
  // Rust
  'main.rs',
  'mod.rs',
  // Python (Django/WSGI/ASGI entrypoints)
  '__init__.py',
  'manage.py',
  'wsgi.py',
  'asgi.py',
  'settings.py',
] as const;

/** [Phase1] Generic "*.config.*" shape a basename list can't enumerate. */
export const WIRING_SUBSTRING_PATTERNS = ['.config.'] as const;

// --- [Phase1] Boilerplate patterns -------------------------------------------
/** [Phase1] Lockfiles across every package manager repo-intel touches. */
export const BOILERPLATE_BASENAME_PATTERNS = [
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'Cargo.lock',
  'Gemfile.lock',
  'poetry.lock',
  'Pipfile.lock',
  'composer.lock',
  'go.sum',
] as const;

/**
 * [Phase1] Reuses `EXCLUDED_DIRS` from `repo-intel/constants.ts` as the base
 * list (imported, not re-typed by hand) — `vendor/` in particular is exactly
 * Go's own boilerplate-dependency-snapshot directory, so this reuse buys Go
 * coverage for free. On top of that base: smart-diff-only directories the
 * repo-intel walk excludes for other reasons but which are also relevant
 * here, plus language-agnostic generated/minified/snapshot file patterns.
 */
export const BOILERPLATE_SUBSTRING_PATTERNS = [
  ...EXCLUDED_DIRS.map((dir) => `/${dir}/`),
  '/target/', // Rust build output
  '/__pycache__/',
  '/.venv/',
  '/venv/',
  '.egg-info/',
  '.min.js',
  '.min.css',
  '.map',
  '.snap',
  '__snapshots__/',
  '.generated.',
  '.pb.go', // generated Go protobuf
] as const;

// --- [Phase1] Size-escalation ------------------------------------------------
/**
 * [Phase1] A file matching a `wiring` pattern whose diff (additions +
 * deletions) exceeds this threshold is promoted to `core` — a "config" file
 * with a suspiciously large diff usually hides real logic. `boilerplate`
 * patterns are never escalated regardless of size.
 *
 * Untested starting guess, not a user-confirmed figure — only the mechanism
 * (escalate past some threshold) was confirmed; easy to retune once real PRs
 * are seen.
 */
export const WIRING_ESCALATION_LINE_THRESHOLD = 50;

// --- [Phase2] Split suggestion ------------------------------------------------
/**
 * [Phase2] Total diff size (additions + deletions summed across every changed
 * file) above which `SmartDiff.split_suggestion.too_big` is true.
 *
 * Untested starting guess, not a user-confirmed figure — same framing as
 * `WIRING_ESCALATION_LINE_THRESHOLD` above; easy to retune once real PRs are
 * seen. Only decides whether to show the "this PR is large" banner —
 * proposing HOW to split (`proposed_splits`) is real import-graph clustering,
 * deferred to Phase 6.
 */
export const SPLIT_SUGGESTION_TOO_BIG_LINE_THRESHOLD = 500;
