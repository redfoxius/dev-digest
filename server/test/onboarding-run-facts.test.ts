import { describe, it, expect } from 'vitest';
import { parseRunFacts, type RunFactsInput } from '../src/modules/onboarding/run-facts.js';

const empty: RunFactsInput = {
  packageJson: null,
  envExample: null,
  envSample: null,
  dockerfile: null,
  dockerCompose: null,
};

describe('parseRunFacts (docs/onboarding-generator-plan.md Work Item 4)', () => {
  it('AC-12 — names exactly the sources present, nothing invented', () => {
    const facts = parseRunFacts({
      ...empty,
      packageJson: JSON.stringify({
        packageManager: 'pnpm@10.0.0',
        scripts: { dev: 'next dev', build: 'next build' },
      }),
      dockerCompose: 'services:\n  api:\n    build: .\n',
    });

    expect(facts.packageManager).toBe('pnpm');
    expect(facts.scripts).toEqual(['dev', 'build']);
    expect(facts.hasDockerCompose).toBe(true);
    expect(facts.hasDockerfile).toBe(false);
    expect(facts.hasEnvExample).toBe(false);
    expect(facts.hasEnvSample).toBe(false);
    expect(facts.detected).toBe(true);
  });

  it('AC-13 — an all-absent fixture produces an explicit "no run facts detected" flag', () => {
    const facts = parseRunFacts(empty);
    expect(facts.detected).toBe(false);
    expect(facts.scripts).toEqual([]);
    expect(facts.packageManager).toBeNull();
    expect(facts.hasEnvExample).toBe(false);
    expect(facts.hasEnvSample).toBe(false);
    expect(facts.hasDockerfile).toBe(false);
    expect(facts.hasDockerCompose).toBe(false);
  });

  it('a malformed package.json (invalid JSON syntax) is treated as absent, never throws', () => {
    expect(() =>
      parseRunFacts({ ...empty, packageJson: '{ "scripts": { "dev": ' }),
    ).not.toThrow();
    const facts = parseRunFacts({ ...empty, packageJson: '{ not json at all' });
    expect(facts.scripts).toEqual([]);
    expect(facts.packageManager).toBeNull();
    expect(facts.detected).toBe(false);
  });

  it('a wrong-shaped package.json (scripts as a string, not an object) is treated as absent, never throws', () => {
    const facts = parseRunFacts({
      ...empty,
      packageJson: JSON.stringify({ scripts: 'not-an-object' }),
    });
    expect(facts.scripts).toEqual([]);
    expect(facts.detected).toBe(false);
  });

  it('never surfaces .env* file content in any returned field (AC-34 structural guarantee)', () => {
    const secretEnvContent = 'DATABASE_URL=postgres://user:hunter2@host/db\nSTRIPE_SECRET=sk_live_abc123';
    const facts = parseRunFacts({
      ...empty,
      envExample: secretEnvContent,
      envSample: secretEnvContent,
    });
    expect(facts.hasEnvExample).toBe(true);
    expect(facts.hasEnvSample).toBe(true);
    // Every value on the returned struct is a boolean, a string[] of script
    // NAMES, or a package-manager NAME — assert none of them ever contain the
    // env content's actual secret substrings.
    const serialized = JSON.stringify(facts);
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('sk_live_abc123');
    expect(serialized).not.toContain('DATABASE_URL');
  });
});
