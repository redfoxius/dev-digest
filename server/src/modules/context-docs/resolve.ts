import { readFile } from 'node:fs/promises';
import type { Container } from '../../platform/container.js';
import { resolveWithinClone } from './glob-safety.js';

/**
 * Run-time resolution of an agent's attached Project Context documents
 * (spec §6.7, `docs/project-context-folder-plan.md` Work Item 10). This is
 * mechanism (b) — manual attachment + full-text injection — and is wholly
 * independent of the reader/chunk/embed mechanism (a) this module also
 * hosts: it never queries `code_chunks` and never calls the `Embedder` port
 * (AC-12). It reads a document's CURRENT text directly off the repo's
 * working tree via `resolveWithinClone`'s read-time path-escape guard
 * (AC-41), the same guard `repository.ts#readPreviewContent` uses for the
 * browser's Preview pane.
 *
 * Kept in this module (not `reviews/`) because it's the context-docs
 * domain's own I/O-boundary concern, mirroring how `repo-intel/pipeline/
 * walk.ts` does raw fs I/O directly within its own module rather than via a
 * formal port (no external SaaS involved — see plan's "Skills Implementer
 * Will Need" / onion-architecture note). `run-executor.ts` only calls this
 * one function and threads its result into `reviewPullRequest`'s `specs`
 * argument — it never reaches into `agentsRepo`/`skillsRepo` itself for
 * this purpose.
 */

/** AC-31 — per-document injected-text cap. */
export const MAX_SPEC_CHARS = 12_000;
const TRUNCATION_MARKER = '...[truncated]';

export interface ResolvedContextDocs {
  /** Each entry is `### {path}\n\n{text}` — ready to pass straight into
   *  `reviewPullRequest({ specs })` (AC-28). Ordered, de-duped. */
  specs: string[];
  /** The repo-relative path of every document actually injected above
   *  (post-dedup, post-missing-skip) — feeds `RunTrace.specs_read` (AC-33). */
  specsRead: string[];
  /** One entry per skipped (missing/unreadable/escaping) attached path,
   *  naming the path (AC-30) — never thrown, only collected. */
  warnings: string[];
}

/**
 * Resolves the combined, de-duped, ordered set of Project Context documents
 * for one agent run within one repo (AC-26, AC-27):
 *
 * 1. The agent's own enabled attached docs, in the agent's configured order.
 * 2. Each of the agent's enabled linked skills' (skill itself also enabled)
 *    own enabled attached docs, in the agent's skill order, then each
 *    skill's own document order.
 *
 * De-dup is to first occurrence by path (agent-level position wins when the
 * same path appears at both levels) — since this whole resolution is
 * already scoped to one `repoId`, a bare path is sufficient as the dedup
 * key (equivalent to `(repoId, path)`).
 *
 * `clonePath` is passed in directly (rather than re-resolved from `repoId`
 * via a workspace-scoped repo lookup) because the caller (`run-executor.ts`)
 * already holds the fully-loaded, already-ownership-checked repo row for
 * this run — a second DB round trip through `container.reposRepo` would be
 * redundant. `null`/missing `clonePath` (repo never cloned) degrades to an
 * empty result, never a throw.
 */
export async function resolveContextDocs(
  agentId: string,
  repoId: string,
  clonePath: string | null | undefined,
  container: Container,
): Promise<ResolvedContextDocs> {
  const specs: string[] = [];
  const specsRead: string[] = [];
  const warnings: string[] = [];

  if (!clonePath) return { specs, specsRead, warnings };

  const [ownLinks, linkedSkills] = await Promise.all([
    container.agentsRepo.linkedContextDocs(agentId, repoId),
    container.agentsRepo.linkedSkills(agentId),
  ]);

  const orderedPaths: string[] = ownLinks.filter((l) => l.enabled).map((l) => l.path);

  const attachedSkills = linkedSkills.filter((l) => l.enabled && l.skill.enabled);
  for (const link of attachedSkills) {
    const skillDocs = await container.skillsRepo.skillContextDocs(link.skill.id, repoId);
    for (const doc of skillDocs) {
      if (doc.enabled) orderedPaths.push(doc.path);
    }
  }

  const seen = new Set<string>();
  for (const path of orderedPaths) {
    if (seen.has(path)) continue; // AC-27 — first occurrence wins (agent-level, since it's ordered first)
    seen.add(path);

    const resolved = resolveWithinClone(clonePath, path);
    if (!resolved) {
      warnings.push(`Attached document path escapes repo clone, skipped: ${path}`);
      continue;
    }

    let content: string;
    try {
      content = await readFile(resolved, 'utf8');
    } catch {
      // AC-30 — deleted/renamed/unreadable at run time: skip, warn, continue.
      warnings.push(`Attached document not found or unreadable, skipped: ${path}`);
      continue;
    }

    const truncated =
      content.length > MAX_SPEC_CHARS ? content.slice(0, MAX_SPEC_CHARS) + TRUNCATION_MARKER : content;

    // AC-28 — filename heading prefix so the model/trace can cite by name.
    specs.push(`### ${path}\n\n${truncated}`);
    specsRead.push(path);
  }

  return { specs, specsRead, warnings };
}
