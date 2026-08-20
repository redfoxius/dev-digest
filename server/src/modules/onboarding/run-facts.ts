import { z } from 'zod';

/**
 * Run-facts extraction (docs/onboarding-generator-plan.md Work Item 4,
 * spec §6.3 AC-12/AC-13/AC-34) — a PURE, deterministic (non-LLM) function
 * that detects "how to run this repo" signals: `package.json`'s package
 * manager hint + `scripts` keys, and presence-only booleans for
 * `.env.example`/`.env.sample`/`Dockerfile`/`docker-compose.yml`. Carries
 * file/script NAMES only — never `.env*` file CONTENT (AC-34) and never an
 * invented command not backed by one of these sources (AC-13). Mirrors this
 * repo's established "algorithm as a pure function, service does
 * fetch-then-delegate" split (`server/INSIGHTS.md`, 2026-08-09 entry,
 * `repo-intel/pipeline/rank.ts`) — the service-side caller fetches each file
 * via `container.repoIntel.getFileContent(repoId, path)` and passes the raw
 * text (or `null` when absent) in here.
 */

export interface RunFactsInput {
  packageJson: string | null;
  envExample: string | null;
  envSample: string | null;
  dockerfile: string | null;
  dockerCompose: string | null;
}

export interface RunFacts {
  /** Package manager NAME only (e.g. "pnpm"), derived from `package.json`'s
   *  `packageManager` field (`"pnpm@10.0.0"` → `"pnpm"`) — null when absent/
   *  unparseable. */
  packageManager: string | null;
  /** `package.json`'s `scripts` KEYS only — never a script's command value. */
  scripts: string[];
  hasEnvExample: boolean;
  hasEnvSample: boolean;
  hasDockerfile: boolean;
  hasDockerCompose: boolean;
  /** False only when literally none of the above sources yielded anything —
   *  the honest "no run facts detected" signal the prompt must state
   *  plainly instead of inventing a command (AC-13). */
  detected: boolean;
}

/**
 * `package.json`'s own structured-output-adjacent shape — repo-controlled,
 * potentially-adversarial content (spec §11), so it's validated via a zod
 * schema, not trusted as already-shaped. `.passthrough()` because every
 * other real `package.json` field is irrelevant here and must not fail
 * validation just for being present.
 */
const PackageJsonShape = z
  .object({
    scripts: z.record(z.string()).optional(),
    packageManager: z.string().optional(),
  })
  .passthrough();

/**
 * Wraps BOTH `JSON.parse` (which throws a raw `SyntaxError` on malformed/
 * truncated JSON text) and the zod schema check (which returns
 * `success: false`, never throws, on a wrong-shaped `scripts`/
 * `packageManager`) in a single try/catch — both failure modes are treated
 * identically as "absent", never a crash (AC-13's honest-empty-signal path).
 */
function safeParsePackageJson(raw: string | null): { scripts: string[]; packageManager: string | null } | null {
  if (raw == null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = PackageJsonShape.safeParse(parsed);
    if (!result.success) return null;
    const scripts = Object.keys(result.data.scripts ?? {});
    const packageManager = result.data.packageManager?.split('@')[0]?.trim() || null;
    return { scripts, packageManager };
  } catch {
    return null;
  }
}

/**
 * Deterministic textual rendering of `RunFacts` for the prompt's "how to
 * run" facts section — states only what was actually detected, and an
 * explicit "no run facts detected" line when nothing was (AC-13). Never
 * invents a command; every line traces directly to a `RunFacts` field.
 */
export function renderRunFactsText(facts: RunFacts): string {
  if (!facts.detected) {
    return (
      'No run-facts detected: no package.json scripts, .env.example/.env.sample, ' +
      'Dockerfile, or docker-compose.yml were found in this repo.'
    );
  }
  const lines: string[] = [];
  lines.push(`package manager: ${facts.packageManager ?? '(not declared in package.json)'}`);
  lines.push(facts.scripts.length > 0 ? `package.json scripts: ${facts.scripts.join(', ')}` : 'package.json scripts: (none)');
  lines.push(`.env.example present: ${facts.hasEnvExample ? 'yes' : 'no'}`);
  lines.push(`.env.sample present: ${facts.hasEnvSample ? 'yes' : 'no'}`);
  lines.push(`Dockerfile present: ${facts.hasDockerfile ? 'yes' : 'no'}`);
  lines.push(`docker-compose.yml present: ${facts.hasDockerCompose ? 'yes' : 'no'}`);
  return lines.join('\n');
}

export function parseRunFacts(files: RunFactsInput): RunFacts {
  const pkg = safeParsePackageJson(files.packageJson);
  const scripts = pkg?.scripts ?? [];
  const packageManager = pkg?.packageManager ?? null;
  const hasEnvExample = files.envExample != null;
  const hasEnvSample = files.envSample != null;
  const hasDockerfile = files.dockerfile != null;
  const hasDockerCompose = files.dockerCompose != null;

  const detected =
    scripts.length > 0 ||
    packageManager != null ||
    hasEnvExample ||
    hasEnvSample ||
    hasDockerfile ||
    hasDockerCompose;

  return {
    packageManager,
    scripts,
    hasEnvExample,
    hasEnvSample,
    hasDockerfile,
    hasDockerCompose,
    detected,
  };
}
