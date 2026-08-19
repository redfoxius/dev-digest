import { describe, it, expect } from 'vitest';
import { join, resolve, sep } from 'node:path';
import {
  isGlobEscaping,
  resolveWithinClone,
} from '../src/modules/context-docs/glob-safety.js';

/**
 * Unit coverage for the Project Context Folder feature's path-safety
 * helpers (AC-7, AC-41 — `docs/project-context-folder-plan.md` Work Item 1).
 * Pure functions, no DB/FS.
 */

describe('isGlobEscaping', () => {
  it('rejects a glob with leading ../ segments', () => {
    expect(isGlobEscaping('../../etc/**/*.md')).toBe(true);
  });

  it('rejects a glob with a .. segment anywhere in the pattern', () => {
    expect(isGlobEscaping('specs/../../etc/**/*.md')).toBe(true);
  });

  it('rejects an absolute glob', () => {
    expect(isGlobEscaping('/etc/**/*.md')).toBe(true);
  });

  it('rejects a Windows drive-letter glob', () => {
    expect(isGlobEscaping('C:\\Windows\\**\\*.md')).toBe(true);
    expect(isGlobEscaping('C:/Windows/**/*.md')).toBe(true);
  });

  it('accepts the default search-root glob', () => {
    expect(isGlobEscaping('**/{specs,docs,insights}/**/*.md')).toBe(false);
  });

  it('accepts an ordinary relative glob', () => {
    expect(isGlobEscaping('docs/**/*.md')).toBe(false);
  });
});

describe('resolveWithinClone', () => {
  const clonePath = resolve('/tmp/devdigest-fixture-clone');

  it('returns null for a relPath escaping clonePath via .. segments', () => {
    expect(resolveWithinClone(clonePath, '../../etc/passwd')).toBeNull();
    expect(resolveWithinClone(clonePath, '../outside.md')).toBeNull();
  });

  it('resolves a legitimate relPath within clonePath', () => {
    const result = resolveWithinClone(clonePath, 'specs/architecture.md');
    expect(result).toBe(join(clonePath, 'specs', 'architecture.md'));
  });

  it('resolves the clonePath itself (empty relPath)', () => {
    expect(resolveWithinClone(clonePath, '.')).toBe(clonePath);
  });

  it('returns null for an absolute relPath escaping clonePath', () => {
    expect(resolveWithinClone(clonePath, '/etc/passwd')).toBeNull();
  });

  it('rejects a sibling directory that merely shares a name prefix', () => {
    // `${clonePath}-evil` starts with `clonePath` as a raw string prefix
    // but is NOT actually inside it — regression guard for a naive
    // `startsWith(clonePath)` check (must check `clonePath + sep`).
    const relPath = `../${clonePath.split(sep).pop()}-evil/secret.md`;
    expect(resolveWithinClone(clonePath, relPath)).toBeNull();
  });
});
