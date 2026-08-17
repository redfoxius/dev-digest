import { z } from 'zod';
import type { DevDigestMcpConfig } from './config.js';
import { DomainError } from './errors.js';
import type { ConventionFilters, DevDigestApiClient } from './ports.js';
import {
  AgentSummarySchema,
  ConventionSummarySchema,
  PullSummarySchema,
  RepoSummarySchema,
  ReviewRecordSchema,
  RunRowSchema,
} from './types.js';

const TriggerReviewResponseSchema = z.object({
  runs: z.array(z.object({ run_id: z.string() })).min(1),
});

/**
 * `FetchDevDigestApiClient implements DevDigestApiClient` — the ONLY file in
 * this package that calls `fetch` against the DevDigest API
 * (docs/mcp-server-plan.md's "Port & Composition Root" section). Every
 * response body is validated with zod before being handed back (zod skill's
 * `parse-never-trust-json` — a local API response is still untrusted JSON
 * crossing a process boundary, same as any other external JSON) using each
 * schema's default `.strip()` mode, so extra server-side fields are
 * silently narrowed away rather than causing a mismatch.
 */
export class FetchDevDigestApiClient implements DevDigestApiClient {
  constructor(private readonly config: DevDigestMcpConfig) {}

  getAgents(): Promise<z.infer<typeof AgentSummarySchema>[]> {
    return this.requestJson('/agents', z.array(AgentSummarySchema));
  }

  getRepos(): Promise<z.infer<typeof RepoSummarySchema>[]> {
    return this.requestJson('/repos', z.array(RepoSummarySchema));
  }

  getRepoPulls(repoId: string): Promise<z.infer<typeof PullSummarySchema>[]> {
    return this.requestJson(`/repos/${encodeURIComponent(repoId)}/pulls`, z.array(PullSummarySchema));
  }

  getRepoConventions(
    repoId: string,
    filters?: ConventionFilters,
  ): Promise<z.infer<typeof ConventionSummarySchema>[]> {
    const query = new URLSearchParams();
    if (filters?.status) query.set('status', filters.status);
    if (filters?.category) query.set('category', filters.category);
    if (filters?.language) query.set('language', filters.language);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return this.requestJson(
      `/repos/${encodeURIComponent(repoId)}/conventions${suffix}`,
      z.array(ConventionSummarySchema),
    );
  }

  async triggerReview(pullId: string, agentId: string): Promise<{ run_id: string }> {
    const body = await this.requestJson(
      `/pulls/${encodeURIComponent(pullId)}/review`,
      TriggerReviewResponseSchema,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentId }),
      },
    );
    // One agentId in, one run out — this call never uses `{all:true}`.
    return { run_id: body.runs[0]!.run_id };
  }

  getRuns(pullId: string): Promise<z.infer<typeof RunRowSchema>[]> {
    return this.requestJson(`/pulls/${encodeURIComponent(pullId)}/runs`, z.array(RunRowSchema));
  }

  getReviews(pullId: string): Promise<z.infer<typeof ReviewRecordSchema>[]> {
    return this.requestJson(`/pulls/${encodeURIComponent(pullId)}/reviews`, z.array(ReviewRecordSchema));
  }

  private async requestJson<T>(
    path: string,
    // Input generic relaxed to `any`: RepoSummarySchema is a ZodEffects whose
    // wire input (`full_name`) differs from its parsed output (`fullName`) —
    // pinning Input===Output here would reject that transform.
    schema: z.ZodType<T, z.ZodTypeDef, any>,
    init?: RequestInit,
  ): Promise<T> {
    const url = `${this.config.apiBase}${path}`;
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch {
      throw new DomainError(
        `DevDigest API unreachable at ${this.config.apiBase} — is \`pnpm dev\` running in server/?`,
      );
    }

    if (!res.ok) {
      throw new DomainError(await this.messageForErrorResponse(res));
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new DomainError(`DevDigest API returned a non-JSON response for ${path}.`);
    }

    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new DomainError(
        `DevDigest API returned an unexpected response shape for ${path}: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  }

  /** Non-2xx → an actionable message. Attempts the structured
   *  `{error:{code,message}}` envelope first (matches `ApiErrorBody`,
   *  `server/src/vendor/shared/contracts/platform.ts`'s shape, confirmed
   *  without importing the vendor file), else falls back to the status
   *  line. */
  private async messageForErrorResponse(res: Response): Promise<string> {
    let bodyMessage: string | undefined;
    try {
      const body: unknown = await res.json();
      if (body && typeof body === 'object' && 'error' in body) {
        const err = (body as { error?: { message?: unknown } }).error;
        if (err && typeof err.message === 'string') bodyMessage = err.message;
      }
    } catch {
      // Non-JSON error body — fall through to the status-line fallback.
    }

    if (res.status === 429) {
      return (
        'Rate limited: DevDigest allows at most 10 review runs per minute from this host ' +
        "(server/src/modules/reviews/routes.ts's per-route limit, shared with any browser-" +
        'triggered run from the same host) — wait a bit and retry.'
      );
    }
    if (res.status === 404) {
      return `Not found (404) — verify the repo/PR/run id and retry.${bodyMessage ? ` ${bodyMessage}` : ''}`;
    }
    return bodyMessage ?? `${res.status} ${res.statusText}`;
  }
}
