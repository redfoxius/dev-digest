import type { ProposedSplit } from '@devdigest/shared';

/**
 * Phase 6 of docs/smart-diff-plan.md — deterministic, no-LLM `split_suggestion`
 * clustering. Pure function: takes the PR's changed `core`-role file paths
 * (already classified/filtered by the caller — `wiring`/`boilerplate` never
 * reach this function) plus the repo's raw import-graph edges
 * (`RepoIntel.getFileEdges`), and groups the `core` files into weakly-
 * connected components over the induced subgraph.
 *
 * Neither `graphology` nor `graphology-metrics` ships a components algorithm
 * (only PageRank, `repo-intel/pipeline/rank.ts`) — a graph this small (one
 * PR's changed files) doesn't need a library; a hand-rolled BFS over an
 * adjacency map is enough.
 */

export interface SplitEdge {
  fromFile: string;
  toFile: string;
}

/**
 * Group `coreFilePaths` into `ProposedSplit`s using weakly-connected
 * components over `edges` filtered to the induced subgraph (both endpoints
 * in `coreFilePaths`).
 *
 * - Every `core` file appears in exactly one component — a file with no
 *   edges to any other `core` file becomes its own singleton component (no
 *   special-casing/merging into a catch-all bucket; a uniform rule keeps an
 *   accurate "unrelated to anything else changed" signal itself useful).
 * - Component order (and therefore `ProposedSplit[]` order) is deterministic:
 *   by each component's earliest file's position in `coreFilePaths` (i.e.
 *   `pr_files` order).
 * - `[]` in ⇒ `[]` out: no `core` files means nothing to cluster.
 */
export function computeProposedSplits(
  coreFilePaths: string[],
  edges: SplitEdge[],
): ProposedSplit[] {
  if (coreFilePaths.length === 0) return [];

  const coreSet = new Set(coreFilePaths);

  // Undirected adjacency over the induced subgraph — every core file gets an
  // entry (possibly empty) so an isolated node still surfaces as its own
  // singleton component below.
  const adjacency = new Map<string, Set<string>>();
  for (const path of coreFilePaths) adjacency.set(path, new Set());
  for (const edge of edges) {
    if (!coreSet.has(edge.fromFile) || !coreSet.has(edge.toFile)) continue;
    adjacency.get(edge.fromFile)!.add(edge.toFile);
    adjacency.get(edge.toFile)!.add(edge.fromFile);
  }

  const visited = new Set<string>();
  const components: string[][] = [];

  for (const start of coreFilePaths) {
    if (visited.has(start)) continue;
    const memberSet = new Set<string>();
    const queue = [start];
    visited.add(start);
    while (queue.length > 0) {
      const current = queue.shift()!;
      memberSet.add(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    // Re-derive membership order from `coreFilePaths` itself (not BFS visit
    // order) so a component's `files[]` is stable/deterministic regardless
    // of adjacency-set iteration order.
    components.push(coreFilePaths.filter((p) => memberSet.has(p)));
  }

  const named = components.map((files) => {
    // A singleton's "common directory prefix" is trivially its OWN full
    // directory (nothing to compare it against) — using that as the name
    // means every unconnected file sharing a folder with another
    // unconnected file (e.g. Component.tsx / Component.test.tsx / styles.ts
    // / constants.ts with no import edges between them) renders as several
    // DIFFERENT chips with the SAME label, reading as duplicates in the
    // banner even though each is a distinct 1-file split. Always name a
    // singleton by its own filename instead — only a REAL multi-file
    // component (genuinely edge-connected) benefits from a shared-directory
    // name, since there the prefix actually distinguishes it from other
    // components. (Two singletons whose basenames themselves collide, e.g.
    // two unrelated `styles.ts` files, are disambiguated in a second pass
    // below — see `disambiguateSingletonNames`.)
    if (files.length === 1) return { name: basename(files[0]!), files };

    // A prefix of just one segment (e.g. `server`, `client`) is barely more
    // informative than no prefix at all — in a repo laid out as top-level
    // packages, it's often just "the package name," true of nearly every
    // file in that package, not a distinguishing label for THIS cluster
    // (confirmed live: a 10-file connected component spanning several
    // unrelated server/ modules named itself "server" — no signal). Require
    // at least two segments (e.g. `src/api`) before trusting the prefix.
    const prefix = commonDirectoryPrefix(files);
    if (prefix != null && prefix.split('/').length >= 2) return { name: prefix, files };
    // No shared directory (or one too shallow to be meaningful) — a generic
    // "Split N" fallback here is indistinguishable from every other
    // ungrouped singleton/cluster in the banner (confirmed live: a PR with
    // several disconnected `core` files renders a wall of "Split 1"/
    // "Split 2"/"Split 3" chips with no hint of which file each one is).
    // Naming off the first member's own filename instead means every chip's
    // label is something the user can actually recognize.
    const name = `${basename(files[0]!)} +${files.length - 1}`;
    return { name, files };
  });

  return disambiguateSingletonNames(named);
}

/**
 * Two unrelated singletons can legitimately share a basename (e.g. two
 * different `styles.ts`/`service.ts`/`INSIGHTS.md` files in different
 * folders) — confirmed live on a real PR: 7 of 55 chips collided this way.
 * For any singleton whose name collides with another chip's name, grow its
 * label by one more trailing path segment at a time until it's unique —
 * repeated in passes so a still-colliding pair keeps growing together.
 * Always terminates: the full path is unique per file by construction, and
 * `depth` is capped by the longest path's segment count.
 */
function disambiguateSingletonNames(
  entries: { name: string; files: string[] }[],
): { name: string; files: string[] }[] {
  let current = entries;
  const maxDepth = Math.max(1, ...entries.map((e) => e.files[0]!.split('/').length));
  for (let depth = 1; depth <= maxDepth; depth++) {
    const counts = new Map<string, number>();
    for (const e of current) counts.set(e.name, (counts.get(e.name) ?? 0) + 1);
    const anyColliding = current.some((e) => e.files.length === 1 && (counts.get(e.name) ?? 0) > 1);
    if (!anyColliding) break;
    current = current.map((e) => {
      if (e.files.length !== 1 || (counts.get(e.name) ?? 0) <= 1) return e;
      const segments = e.files[0]!.split('/');
      const take = Math.min(depth + 1, segments.length);
      return { name: segments.slice(-take).join('/'), files: e.files };
    });
  }
  return current;
}

/** Last `/`-separated segment of a path. */
function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? path : path.slice(idx + 1);
}

/**
 * Longest common leading directory-segment prefix across `paths` (e.g.
 * `src/api/public`), or `null` when there is none — either because two
 * paths' directories share no leading segment, or because a path has no
 * directory at all (a root-level file, whose "directory segments" array is
 * empty, so the common prefix is trivially empty too).
 */
function commonDirectoryPrefix(paths: string[]): string | null {
  const segmentsList = paths.map((p) => p.split('/').slice(0, -1));
  let prefix = segmentsList[0]!;
  for (const segments of segmentsList.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < segments.length && prefix[i] === segments[i]) i++;
    prefix = prefix.slice(0, i);
    if (prefix.length === 0) break;
  }
  return prefix.length > 0 ? prefix.join('/') : null;
}
