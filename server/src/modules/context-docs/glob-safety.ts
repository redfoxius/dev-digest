import { resolve, sep } from 'node:path';

/**
 * Pure path-safety helpers for the Project Context Folder feature
 * (AC-7, AC-41). No DB/FS side effects: `isGlobEscaping` only inspects the
 * glob string itself; `resolveWithinClone` calls `node:path` only (no
 * filesystem access — callers do the actual `fs.readFile`/`stat`).
 */

const DRIVE_LETTER_RE = /^[a-zA-Z]:[\\/]/;

/**
 * Rejects a search-root glob that could resolve outside a repo's own
 * `clonePath`: a `..` path segment, a leading `/` (or `\`) making it an
 * absolute path, or a Windows drive-letter segment (`C:\...`, `C:/...`).
 */
export function isGlobEscaping(glob: string): boolean {
  if (glob.startsWith('/') || glob.startsWith('\\')) return true;
  if (DRIVE_LETTER_RE.test(glob)) return true;

  const segments = glob.split(/[\\/]+/);
  return segments.some((segment) => segment === '..');
}

/**
 * Resolves `relPath` against `clonePath` and returns the resolved absolute
 * path only if it stays within `clonePath`; returns `null` if it would
 * escape (e.g. via `..` segments). Does not touch the filesystem — callers
 * are responsible for checking the resolved path actually exists/is
 * readable before using it.
 */
export function resolveWithinClone(clonePath: string, relPath: string): string | null {
  const resolvedClone = resolve(clonePath);
  const resolvedTarget = resolve(resolvedClone, relPath);

  if (resolvedTarget === resolvedClone) return resolvedTarget;
  if (resolvedTarget.startsWith(resolvedClone + sep)) return resolvedTarget;
  return null;
}
