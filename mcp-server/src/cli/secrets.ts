import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Minimal read-only mirror of `server/src/adapters/secrets/local.ts`'s
 * `LocalSecretsProvider.get()`: stored overrides in `~/.devdigest/secrets.json`
 * win, falling back to `process.env`. Not an import of that class — it lives
 * outside this package's narrow reviewer-core/shared alias allowlist (see
 * docs/cli-working-review-plan.md) and this CLI never needs its `set()` half.
 */
export async function readSecret(key: string): Promise<string | undefined> {
  const path = join(homedir(), '.devdigest', 'secrets.json');
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    const stored = parsed && typeof parsed === 'object' ? parsed[key] : undefined;
    if (typeof stored === 'string' && stored) return stored;
  } catch {
    // Missing or unreadable file → no stored overrides.
  }
  return process.env[key];
}
