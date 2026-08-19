import { describe, it, expect, afterEach } from 'vitest';
import { join, resolve, sep } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  isGlobEscaping,
  resolveWithinClone,
  verifyRealpathWithinClone,
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

describe('verifyRealpathWithinClone', () => {
  // Unlike `resolveWithinClone` above (pure string math against a
  // never-created path), this function does real `fs.realpath` I/O, so it
  // needs an actual clone directory and actual files/symlinks on disk.
  let clonePath: string;
  let outsideDir: string;

  afterEach(() => {
    rmSync(clonePath, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  });

  it('resolves a real, non-symlinked file inside the clone', async () => {
    clonePath = mkdtempSync(join(tmpdir(), 'devdigest-glob-safety-clone-'));
    outsideDir = mkdtempSync(join(tmpdir(), 'devdigest-glob-safety-outside-'));
    const target = join(clonePath, 'docs', 'real.md');
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, 'real content', 'utf8');

    const resolved = resolveWithinClone(clonePath, 'docs/real.md')!;
    const verified = await verifyRealpathWithinClone(clonePath, resolved);

    expect(verified).not.toBeNull();
  });

  it('rejects a symlink that lexically sits inside the clone but points outside it', async () => {
    // Regression guard for the CRITICAL finding from pr-self-review's
    // security review of PR #21: `resolveWithinClone` alone is purely
    // lexical, so a tracked symlink committed inside a repo's clone (e.g.
    // `docs/evil.md -> /etc/passwd`, or pointing at another tenant's clone)
    // passed the old check and had its target's content read/injected.
    clonePath = mkdtempSync(join(tmpdir(), 'devdigest-glob-safety-clone-'));
    outsideDir = mkdtempSync(join(tmpdir(), 'devdigest-glob-safety-outside-'));
    const secretFile = join(outsideDir, 'secret.md');
    writeFileSync(secretFile, 'TOP SECRET — outside the clone', 'utf8');

    const symlinkPath = join(clonePath, 'docs', 'evil.md');
    mkdirSync(join(symlinkPath, '..'), { recursive: true });
    symlinkSync(secretFile, symlinkPath);

    // The lexical check has no way to know `evil.md` is a symlink — it
    // still resolves to a path inside `clonePath`.
    const resolved = resolveWithinClone(clonePath, 'docs/evil.md')!;
    expect(resolved).not.toBeNull();

    // The realpath check follows the symlink and correctly rejects it.
    const verified = await verifyRealpathWithinClone(clonePath, resolved);
    expect(verified).toBeNull();
  });

  it('returns null for a path that does not exist on disk', async () => {
    clonePath = mkdtempSync(join(tmpdir(), 'devdigest-glob-safety-clone-'));
    outsideDir = mkdtempSync(join(tmpdir(), 'devdigest-glob-safety-outside-'));

    const resolved = resolveWithinClone(clonePath, 'docs/never-written.md')!;
    const verified = await verifyRealpathWithinClone(clonePath, resolved);

    expect(verified).toBeNull();
  });
});
