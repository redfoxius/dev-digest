import { reviewPullRequest } from '@devdigest/reviewer-core';
import { EvalCaseExpectedOutput } from '@devdigest/shared';
import type {
  EvalCase,
  EvalDashboard,
  EvalRun,
  EvalRunRecord,
  EvalRunResult,
  EvalTrendPoint,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import type { AgentRow, EvalCaseRow, EvalRunRow } from '../../db/rows.js';
import { resolveAgentRunConfig } from '../agents/helpers.js';
import { EvalsRepository, type InsertEvalRun } from './repository.js';
import { aggregateBatch, buildAlert, scoreCase, type ScoreResult } from './scoring.js';
import { buildEvalTaskLine, evalRunRowToScoreResult, toEvalCaseDto, toEvalRunRecordDto } from './helpers.js';

/**
 * A4 — evals service. Business logic for eval-case lifecycle, run execution,
 * and the per-agent dashboard (`specs/cross-cutting/eval-pipeline/plan.md`
 * Work Items 4-7, spec §5/§6). Mirrors `RiskBriefService`/`AgentsService`'s
 * shape: never imports Drizzle/Fastify types, reaches other modules' data
 * only via `Container` getters (`container.agentsRepo`, `container.reviewRepo`,
 * `container.diffLoader`, `container.llm`), constructed directly wherever
 * needed (`new EvalsService(container)`) — never a new `Container` getter,
 * same convention as `RiskBriefService`/`BlastService`.
 */

export interface CreateEvalCaseInput {
  name: string;
  input_diff?: string | null;
  input_files?: unknown;
  input_meta?: unknown;
  expected_output?: unknown;
  notes?: string | null;
}

export type UpdateEvalCaseInput = Partial<CreateEvalCaseInput>;

/** The degenerate `EvalRun`/dashboard-`current` shape used whenever there is
 *  nothing to aggregate (AC-15's zero-case run, AC-23's zero-batch dashboard):
 *  ratios default to 1 (vacuous-true, matching `scoreCase`/`aggregateBatch`'s
 *  own zero-denominator rule), counts to 0. */
function degenerateEvalRun(): EvalRun {
  return {
    recall: 1,
    precision: 1,
    citation_accuracy: 1,
    traces_passed: 0,
    traces_total: 0,
    duration_ms: 0,
    cost_usd: null,
    per_trace: [],
  };
}

export class EvalsService {
  private repo: EvalsRepository;

  constructor(private container: Container) {
    this.repo = new EvalsRepository(container.db);
  }

  // ==========================================================================
  // WI-4 — POST /findings/:id/eval-case
  // ==========================================================================

  /**
   * Turn one accepted/dismissed finding into a frozen eval case (AC-1/AC-2).
   * Throws `NotFoundError` on a missing/cross-workspace finding (AC-4) or a
   * review with no owning agent (see the `review.agentId` guard below);
   * `ValidationError` (422) when the finding has neither `accepted_at` nor
   * `dismissed_at` set (AC-3). Lets a thrown `DiffUnavailableError` from
   * `container.diffLoader.load` propagate UNHANDLED (AC-5) — `app.ts`'s
   * error handler already converts any `AppError` subclass to the right HTTP
   * status with zero extra plumbing (`server/INSIGHTS.md` 2026-08-17).
   */
  async createFromFinding(workspaceId: string, findingId: string): Promise<EvalCase> {
    const ctx = await this.container.reviewRepo.findingContext(findingId);
    if (!ctx || ctx.pull.workspaceId !== workspaceId) {
      throw new NotFoundError('Finding not found');
    }
    const { finding, review, pull } = ctx;

    if (!finding.acceptedAt && !finding.dismissedAt) {
      throw new ValidationError('Finding must be accepted or dismissed before it can become an eval case');
    }

    // `reviews.agent_id` is nullable at the schema level (a future non-agent
    // review kind), even though the one existing call site
    // (`run-executor.ts`'s `insertReview`) always sets it for a real
    // agent-produced review today. Reject explicitly rather than silently
    // persisting `owner_id: null` — an eval case has no owner without one.
    if (!review.agentId) {
      throw new NotFoundError('This finding has no owning agent — cannot create an eval case from it');
    }

    const repoRow = await this.container.reviewRepo.getRepo(pull.repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');

    const diff = await this.container.diffLoader.load(this.container.reviewRepo, workspaceId, pull, repoRow);

    const expectedOutput = {
      expectations: [
        {
          type: finding.acceptedAt ? ('must_find' as const) : ('must_not_flag' as const),
          file: finding.file,
          start_line: finding.startLine,
          end_line: finding.endLine,
          description: finding.title,
        },
      ],
    };

    const prFiles = await this.container.reviewRepo.getPrFiles(pull.id);
    const inputFiles = prFiles.map((f) => ({
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch,
    }));
    const inputMeta = {
      repo: `${repoRow.owner}/${repoRow.name}`,
      pr_number: pull.number,
      title: pull.title,
      head_sha: pull.headSha,
    };

    const row = await this.repo.insertCase({
      workspaceId,
      ownerId: review.agentId,
      name: finding.title,
      inputDiff: diff.raw,
      inputFiles,
      inputMeta,
      expectedOutput,
      notes: null,
    });
    return toEvalCaseDto(row);
  }

  // ==========================================================================
  // WI-5 — manual case CRUD + listing
  // ==========================================================================

  /** `undefined` (route -> 404) when the agent isn't in this workspace
   *  (AC-24), mirroring `AgentsService`'s own `get`/`update` pattern. */
  async listCases(workspaceId: string, agentId: string): Promise<EvalCase[] | undefined> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const rows = await this.repo.listCases(workspaceId, agentId);
    return rows.map(toEvalCaseDto);
  }

  /** `owner_kind`/`owner_id` are ALWAYS derived from the route's `:id`
   *  (`agentId`) — `CreateEvalCaseInput` has no owner fields to trust in
   *  the first place (AC-6). */
  async createCase(
    workspaceId: string,
    agentId: string,
    input: CreateEvalCaseInput,
  ): Promise<EvalCase | undefined> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    this.assertExpectedOutputValid(input.expected_output);
    const row = await this.repo.insertCase({
      workspaceId,
      ownerId: agentId,
      name: input.name,
      inputDiff: input.input_diff ?? null,
      inputFiles: input.input_files,
      inputMeta: input.input_meta,
      expectedOutput: input.expected_output,
      notes: input.notes ?? null,
    });
    return toEvalCaseDto(row);
  }

  async updateCase(
    workspaceId: string,
    agentId: string,
    caseId: string,
    patch: UpdateEvalCaseInput,
  ): Promise<EvalCase | undefined> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const existing = await this.repo.getCase(workspaceId, caseId);
    if (!existing || existing.ownerId !== agentId) return undefined;
    if (patch.expected_output !== undefined) this.assertExpectedOutputValid(patch.expected_output);

    const row = await this.repo.updateCase(workspaceId, caseId, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.input_diff !== undefined ? { inputDiff: patch.input_diff } : {}),
      ...(patch.input_files !== undefined ? { inputFiles: patch.input_files } : {}),
      ...(patch.input_meta !== undefined ? { inputMeta: patch.input_meta } : {}),
      ...(patch.expected_output !== undefined ? { expectedOutput: patch.expected_output } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    });
    return row ? toEvalCaseDto(row) : undefined;
  }

  /** Relies entirely on the existing `eval_runs.case_id` `ON DELETE CASCADE`
   *  (AC-8) — no manual run cleanup here. */
  async deleteCase(workspaceId: string, agentId: string, caseId: string): Promise<boolean> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) return false;
    const existing = await this.repo.getCase(workspaceId, caseId);
    if (!existing || existing.ownerId !== agentId) return false;
    return this.repo.deleteCase(workspaceId, caseId);
  }

  /** AC-10 — `expected_output`'s documented `{ expectations: EvalExpectation[] }`
   *  shape is validated HERE (service-level `safeParse`), not just `z.unknown()`
   *  at the route/`EvalCaseInput` boundary (the repo's established two-layer
   *  validation convention, `agents/service.ts`'s `assertPathsAttachable`).
   *  `null`/`undefined` (no expectations authored yet) is allowed through —
   *  only a genuinely malformed non-empty value is rejected. */
  private assertExpectedOutputValid(expectedOutput: unknown): void {
    if (expectedOutput === undefined || expectedOutput === null) return;
    const parsed = EvalCaseExpectedOutput.safeParse(expectedOutput);
    if (!parsed.success) {
      throw new ValidationError(
        'expected_output must be shaped as { expectations: EvalExpectation[] }',
        parsed.error.flatten(),
      );
    }
  }

  // ==========================================================================
  // WI-6 — run execution (single case + whole set)
  // ==========================================================================

  /** `POST /agents/:id/eval-cases/:caseId/run` (N=1). `undefined` (route ->
   *  404) when the agent OR the case (scoped to that agent) isn't found.
   *  Returns the `EvalRunResult` wrapper (spec §10/AC-11) — the aggregate
   *  `EvalRun` (identical in shape to `runAll`'s, degenerate to a single
   *  trace here) PLUS the specific persisted `eval_runs` row's real id,
   *  located from `runCases`' own `insertRunBatch(...)`-returned rows
   *  (their `.returning()` already carries each row's DB-generated `id`) —
   *  no second query needed. */
  async runOne(workspaceId: string, agentId: string, caseId: string): Promise<EvalRunResult | undefined> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const row = await this.repo.getCase(workspaceId, caseId);
    if (!row || row.ownerId !== agentId) return undefined;
    const { aggregate, rows } = await this.runCases(agent, [row]);
    // `runCases` was called with exactly one case, so `insertRunBatch` always
    // persists exactly one row for it (success or isolated failure, AC-14) —
    // this lookup cannot miss in practice.
    const persisted = rows.find((r) => r.caseId === caseId);
    return { run_id: persisted?.id ?? '', case_id: caseId, result: aggregate };
  }

  /** `POST /agents/:id/eval-runs` (N=all). `undefined` (route -> 404) when
   *  the agent isn't in this workspace. Returns the aggregate `EvalRun`
   *  ONLY — no per-run id wrapper (that's `runOne`'s single-case contract,
   *  AC-11; AC-12's batch contract is unchanged). */
  async runAll(workspaceId: string, agentId: string): Promise<EvalRun | undefined> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const rows = await this.repo.listCases(workspaceId, agentId);
    const { aggregate } = await this.runCases(agent, rows);
    return aggregate;
  }

  /**
   * Shared execution core for both `runOne` (N=1) and `runAll` (N=all) —
   * same flow, different case-set size (spec §5's own framing). Deliberately
   * omits everything repo-bound (callers-digest, repo-map/rankNote,
   * context-docs/specs, Intent Layer text) — an eval case has no bound live
   * repo (spec §4/§12).
   *
   * Reuses `reviewer-core`'s `reviewPullRequest` DIRECTLY (never
   * `ReviewRunExecutor`) and scores with zero further LLM calls
   * (`scoring.ts`). `expected_output`/`EvalExpectation` data is read ONLY by
   * the pure scoring step below — never threaded into `reviewPullRequest`'s
   * `messages`/prompt (spec §11 — no new prompt-injection surface).
   *
   * Returns both the aggregate `EvalRun` AND the persisted `eval_runs` rows
   * (`insertRunBatch`'s own `.returning()` result, real DB-generated `id`s
   * included) — `runOne` needs the latter to locate its one case's row id
   * for the `EvalRunResult` wrapper (AC-11); `runAll` uses only the former.
   */
  private async runCases(
    agent: AgentRow,
    cases: EvalCaseRow[],
  ): Promise<{ aggregate: EvalRun; rows: EvalRunRow[] }> {
    if (cases.length === 0) return { aggregate: degenerateEvalRun(), rows: [] };

    const rows: InsertEvalRun[] = [];
    const scores: ScoreResult[] = [];
    const perTrace: EvalRun['per_trace'] = [];

    for (const c of cases) {
      const start = Date.now();
      try {
        const diff = parseUnifiedDiff(c.inputDiff ?? '');
        const config = await resolveAgentRunConfig(
          (p) => this.container.llm(p),
          this.container.agentsRepo,
          agent,
          diff.files.map((f) => f.path),
        );

        const parsedExpectedOutput = EvalCaseExpectedOutput.safeParse(c.expectedOutput);
        const expectations = parsedExpectedOutput.success ? parsedExpectedOutput.data.expectations : [];

        const outcome = await reviewPullRequest({
          systemPrompt: config.systemPrompt,
          model: config.model,
          diff,
          llm: config.llm,
          strategy: config.strategy,
          ...(config.skills.length ? { skills: config.skills } : {}),
          task: buildEvalTaskLine(c.inputMeta),
        });

        const durationMs = Date.now() - start;
        const grounded = outcome.review.findings.length;
        const dropped = outcome.dropped.length;
        const score = scoreCase(expectations, outcome.review.findings, grounded, dropped);

        const actualOutput = {
          findings: outcome.review.findings,
          must_find_matched: score.mustFindMatched,
          must_find_total: score.mustFindTotal,
          noise_count: score.noiseCount,
          kept: grounded,
          dropped,
        };

        rows.push({
          caseId: c.id,
          actualOutput,
          pass: score.pass,
          recall: score.recall,
          precision: score.precision,
          citationAccuracy: score.citationAccuracy,
          durationMs,
          costUsd: outcome.costUsd,
        });
        scores.push({
          failed: false,
          pass: score.pass,
          mustFindMatched: score.mustFindMatched,
          mustFindTotal: score.mustFindTotal,
          noiseCount: score.noiseCount,
          actualFindingsTotal: score.actualFindingsTotal,
          grounded,
          dropped,
          durationMs,
          costUsd: outcome.costUsd,
        });
        perTrace.push({ name: c.name, pass: score.pass, expected: c.expectedOutput ?? null, actual: actualOutput });
      } catch (err) {
        // AC-14 — a diff-parse failure OR a `reviewPullRequest` throw
        // (provider error, timeout, exhausted structured-output retries)
        // is isolated to this one case; the batch continues.
        const durationMs = Date.now() - start;
        const message = err instanceof Error ? err.message : String(err);
        const actualOutput = { error: message };

        rows.push({
          caseId: c.id,
          actualOutput,
          pass: false,
          recall: null,
          precision: null,
          citationAccuracy: null,
          durationMs,
          costUsd: null,
        });
        scores.push({
          failed: true,
          pass: false,
          mustFindMatched: 0,
          mustFindTotal: 0,
          noiseCount: 0,
          actualFindingsTotal: 0,
          grounded: 0,
          dropped: 0,
          durationMs,
          costUsd: null,
        });
        perTrace.push({ name: c.name, pass: false, expected: c.expectedOutput ?? null, actual: actualOutput });
      }
    }

    // ONE transactional multi-row insert AFTER every case has run (success or
    // isolated failure) — gives every row in this batch a shared `ran_at`
    // (WI-2's `insertRunBatch`), never held open across the LLM calls above.
    const insertedRows = await this.repo.insertRunBatch(rows);

    const agg = aggregateBatch(scores);
    const aggregate: EvalRun = {
      recall: agg.recall,
      precision: agg.precision,
      citation_accuracy: agg.citationAccuracy,
      traces_passed: agg.tracesPassed,
      traces_total: agg.tracesTotal,
      duration_ms: agg.durationMs,
      cost_usd: agg.costUsd,
      per_trace: perTrace,
    };
    return { aggregate, rows: insertedRows };
  }

  // ==========================================================================
  // WI-7 — GET /agents/:id/eval-dashboard
  // ==========================================================================

  async getDashboard(workspaceId: string, agentId: string): Promise<EvalDashboard | undefined> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) return undefined;

    const caseRows = await this.repo.listCases(workspaceId, agentId);
    const caseNameById = new Map(caseRows.map((c) => [c.id, c.name]));
    const caseIds = caseRows.map((c) => c.id);
    const runRows = await this.repo.listRunsByCaseIds(caseIds);

    if (runRows.length === 0) {
      return {
        owner_kind: 'agent',
        owner_id: agentId,
        cases_total: caseRows.length,
        current: { recall: 1, precision: 1, citation_accuracy: 1, traces_passed: 0, traces_total: 0, cost_usd: null },
        delta: { recall: 0, precision: 0, citation_accuracy: 0 },
        trend: [],
        recent_runs: [],
        alert: null,
      };
    }

    // Group into batches by EXACT `ran_at` equality — a plain JS Map, never a
    // SQL GROUP BY/sum() (this repo's established "small aggregate over a
    // short list" idiom, `server/INSIGHTS.md` 2026-08-04, `pulls/routes.ts`).
    const batchesByRanAt = new Map<string, EvalRunRow[]>();
    for (const run of runRows) {
      const key = run.ranAt.toISOString();
      const list = batchesByRanAt.get(key);
      if (list) list.push(run);
      else batchesByRanAt.set(key, [run]);
    }
    const orderedRanAt = [...batchesByRanAt.keys()].sort(); // ISO strings sort chronologically

    const batchAggregates = orderedRanAt.map((ranAt) => {
      const runs = batchesByRanAt.get(ranAt)!;
      return { ranAt, agg: aggregateBatch(runs.map(evalRunRowToScoreResult)) };
    });

    const trend: EvalTrendPoint[] = batchAggregates.map(({ ranAt, agg }) => ({
      ran_at: ranAt,
      recall: agg.recall,
      precision: agg.precision,
      citation_accuracy: agg.citationAccuracy,
      pass_rate: agg.tracesTotal === 0 ? 1 : agg.tracesPassed / agg.tracesTotal,
      cost_usd: agg.costUsd,
    }));

    const latest = batchAggregates[batchAggregates.length - 1]!.agg;
    const previous = batchAggregates.length >= 2 ? batchAggregates[batchAggregates.length - 2]!.agg : null;

    const alert = buildAlert(
      { recall: latest.recall, precision: latest.precision, citation_accuracy: latest.citationAccuracy },
      previous
        ? { recall: previous.recall, precision: previous.precision, citation_accuracy: previous.citationAccuracy }
        : null,
    );

    const recentRuns: EvalRunRecord[] = runRows
      .slice()
      .sort((a, b) => b.ranAt.getTime() - a.ranAt.getTime())
      .map((r) => toEvalRunRecordDto(r, caseNameById.get(r.caseId) ?? null));

    return {
      owner_kind: 'agent',
      owner_id: agentId,
      cases_total: caseRows.length,
      current: {
        recall: latest.recall,
        precision: latest.precision,
        citation_accuracy: latest.citationAccuracy,
        traces_passed: latest.tracesPassed,
        traces_total: latest.tracesTotal,
        cost_usd: latest.costUsd,
      },
      delta: {
        recall: previous ? latest.recall - previous.recall : 0,
        precision: previous ? latest.precision - previous.precision : 0,
        citation_accuracy: previous ? latest.citationAccuracy - previous.citationAccuracy : 0,
      },
      trend,
      recent_runs: recentRuns,
      alert,
    };
  }
}
