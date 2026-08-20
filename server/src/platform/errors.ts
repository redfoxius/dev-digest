/**
 * Domain error taxonomy + structured API error envelope. The UX taxonomy
 * (toast/inline/full-screen) is the frontend's concern; the API returns a
 * stable structured body (ApiErrorBody): { error: { code, message, details } }.
 */

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found', details?: unknown) {
    super('not_found', message, 404, details);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: unknown) {
    super('validation_error', message, 422, details);
  }
}

export class ExternalServiceError extends AppError {
  constructor(message: string, details?: unknown) {
    super('external_service_error', message, 502, details);
  }
}

export class ConfigError extends AppError {
  constructor(message: string, details?: unknown) {
    super('config_error', message, 500, details);
  }
}

/**
 * Layer 3 (fail-loud guardrail, docs/pr-diff-reindex-plan.md) — thrown by
 * `diff-loader.ts`'s `loadDiff()` when both the active git reindex (Layer 1)
 * and the live GitHub refresh (Layer 2) still leave the diff empty. Refusing
 * to hand an empty diff to the reviewer prevents a silent false-clean verdict
 * (the PR #18 regression this plan fixes) — the caller (`run-executor.ts`'s
 * pre-work try/catch, or `deriveIntent()`'s route handler via Fastify's
 * error handler) is expected to surface this as a real failure, not degrade.
 */
export class DiffUnavailableError extends AppError {
  constructor(owner: string, name: string, prNumber: number) {
    super(
      'diff_unavailable',
      `Diff pipeline returned no changed files for ${owner}/${name}#${prNumber} even after an active git reindex and a live GitHub refresh — refusing to hand an empty diff to the reviewer (would produce a false 'clean' verdict). Check clone/GitHub token connectivity, or confirm this PR genuinely has zero changed files, then retry.`,
      502,
    );
  }
}

/**
 * Thrown by `OnboardingService.regenerate` (docs/onboarding-generator-plan.md
 * Work Item 1, AC-6) when a repo's `repo-intel` index has no resolvable
 * `indexed_sha` (never indexed) — Regenerate must reject outright before any
 * facts read or LLM call, never attempt a low-quality generation over empty
 * facts. Fastify's existing `err instanceof AppError` handler
 * (`app.ts:153-158`) already surfaces this as a real `422` with zero
 * per-route plumbing, mirroring `DiffUnavailableError`'s own zero-plumbing
 * addition (`server/INSIGHTS.md`, 2026-08-17 entry).
 */
export class NotIndexedError extends AppError {
  constructor(message = 'This repo has not been indexed yet — index it before generating a tour.') {
    super('not_indexed', message, 422);
  }
}
