import type { Intent, UnifiedDiff } from '@devdigest/shared';
import type { PullRow } from '../../db/rows.js';
import type * as schema from '../../db/schema.js';

/**
 * Minimal, duck-typed logging interface for the Intent Layer. `RunLogger`
 * (`platform/run-logger.ts`) already satisfies this shape structurally for
 * the automatic call site (`run-executor.ts`) — this module doesn't import
 * platform internals just to log. The manual re-derive call site
 * (`reviews/service.ts`) passes a tiny inline adapter over Fastify's
 * `app.log` (pino) instead, since a manual re-derive has no SSE run/trace to
 * fan into.
 */
export interface IntentLog {
  info(msg: string, data?: unknown): void;
  /** External I/O (LLM / GitHub / URL fetch). */
  tool(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
}

export interface DeriveIntentInput {
  workspaceId: string;
  pull: PullRow;
  repo: typeof schema.repos.$inferSelect;
  /** The PR's unified diff — `derive()` may only read `files[].{path,
   *  additions,deletions,hunks}` (re-rendering hunk HEADERS from the numeric
   *  hunk fields); never `diff.raw` or a per-file slice, which carry hunk
   *  BODY content (cost + privacy — see docs/intent-layer-plan.md §1). */
  diff: UnifiedDiff;
  log: IntentLog;
}

/**
 * PR intent derivation — a cross-module capability composing LLM +
 * GitHubClient + UrlFetcher + a DB read (`reviewRepo.getPrCommits`), modeled
 * as its own port+service pair wired onto `Container` (mirrors `RepoIntel`)
 * so it stays swappable via `ContainerOverrides` in unit tests. This module
 * owns no persisted resource of its own — persistence stays in `reviews`'
 * `ReviewRepository`, which already owns `pr_intent`.
 */
export interface IntentDeriver {
  /**
   * Best-effort at the whole-derivation level: returns `undefined` (logged
   * via `log.error`, never thrown) when derivation totally fails, so the
   * automatic call site (`run-executor.ts`) can degrade to "no intent
   * section" without failing the review batch. The manual call site
   * (`ReviewService.deriveIntent`) treats an `undefined` result as a real
   * failure and surfaces it as a 5xx — the user clicked an explicit action.
   */
  derive(input: DeriveIntentInput): Promise<Intent | undefined>;
}
