import type {
  AgentSummary,
  ConventionCategory,
  ConventionStatus,
  ConventionSummary,
  PullSummary,
  RepoSummary,
  ReviewRecord,
  RunRef,
  RunRow,
} from './types.js';

export interface ConventionFilters {
  status?: ConventionStatus;
  category?: ConventionCategory;
  language?: string;
}

/**
 * Port for the DevDigest HTTP API — one method per use case (mirrors
 * `GitHubClient`/`GitClient`'s method-per-capability shape in `server/`,
 * not a generic `get<T>()`/`post<T>()` passthrough). `resolve.ts` and every
 * `tools/*.ts` handler depend on THIS interface, never on `http-client.ts`'s
 * concrete `FetchDevDigestApiClient` directly — `container.ts` (Phase C) is
 * the sole place that constructs the concrete adapter and hands it down as
 * this type (onion-architecture skill review, docs/mcp-server-plan.md's
 * "Port & Composition Root" section).
 */
export interface DevDigestApiClient {
  getAgents(): Promise<AgentSummary[]>;
  getRepos(): Promise<RepoSummary[]>;
  getRepoPulls(repoId: string): Promise<PullSummary[]>;
  getRepoConventions(repoId: string, filters?: ConventionFilters): Promise<ConventionSummary[]>;
  triggerReview(pullId: string, agentId: string): Promise<RunRef>;
  getRuns(pullId: string): Promise<RunRow[]>;
  getReviews(pullId: string): Promise<ReviewRecord[]>;
}
