import { describe, it, expect } from 'vitest';
import { languageIdForFile, SUPPORTED_EXT, LANGUAGES } from '../src/modules/repo-intel/languages/index.js';

/**
 * The single language registry — replaces what used to be three (really
 * four) independently maintained extension allowlists. See
 * docs/go-language-support-plan.md's "Implementation notes" section.
 */
describe('languageIdForFile', () => {
  it('resolves every TS/JS extension to the "typescript" bucket', () => {
    for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']) {
      expect(languageIdForFile(`a${ext}`)).toBe('typescript');
    }
  });

  it('resolves .go to the "go" bucket', () => {
    expect(languageIdForFile('main.go')).toBe('go');
  });

  it('is case-insensitive', () => {
    expect(languageIdForFile('main.GO')).toBe('go');
    expect(languageIdForFile('a.TS')).toBe('typescript');
  });

  it('returns null for an unsupported extension', () => {
    expect(languageIdForFile('README.md')).toBeNull();
    expect(languageIdForFile('main.py')).toBeNull();
  });
});

describe('SUPPORTED_EXT', () => {
  it('is the flattened union of every registered language', () => {
    for (const lang of LANGUAGES) {
      for (const ext of lang.extensions) {
        expect(SUPPORTED_EXT).toContain(ext);
      }
    }
  });
});
