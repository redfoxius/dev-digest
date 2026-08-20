/**
 * Go import-graph builder (docs/go-language-support-plan.md Phase 3;
 * multi-module discovery: docs/go-multi-module-depgraph-plan.md).
 *
 * dependency-cruiser only understands the TS/JS module-resolution family, so
 * Go files need their own resolver: discover each Go file's *governing*
 * go.mod by walking upward from its own directory toward `root` (deepest
 * go.mod wins — a directory keeps looking only until it finds one), then for
 * each Go file's imports (parsed via astgrep/langs/go.ts through the shared
 * parseImports dispatcher), map any import path prefixed by that module's
 * `module` directive value to a local package directory and edge to every
 * already-walked Go file in that directory. Non-local imports (stdlib,
 * third-party module paths) are skipped — same "local files only" contract
 * DepCruiseGraph applies to TS/JS.
 *
 * Discovery is per-directory, not once-per-build: a multi-module monorepo
 * (several sibling go.mod files, none at root) or a single module whose
 * go.mod lives in a subdirectory both get real edges, resolved independently
 * per module. Cross-module imports (wired via a `replace` directive or a
 * go.work file) are explicitly out of scope — an import that would only
 * resolve across a go.mod boundary is treated as non-local (no edge), never
 * as a wrong edge.
 *
 * Go resolves at the package (directory) level, not the file level — one
 * import statement pulls in the whole target package, so this fans an edge
 * out to every file in that directory rather than picking one representative
 * file (the v1 choice called out in the plan doc).
 *
 * Never throws: a missing/unparsable go.mod, or a file that fails to read or
 * parse, degrades that piece to no edges rather than failing the whole
 * build — mirrors DepCruiseGraph's try/catch-to-`[]` contract, now applied at
 * per-directory/per-file grain instead of whole-build grain.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseImports } from '../astgrep/index.js';
import { languageIdForFile } from '../../modules/repo-intel/languages/index.js';
import type { DepGraph, FileEdge } from './index.js';

const MODULE_DIRECTIVE = /^module\s+(\S+)/m;

/** A discovered go.mod: its `module` directive value and its own repo-relative directory. */
interface GoModule {
  modulePath: string;
  moduleDir: string;
}

export class GoDepGraph implements DepGraph {
  async buildEdges(root: string, files: string[]): Promise<FileEdge[]> {
    const goFiles = files.filter((f) => languageIdForFile(f) === 'go');
    if (goFiles.length === 0) return [];

    const filesByDir = new Map<string, string[]>();
    for (const f of goFiles) {
      const dir = dirname(f);
      const bucket = filesByDir.get(dir);
      if (bucket) bucket.push(f);
      else filesByDir.set(dir, [f]);
    }

    // Per-buildEdges-call cache of directory -> governing go.mod (or null),
    // shared by every source-side and target-side lookup below.
    const moduleCache = new Map<string, GoModule | null>();

    const edges: FileEdge[] = [];
    const seen = new Set<string>();
    for (const from of goFiles) {
      const governingModule = await discoverGoverningModule(root, dirname(from), moduleCache);
      if (!governingModule) continue;

      let source: string;
      try {
        source = await readFile(join(root, from), 'utf8');
      } catch {
        continue;
      }

      let imports;
      try {
        imports = parseImports(from, source);
      } catch {
        continue;
      }

      for (const imp of imports) {
        const pkgDir = resolveLocalPackageDir(governingModule.modulePath, imp.source);
        if (pkgDir === null) continue;
        const repoRelativeDir = joinModuleRelative(governingModule.moduleDir, pkgDir);

        // Map-lookup-only: an import shaped for path traversal (e.g. a
        // `../`-laden resolution) simply won't match any real filesByDir
        // key (all of which come straight from the walked file set), so it
        // fails closed here with no filesystem call at all.
        const targets = filesByDir.get(repoRelativeDir);
        if (!targets) continue;

        // Target-side governing-module guard: the candidate directory is a
        // real, in-repo directory (a filesByDir key) at this point, so this
        // lookup never escapes root. Required to prevent a cross-module-edge
        // leak in nested-module layouts — an import string that prefix-
        // matches into a *different*, more-nested module's directory (e.g.
        // outer module `a` importing what looks like a path under inner
        // module `a/b`) can never resolve as a same-module local import
        // under real Go semantics once `a/b` declares its own go.mod; only
        // add the edge when the candidate's own governing module is the
        // exact same go.mod as the source file's.
        const targetModule = await discoverGoverningModule(root, repoRelativeDir, moduleCache);
        if (
          !targetModule ||
          targetModule.modulePath !== governingModule.modulePath ||
          targetModule.moduleDir !== governingModule.moduleDir
        ) {
          continue;
        }

        for (const to of targets) {
          if (to === from) continue;
          const key = `${from} ${to}`;
          if (seen.has(key)) continue;
          seen.add(key);
          edges.push({ from, to });
        }
      }
    }
    return edges;
  }
}

/**
 * Discovers `dir`'s governing go.mod by walking upward toward `root`
 * (inclusive), stopping at the first go.mod found. Memoizes every directory
 * visited during the walk (not just `dir` itself) in `cache`, including a
 * "not found" (`null`) result, so a shared ancestor go.mod is read at most
 * once across the whole `buildEdges` call regardless of which directory
 * triggers discovery first. Bounded strictly by `dir`'s own path depth to
 * `root` (repeated `dirname()` toward `.`) — never inspects or reads any
 * path above `root`.
 */
async function discoverGoverningModule(
  root: string,
  dir: string,
  cache: Map<string, GoModule | null>,
): Promise<GoModule | null> {
  const visited: string[] = [];
  let current = dir;

  for (;;) {
    const cached = cache.get(current);
    if (cached !== undefined) {
      for (const d of visited) cache.set(d, cached);
      return cached;
    }
    visited.push(current);

    const modulePath = await readModulePathAt(root, current);
    if (modulePath !== null) {
      const result: GoModule = { modulePath, moduleDir: current };
      for (const d of visited) cache.set(d, result);
      return result;
    }

    if (current === '.') {
      for (const d of visited) cache.set(d, null);
      return null;
    }
    current = dirname(current);
  }
}

/** Reads the `module` directive from `<root>/<dir>/go.mod`, or null if missing/unparsable. */
async function readModulePathAt(root: string, dir: string): Promise<string | null> {
  try {
    const content = await readFile(join(root, dir, 'go.mod'), 'utf8');
    return MODULE_DIRECTIVE.exec(content)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Joins a module-relative package dir with its governing go.mod's own repo-relative dir. */
function joinModuleRelative(moduleDir: string, pkgDir: string): string {
  if (moduleDir === '.') return pkgDir;
  return join(moduleDir, pkgDir);
}

/** Maps an import path to a module-relative package directory, or null if external. */
function resolveLocalPackageDir(modulePath: string, importPath: string): string | null {
  if (importPath === modulePath) return '.';
  if (importPath.startsWith(`${modulePath}/`)) return importPath.slice(modulePath.length + 1);
  return null;
}
