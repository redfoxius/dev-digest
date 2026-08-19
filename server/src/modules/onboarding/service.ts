import type { Onboarding, OnboardingSection, OnboardingTourResponse } from '@devdigest/shared';
import { wrapUntrusted } from '@devdigest/reviewer-core';
import { Onboarding as OnboardingSchema } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import type { FileEdgeRow, SignatureRow } from '../repo-intel/types.js';
import { NotFoundError, NotIndexedError, ExternalServiceError } from '../../platform/errors.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { renderPrompt } from '../../platform/prompts.js';
import { withTimeout, TimeoutError } from '../../platform/resilience.js';
import type { Logger } from '../reviews/run-executor.js';
import { OnboardingRepository, type OnboardingRow } from './repository.js';
import { parseRunFacts, renderRunFactsText } from './run-facts.js';
import {
  TOP_FILES_N,
  MAX_FILE_EDGES,
  MAX_KEY_FILE_EXCERPTS,
  MAX_EXCERPT_CHARS,
  MAX_CALLER_SIGNATURES,
  FACTS_ASSEMBLY_TIMEOUT_MS,
  MAX_SECTION_BODY_CHARS,
  TRUNCATION_MARKER,
  ONBOARDING_SECTION_KINDS,
  type OnboardingSectionKind,
} from './constants.js';

/**
 * Onboarding Generator (docs/onboarding-generator-plan.md) — thin
 * composition over the already-persistent `container.repoIntel` facade and
 * the platform's existing LLM port, mirroring `blast/service.ts`'s own
 * thin-composition shape. Never imports `drizzle-orm` or Fastify types —
 * only `repository.ts` touches the `onboarding` table's Drizzle schema
 * (onion-architecture).
 */

const SECTION_TITLES: Record<OnboardingSectionKind, string> = {
  architecture: 'Architecture overview',
  critical_paths: 'Critical paths',
  how_to_run: 'How to run locally',
  reading_path: 'Guided reading path',
  first_tasks: 'First tasks',
};

export interface AssembledFacts {
  /** Fully-formed markdown sections (heading + `wrapUntrusted`-wrapped
   *  content) ready to join into the user message. */
  sections: string[];
  /** Union of every path present across all assembled facts — WI-7's AC-19
   *  link-grounding filter checks a model-returned link's `path` against
   *  this set before persisting. */
  validPaths: Set<string>;
}

export class OnboardingService {
  private repo: OnboardingRepository;

  constructor(private container: Container) {
    this.repo = new OnboardingRepository(container.db);
  }

  /** GET /repos/:repoId/onboarding — zero LLM calls, ever (AC-1/AC-2/AC-4). */
  async get(workspaceId: string, repoId: string): Promise<OnboardingTourResponse> {
    await this.getOwnedRepo(workspaceId, repoId);

    const [row, indexState] = await Promise.all([
      this.repo.getByRepoId(repoId),
      this.container.repoIntel.getIndexState(repoId),
    ]);

    if (!row) {
      return { tour: null, indexed_sha: null, file_count: null, generated_at: null, provider: null, model: null, stale: false };
    }

    const stale = Boolean(row.indexedSha) && row.indexedSha !== indexState.lastIndexedSha;
    return this.toResponse(row, stale);
  }

  /** POST /repos/:repoId/onboarding/regenerate — always exactly one fresh
   *  `completeStructured` call producing all 5 sections in one response
   *  (AC-5/AC-7); never a cache-hit short-circuit. */
  async regenerate(workspaceId: string, repoId: string, log: Logger): Promise<OnboardingTourResponse> {
    const repoRow = await this.getOwnedRepo(workspaceId, repoId);

    const indexState = await this.container.repoIntel.getIndexState(repoId);
    if (!indexState.lastIndexedSha) throw new NotIndexedError();

    let facts: AssembledFacts;
    try {
      facts = await withTimeout(assembleOnboardingFacts(this.container, repoId), FACTS_ASSEMBLY_TIMEOUT_MS);
    } catch (err) {
      const reason = err instanceof TimeoutError ? 'facts assembly timed out' : (err as Error).message;
      log.error({ repoId, reason }, 'onboarding: facts assembly failed');
      throw new ExternalServiceError(`Onboarding facts assembly failed: ${reason}`);
    }

    const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'onboarding');

    const sectionsVar = ONBOARDING_SECTION_KINDS.map(
      (kind, i) => `${i + 1}. kind="${kind}" — ${SECTION_TITLES[kind]}`,
    ).join('\n');
    const systemPrompt = await renderPrompt('onboarding.system.md', {
      sections: sectionsVar,
      language: 'English',
    });

