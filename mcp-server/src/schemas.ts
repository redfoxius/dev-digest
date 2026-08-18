import { z } from 'zod';

/**
 * Shared input fields every tool that resolves a repo/PR takes — `repo` and
 * `pr` were hand-repeated identically across `run-agent-on-pr.ts`,
 * `get-findings.ts`, `get-blast-radius.ts`, and `get-conventions.ts`
 * (pr-self-review finding on PR #18: zod skill's compose-shared-schemas
 * rule — a real drift risk if the validation rules for either field ever
 * change, since each copy would need to be updated independently).
 */
export const RepoField = z
  .string()
  .describe("GitHub repo in 'owner/name' format, e.g. 'acme/payments-api'. Must already be imported into DevDigest.");

export const PrField = z.number().int().positive().describe('Pull request number within that repo.');
