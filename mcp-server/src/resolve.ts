import { DomainError } from './errors.js';
import type { DevDigestApiClient } from './ports.js';

/**
 * owner/repo + PR number → internal DevDigest uuid resolution. Depends on
 * the `DevDigestApiClient` PORT TYPE (`ports.ts`), never on
 * `http-client.ts`'s concrete `FetchDevDigestApiClient` directly — the
 * onion-architecture fix from docs/mcp-server-plan.md's "Port & Composition
 * Root" section.
 */

export async function resolveRepo(
  client: DevDigestApiClient,
  owner: string,
  name: string,
): Promise<{ repoId: string }> {
  const fullName = `${owner}/${name}`;
  const repos = await client.getRepos();
  const match = repos.find((r) => r.fullName.toLowerCase() === fullName.toLowerCase());
  if (!match) {
    throw new DomainError(
      `Repo '${fullName}' is not imported into DevDigest yet. Add it first via POST /repos ` +
        `(or the studio's 'Add Repo' flow), then retry.`,
    );
  }
  return { repoId: match.id };
}

export async function resolvePull(
  client: DevDigestApiClient,
  repoId: string,
  prNumber: number,
): Promise<{ pullId: string }> {
  const pulls = await client.getRepoPulls(repoId);
  const match = pulls.find((p) => p.number === prNumber);
  if (!match) {
    throw new DomainError(
      `PR #${prNumber} is not imported into DevDigest for this repo yet. Verify the PR ` +
        `number, or import/refresh the repo's pull requests first, then retry.`,
    );
  }
  return { pullId: match.id };
}