    let tour: Onboarding;
    let tokensIn: number;
    let tokensOut: number;
    let costUsd: number | null;
    try {
      // `container.llm` is async — resolves the concrete provider from the
      // configured secret key (intent/service.ts's own await shape).
      const llm = await this.container.llm(provider);
      const result = await llm.completeStructured<Onboarding>({
        model,
        schema: OnboardingSchema,
        schemaName: 'Onboarding',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: facts.sections.join('\n\n') },
        ],
        sessionId: `${repoRow.owner}/${repoRow.name}:onboarding`,
      });

      const kinds = result.data.sections.map((s) => s.kind);
      const kindsMatch =
        kinds.length === ONBOARDING_SECTION_KINDS.length &&
        (ONBOARDING_SECTION_KINDS as readonly string[]).every((k, i) => k === kinds[i]);
      if (!kindsMatch) {
        throw new Error(`model returned unexpected section kinds/order: ${JSON.stringify(kinds)}`);
      }

      const sections: OnboardingSection[] = result.data.sections.map((raw, i) =>
        postProcessSection(raw, ONBOARDING_SECTION_KINDS[i]!, facts.validPaths),
      );
      tour = { sections };
      tokensIn = result.tokensIn;
      tokensOut = result.tokensOut;
      costUsd = result.costUsd;
    } catch (err) {
      log.error({ repoId, err: (err as Error).message }, 'onboarding: generation failed');
      throw new ExternalServiceError(`Onboarding generation failed: ${(err as Error).message}`);
    }

    const row = await this.repo.upsert(repoId, {
      json: tour,
      indexedSha: indexState.lastIndexedSha,
      fileCount: indexState.filesIndexed,
      provider,
      model,
      tokensIn,
      tokensOut,
      costUsd,
    });

    return this.toResponse(row, false);
  }

  /** Ownership check mirroring `GET /pulls/:id/blast`'s existing pattern
   *  (AC-3/AC-33) — a repo id from another workspace never resolves. */
  private async getOwnedRepo(workspaceId: string, repoId: string) {
    const repoRow = await this.container.reposRepo.getById(workspaceId, repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');
    return repoRow;
  }

  private toResponse(row: OnboardingRow, stale: boolean): OnboardingTourResponse {
    return {
      tour: row.json as Onboarding,
      indexed_sha: row.indexedSha,
      file_count: row.fileCount,
      generated_at: row.generatedAt.toISOString(),
      provider: row.provider,
      model: row.model,
      stale,
    };
  }
}

/**
 * Assembles the LLM prompt's facts EXCLUSIVELY from already-computed
 * `repo-intel` facade reads plus the new deterministic run-facts extraction
 * — never triggers a fresh index/reindex, and never calls the LLM (AC-11).
 * Every repo-derived piece of text is wrapped via `wrapUntrusted()`
 * (imported directly from `@devdigest/reviewer-core`, matching
 * `intent/service.ts:4`'s own import path — AC-35). Exported as a top-level
 * function (not a private class method) — mirrors `intent/service.ts`'s own
 * `filterRiskFileRefs` precedent, so it's directly unit-testable against a
 * fake `Container`/`repoIntel` without going through a full `regenerate()`
 * round trip (server/test/onboarding-facts.test.ts).
 */
