import type { Container } from '../../platform/container.js';
import type { BlastRadiusResponse } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { MAX_CALLERS_PER_SYMBOL } from '../repo-intel/constants.js';
import type { BlastCallerRow } from '../repo-intel/types.js';

/**
 * Blast Radius (docs/blast-radius-plan.md) — thin composition over the
 * already-persistent `container.repoIntel.getBlastRadius` facade method. No
 * new indexing/graph/AST work happens here or on any request path; this
 * service only resolves a PR to its repoId + changed files (the same lookup
 * `SmartDiffService.getSmartDiff` uses) and reshapes the facade's flat
 * `callers` list into the `BlastRadiusResponse` contract's per-symbol
 * `downstream` grouping.
 */
export class BlastService {
  constructor(private container: Container) {}

  async getBlastRadius(workspaceId: string, prId: string): Promise<BlastRadiusResponse> {
    const pull = await this.container.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const files = await this.container.reviewRepo.getPrFiles(prId);
    const changedPaths = files.map((f) => f.path);

    const [result, indexState] = await Promise.all([
      this.container.repoIntel.getBlastRadius(pull.repoId, changedPaths),
      this.container.repoIntel.getIndexState(pull.repoId),
    ]);

    const changedSymbols = result.changedSymbols.map((s) => ({
      name: s.name,
      file: s.file,
      kind: s.kind,
    }));

    // Group callers by the changed symbol they reach (`viaSymbol`).
    const callersBySymbol = new Map<string, BlastCallerRow[]>();
    for (const c of result.callers) {
      const arr = callersBySymbol.get(c.viaSymbol);
      if (arr) arr.push(c);
      else callersBySymbol.set(c.viaSymbol, [c]);
    }

    const factsByFile = result.factsByFile ?? {};
    const downstream = changedSymbols.map((s) => {
      const callers = callersBySymbol.get(s.name) ?? [];
      const endpoints = new Set<string>();
      const crons = new Set<string>();
      for (const c of callers) {
        const facts = factsByFile[c.file];
        if (!facts) continue;
        for (const e of facts.endpoints) endpoints.add(e);
        for (const cr of facts.crons) crons.add(cr);
      }
      return {
        symbol: s.name,
        callers: callers.slice(0, MAX_CALLERS_PER_SYMBOL).map((c) => ({
          name: c.symbol,
          file: c.file,
          line: c.line,
        })),
        endpoints_affected: [...endpoints],
        crons_affected: [...crons],
      };
    });

    return {
      changed_symbols: changedSymbols,
      downstream,
      summary: buildSummary(changedSymbols.length, result.callers.length, downstream),
      // The exact commit repo-intel's line numbers were parsed from — NOT
      // necessarily this PR's head SHA (the index reflects whatever was last
      // (re)synced, typically the default branch; a merged/older PR's own
      // patch content is frozen at a different commit). The client needs
      // this to know when a caller's `line` can be trusted to line up with
      // this PR's own diff view vs. when it must open the file on GitHub at
      // THIS commit instead (docs/blast-radius-plan.md's "View in Diff
      // jumped to the wrong place" fix, round 2).
      indexed_sha: indexState.lastIndexedSha || null,
      ...(result.degraded ? { degraded: true as const, reason: result.reason } : {}),
    };
  }
}

/**
 * Deterministic, no-LLM summary line — satisfies `BlastRadius`'s required
 * `summary` field without a model call on the core path (blast-radius-plan's
 * acceptance criterion: the main scenario never calls an LLM). An optional
 * future LLM pass can overwrite this with a richer paragraph; that pass is
 * explicitly out of scope here.
 */
function buildSummary(
  symbolCount: number,
  callerCount: number,
  downstream: { endpoints_affected: string[]; crons_affected: string[] }[],
): string {
  if (symbolCount === 0) return 'No symbols were declared in the changed files.';
  const endpointCount = new Set(downstream.flatMap((d) => d.endpoints_affected)).size;
  const cronCount = new Set(downstream.flatMap((d) => d.crons_affected)).size;
  const parts = [
    `${symbolCount} symbol${symbolCount === 1 ? '' : 's'} changed`,
    `${callerCount} caller${callerCount === 1 ? '' : 's'}`,
  ];
  if (endpointCount > 0) parts.push(`${endpointCount} endpoint${endpointCount === 1 ? '' : 's'} affected`);
  if (cronCount > 0) parts.push(`${cronCount} cron job${cronCount === 1 ? '' : 's'} affected`);
  return `${parts.join(', ')}.`;
}
