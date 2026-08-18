import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// readSecret hardcodes `homedir()/.devdigest/secrets.json` — redirect HOME to a
// throwaway temp dir per test so no real secrets file is ever touched.
let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'devdigest-secrets-test-'));
  vi.stubEnv('HOME', home);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

describe('cli/secrets readSecret', () => {
  it('prefers a stored value over env', async () => {
    vi.resetModules();
    await mkdir(join(home, '.devdigest'), { recursive: true });
    await writeFile(join(home, '.devdigest', 'secrets.json'), JSON.stringify({ OPENROUTER_API_KEY: 'stored-key' }));
    vi.stubEnv('OPENROUTER_API_KEY', 'env-key');

    const { readSecret } = await import('../../src/cli/secrets.js');
    await expect(readSecret('OPENROUTER_API_KEY')).resolves.toBe('stored-key');
  });

  it('falls back to env when no secrets file exists', async () => {
    vi.resetModules();
    vi.stubEnv('OPENROUTER_API_KEY', 'env-key');
    const { readSecret } = await import('../../src/cli/secrets.js');
    await expect(readSecret('OPENROUTER_API_KEY')).resolves.toBe('env-key');
  });

  it('returns undefined when neither is set', async () => {
    vi.resetModules();
    vi.stubEnv('OPENROUTER_API_KEY', undefined);
    const { readSecret } = await import('../../src/cli/secrets.js');
    await expect(readSecret('OPENROUTER_API_KEY')).resolves.toBeUndefined();
  });
});