export async function assembleOnboardingFacts(container: Container, repoId: string): Promise<AssembledFacts> {
  const repoMap = await container.repoIntel.getRepoMap(repoId);
  // Reading-path candidates come STRICTLY from `getTopFilesByRank`'s own
  // existing rank/percentile ordering — never re-derived or re-ranked here.
  const topFiles = await container.repoIntel.getTopFilesByRank(repoId, TOP_FILES_N);
  const criticalPaths = await container.repoIntel.getCriticalPaths(repoId);
  const allEdges = await container.repoIntel.getFileEdges(repoId);
  const edges = allEdges.slice(0, MAX_FILE_EDGES);
  const callerSignatures = await container.repoIntel.getCallerSignatures(repoId, topFiles, MAX_CALLER_SIGNATURES);
  const keyFileExcerpts = await fetchKeyFileExcerpts(container, repoId, topFiles);
  const runFacts = await fetchRunFacts(container, repoId);

  const validPaths = buildValidPaths(topFiles, criticalPaths, edges, callerSignatures, keyFileExcerpts);

  const sections: string[] = [];
  if (repoMap.text) {
    sections.push(`## Repo skeleton\n${wrapUntrusted('repo-map', repoMap.text)}`);
  }
  sections.push(
    `## Top-ranked files (reading-path candidates, in rank order)\n${wrapUntrusted(
      'top-files',
      topFiles.length > 0 ? topFiles.join('\n') : '(none — repo has no ranked files)',
    )}`,
  );
  sections.push(
    `## Critical paths (dependency chains from the highest-ranked files)\n${wrapUntrusted(
      'critical-paths',
      criticalPaths.length > 0 ? criticalPaths.map((chain) => chain.join(' -> ')).join('\n') : '(none found)',
    )}`,
  );
  sections.push(
    `## Import graph edges (sample)\n${wrapUntrusted(
      'file-edges',
      edges.length > 0 ? edges.map((e) => `${e.fromFile} -> ${e.toFile}`).join('\n') : '(none found)',
    )}`,
  );
  sections.push(
    `## Callers of top-ranked files\n${wrapUntrusted(
      'callers',
      callerSignatures.length > 0
        ? callerSignatures.map((c) => `${c.file}: ${c.symbol} calls into ${c.signature}`).join('\n')
        : '(none found)',
    )}`,
  );
  sections.push(
    `## Key file excerpts\n${wrapUntrusted(
      'key-file-excerpts',
      keyFileExcerpts.length > 0
        ? keyFileExcerpts.map((e) => `### ${e.path}\n${e.excerpt}`).join('\n\n')
        : '(none available)',
    )}`,
  );
  sections.push(`## How to run locally (deterministic facts)\n${wrapUntrusted('run-facts', renderRunFactsText(runFacts))}`);

  return { sections, validPaths };
}

async function fetchKeyFileExcerpts(
  container: Container,
  repoId: string,
  topFiles: string[],
): Promise<{ path: string; excerpt: string }[]> {
  const out: { path: string; excerpt: string }[] = [];
  for (const path of topFiles.slice(0, MAX_KEY_FILE_EXCERPTS)) {
    const content = await container.repoIntel.getFileContent(repoId, path);
    if (content == null) continue;
    out.push({
      path,
      excerpt: content.length > MAX_EXCERPT_CHARS ? `${content.slice(0, MAX_EXCERPT_CHARS)}…` : content,
    });
  }
  return out;
}

async function fetchRunFacts(container: Container, repoId: string) {
  const [packageJson, envExample, envSample, dockerfile, dockerCompose] = await Promise.all([
    container.repoIntel.getFileContent(repoId, 'package.json'),
    container.repoIntel.getFileContent(repoId, '.env.example'),
    container.repoIntel.getFileContent(repoId, '.env.sample'),
    container.repoIntel.getFileContent(repoId, 'Dockerfile'),
    container.repoIntel.getFileContent(repoId, 'docker-compose.yml'),
  ]);
  return parseRunFacts({ packageJson, envExample, envSample, dockerfile, dockerCompose });
}

/** AC-16 — a non-null `diagram` is persisted only for the `architecture`
 *  section; AC-18 — each `body` is capped at `MAX_SECTION_BODY_CHARS`; AC-19
 *  — a `links[]` entry whose `path` isn't in `validPaths` is dropped. The
 *  section's `kind` is the CANONICAL fixed kind (by position), never trusted
 *  verbatim from the model, even though the caller already validated the
 *  returned kinds match this order. */
function postProcessSection(
  raw: OnboardingSection,
  kind: OnboardingSectionKind,
  validPaths: Set<string>,
): OnboardingSection {
  const body =
    raw.body.length > MAX_SECTION_BODY_CHARS
      ? `${raw.body.slice(0, MAX_SECTION_BODY_CHARS)}${TRUNCATION_MARKER}`
      : raw.body;
  const diagram = kind === 'architecture' ? (raw.diagram ?? null) : null;
  const links = raw.links.filter((l) => validPaths.has(l.path));
  return { kind, title: raw.title, body, diagram, links };
}

function buildValidPaths(
  topFiles: string[],
  criticalPaths: string[][],
  edges: FileEdgeRow[],
  callerSignatures: SignatureRow[],
  keyFileExcerpts: { path: string; excerpt: string }[],
): Set<string> {
  const paths = new Set<string>();
  for (const p of topFiles) paths.add(p);
  for (const chain of criticalPaths) for (const p of chain) paths.add(p);
  for (const e of edges) {
    paths.add(e.fromFile);
    paths.add(e.toFile);
  }
  for (const c of callerSignatures) paths.add(c.file);
  for (const e of keyFileExcerpts) paths.add(e.path);
  return paths;
}
