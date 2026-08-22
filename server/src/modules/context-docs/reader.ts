import { readdir, readFile } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import ignore from 'ignore';
import type { ContextDocRoot } from '@devdigest/shared';

/**
 * Project Context Folder — recursive `.md` discovery (spec §6.1, AC-1–AC-4,
 * `docs/project-context-folder-plan.md` Work Item 3). Pure-ish: takes a
 * clone root + configured exclude patterns, returns discovered docs; the
 * only side effect is reading the repo's own working tree (never writes,
 * never touches the DB — that's `repository.ts`'s job).
 */

/** Default exclude patterns (AC-43) — applied whenever `repos.context_search_excludes` is null. */
export const DEFAULT_CONTEXT_EXCLUDES = ['**/AGENTS.md', '**/CLAUDE.md', '**/.claude/**'];

/**
 * Directories never walked. Mirrors `repo-intel/constants.ts`'s
 * `EXCLUDED_DIRS` list (own copy here rather than a cross-module import —
 * `context-docs` and `repo-intel` are independent modules; onion-architecture
 * forbids reaching into another module's repository/service, not duplicating
 * a small literal constant). Same caveat as that module's own doc comment:
 * this is NOT a real `.gitignore` parser, just the heaviest known dirs
 * (AC-4's own verify clause only requires a `node_modules/**` file be
 * excluded, which this fully satisfies).
 */
const EXCLUDED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  'out',
  'vendor',
  '.git',
]);

/** Root-known directory segment names, in classification precedence order. */
const ROOT_SEGMENTS: readonly ContextDocRoot[] = ['specs', 'docs', 'insights'];

export interface DiscoveredDoc {
  /** Repo-relative, posix-separated path. */
  path: string;
  root: ContextDocRoot;
  sizeBytes: number;
  contentHash: string;
  /** Full file text (utf8) — read once here so the chunker never re-reads
   *  the file. Never persisted verbatim to `context_documents` — attachment
   *  (a wholly separate mechanism) stores paths only, per spec §4. */
  content: string;
}

/**
 * Derives a document's `root` purely from its path (AC-3 — never a
 * content-based classification step): the first path segment matching one
 * of the three known root names wins. Since discovery now walks every `.md`
 * file and only excludes what's configured, a surviving path that never
 * routes through `specs/`, `docs/`, or `insights/` still has to land in one
 * of the three fixed DB values — this defaults such a path to `docs`, the
 * most general of the three (documented judgment call).
 */
function classifyRoot(relPath: string): ContextDocRoot {
  const segments = relPath.split('/');
  for (const seg of segments) {
    if ((ROOT_SEGMENTS as readonly string[]).includes(seg)) return seg as ContextDocRoot;
  }
  return 'docs';
}

/**
 * Recursively scans `clonePath` for every `.md` file, then filters out any
 * path matching `excludes` (real gitignore semantics via the `ignore`
 * package — `**`, interior-`/` anchoring, `!` negation), returning one
 * `DiscoveredDoc` per surviving path — sorted by path for a stable,
 * testable result. `EXCLUDED_DIRS` are pruned during the walk itself (never
 * even read), same posture as `repo-intel/pipeline/walk.ts` — a separate,
 * independent layer from the `excludes` filter below (AC-4).
 */
export async function discoverContextDocs(
  clonePath: string,
  excludes: string[],
): Promise<DiscoveredDoc[]> {
  const candidates: string[] = [];
  await walk(clonePath, clonePath, candidates);

  // Empty excludes (AC-6) means zero exclusions — keep every candidate verbatim.
  let matched: string[];
  if (excludes.length === 0) {
    matched = candidates;
  } else {
    const ig = ignore().add(excludes);
    matched = candidates.filter((p) => !ig.ignores(p));
  }
  const out: DiscoveredDoc[] = [];

  for (const relPath of matched) {
    const full = join(clonePath, ...relPath.split('/'));
    let content: Buffer;
    try {
      content = await readFile(full);
    } catch {
      continue; // vanished between walk and read
    }
    out.push({
      path: relPath,
      root: classifyRoot(relPath),
      sizeBytes: content.byteLength,
      contentHash: createHash('sha256').update(content).digest('hex'),
      content: content.toString('utf8'),
    });
  }

  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

async function walk(root: string, dir: string, out: string[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
  } catch {
    // Unreadable directory (permissions, dangling symlink) — skip cleanly so
    // discovery keeps making progress on the parts of the clone it CAN read.
    return;
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue; // never follow symlinks (loops, escapes)
    const name = entry.name;

    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(name)) continue;
      await walk(root, join(dir, name), out);
      continue;
    }

    if (!entry.isFile()) continue;
    if (extname(name).toLowerCase() !== '.md') continue;

    const rel = relative(root, join(dir, name)).split(sep).join('/');
    out.push(rel);
  }
}
