import { resolve, sep } from 'node:path';
import { realpath } from 'node:fs/promises';

/**
 * Path-safety helpers for the Project Context Folder feature (AC-7, AC-41).
 * `isGlobEscaping`/`resolveWithinClone` are pure — no FS access, string
 * inspection only. `verifyRealpathWithinClone` is the one exception: it
 * does touch the filesystem (`fs.realpath`), because a lexical check alone
 * cannot catch a symlink that physically sits inside `clonePath` but
 * resolves outside it on disk.
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

/**
 * Read-time defense-in-depth against a symlink escape: `resolveWithinClone`
 * only inspects the path STRING, so a file that lexically sits inside
 * `clonePath` but is actually a symlink pointing outside it (e.g. a tracked
 * `docs/evil.md -> /etc/passwd`, committed by anyone whose repo gets
 * cloned/scanned) still passes it. `reader.ts`'s discovery walk skips
 * symlinks entirely, so such a path never appears in `context_documents` —
 * but nothing stops it being submitted directly to the manual-attach
 * endpoints (`agent_context_docs`/`skill_context_docs`), which is exactly
 * the path this guard closes.
 *
 * `fs.realpath` follows the full symlink chain to where the file ACTUALLY
 * lives on disk; only after that do we re-check containment. Returns `null`
 * if the path doesn't exist, isn't readable, or its real target escapes
 * `clonePath` — the caller maps that to a skip/404, never a 500.
 */
export async function verifyRealpathWithinClone(
  clonePath: string,
  resolvedPath: string,
): Promise<string | null> {
  let realClone: string;
  let realTarget: string;
  try {
    [realClone, realTarget] = await Promise.all([realpath(resolve(clonePath)), realpath(resolvedPath)]);
  } catch {
    return null;
  }

  if (realTarget === realClone) return realTarget;
  if (realTarget.startsWith(realClone + sep)) return realTarget;
  return null;
}
