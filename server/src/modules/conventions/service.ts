import type {
  ConventionCandidate,
  CreateSkillFromConventionsBody,
  ExtractConventionsResponse,
  Skill,
  SkillDraftFromConventions,
  UpdateConventionBody,
} from '@devdigest/shared';
// Imported as a value (not `import type`) — `RawConventionCandidate` is both
// the zod schema used below AND, via name merging, the inferred type used as
// `proposeRawCandidates`'s return type.
import { RawConventionCandidate } from '@devdigest/shared';
import { z } from 'zod';
import type { Container } from '../../platform/container.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { toSkillDto } from '../skills/helpers.js';
import { ConventionsRepository, dedupKey, type InsertConvention } from './repository.js';
import { buildSkillBody, findEvidenceLineRange, slugifyRule, toConventionDto } from './helpers.js';
import { allConfigFileCandidates, parseConfigFile, type ConfigCandidateDraft } from './langs/index.js';
import { SAMPLE_FILE_COUNT } from './constants.js';

/**
 * Conventions service. `extract()` runs two independent candidate pools per
 * repo scan (Decision 10, docs/conventions-extractor-plan.md):
 *  - `origin: 'config'` — deterministic parsers over eslint/tsconfig/prettier,
 *    no model call, `confidence: 1`, skips evidence verification (the
 *    "evidence" IS the config file, read directly).
 *  - `origin: 'model'` — a cheap-model pass over the top-ranked sample files,
 *    then code-only evidence verification (exact → fuzzy line match); a
 *    candidate whose evidence can't be located in the clone is discarded
 *    before it's ever persisted.
 * Re-scan never touches already-triaged (`accepted`/`rejected`) rows — it
 * only inserts new candidates not already covered by `dedupKey`.
 */
export class ConventionsService {
  private repo: ConventionsRepository;

  constructor(private container: Container) {
    this.repo = new ConventionsRepository(container.db);
  }

  async list(
    workspaceId: string,
    repoId: string,
    filters?: { status?: ConventionCandidate['status']; category?: ConventionCandidate['category'] },
  ): Promise<ConventionCandidate[]> {
    const rows = await this.repo.list(workspaceId, repoId, filters ?? {});
    return rows.map(toConventionDto);
  }

  async updateCandidate(
    workspaceId: string,
    id: string,
    patch: UpdateConventionBody,
  ): Promise<ConventionCandidate> {
    const row = await this.repo.updatePatch(workspaceId, id, patch);
    if (!row) throw new NotFoundError('Convention candidate not found');
    return toConventionDto(row);
  }

  async extract(workspaceId: string, repoId: string): Promise<ExtractConventionsResponse> {
    const existingKeys = await this.repo.existingDedupKeys(repoId);
    const toInsert: InsertConvention[] = [];
    let sampleFileCount = 0;

    // ---- Pool 1: deterministic config-derived candidates (no model call) --
    const configDrafts: ConfigCandidateDraft[] = [];
    for (const candidatePath of allConfigFileCandidates()) {
      const content = await this.container.repoIntel.getFileContent(repoId, candidatePath);
      if (content == null) continue;
      sampleFileCount++;
      configDrafts.push(...parseConfigFile(candidatePath, content));
    }
    for (const draft of configDrafts) {
      const key = dedupKey(draft.rule, draft.evidence_path);
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      toInsert.push({
        workspaceId,
        repoId,
        rule: draft.rule,
        category: draft.category,
        evidencePath: draft.evidence_path,
        evidenceSnippet: draft.evidence_snippet,
        evidenceLineStart: draft.evidence_line_start,
        evidenceLineEnd: draft.evidence_line_end,
        confidence: draft.confidence,
        status: 'accepted',
        origin: 'config',
      });
    }

    // ---- Pool 2: cheap-model candidates over top-ranked sample files ------
    // Stratified by language (Phase 7.3, docs/go-language-support-plan.md) —
    // plain top-rank sampling can crowd a less-central language's files
    // entirely out of a mixed-language repo's sample.
    const sampleFiles = await this.container.repoIntel.getConventionSamplesStratified(
      repoId,
      SAMPLE_FILE_COUNT,
    );
    const sampleContents: { file: string; content: string }[] = [];
    for (const file of sampleFiles) {
      const content = await this.container.repoIntel.getFileContent(repoId, file);
      if (content == null) continue;
      sampleContents.push({ file, content });
    }
    sampleFileCount += sampleContents.length;

    if (sampleContents.length > 0) {
      const raw = await this.proposeRawCandidates(workspaceId, sampleContents);
      for (const candidate of raw) {
        const content = sampleContents.find((s) => s.file === candidate.evidence_path)?.content;
        // The model is instructed to only cite files it was shown, but it can
        // still hallucinate a path — no matching sample content means the
        // evidence can't be verified, discard.
        if (content == null) continue;
        const range = findEvidenceLineRange(content, candidate.evidence_snippet);
        if (range == null) continue; // no code-level evidence found — discard

        const key = dedupKey(candidate.rule, candidate.evidence_path);
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);
        toInsert.push({
          workspaceId,
          repoId,
          rule: candidate.rule,
          category: candidate.category,
          evidencePath: candidate.evidence_path,
          evidenceSnippet: candidate.evidence_snippet,
          evidenceLineStart: range.start,
          evidenceLineEnd: range.end,
          confidence: candidate.confidence,
          // Unlike the deterministic config pool, `rule`/`category` here are
          // LLM output over attacker-influenceable repo content — only
          // `evidence_snippet` is verified against the clone, not the prose
          // itself. Land as 'pending' so a human reviews/accepts before it
          // can ever reach a skill (createSkillFromCandidates only bundles
          // 'accepted' rows) and become a persistent instruction fed back
          // into future review prompts (OWASP Agentic AI ASI09).
          status: 'pending',
          origin: 'model',
        });
      }
    }

    await this.repo.bulkInsert(toInsert);
    const all = await this.repo.list(workspaceId, repoId);
    return {
      candidates: all.map(toConventionDto),
      sample_file_count: sampleFileCount,
      scanned_at: new Date().toISOString(),
    };
  }

  private async proposeRawCandidates(
    workspaceId: string,
    sampleContents: { file: string; content: string }[],
  ): Promise<RawConventionCandidate[]> {
    const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'conventions');
    const llm = await this.container.llm(provider);

    const filesBlock = sampleContents
      .map(({ file, content }) => `--- ${file} ---\n${content}`)
      .join('\n\n');

    const schema = z.object({ candidates: z.array(RawConventionCandidate) });

    const result = await llm.completeStructured({
      model,
      schema,
      schemaName: 'convention_candidates',
      messages: [
        {
          role: 'system',
          content:
            'You extract house coding conventions from a repository sample. ' +
            'For each convention you notice, cite the EXACT code you can see below — ' +
            'copy the snippet verbatim from the file content shown, do not paraphrase or invent it. ' +
            'One rule per finding. `evidence_path` MUST be one of the file paths shown below, exactly as written. ' +
            '`category` MUST be one of: naming, error-handling, api-shape, imports, testing, security, formatting, architecture, type-safety. ' +
            '`confidence` is your own 0-1 estimate of how consistently this convention holds across the sample.',
        },
        { role: 'user', content: filesBlock },
      ],
    });

    return result.data.candidates;
  }

  async buildSkillDraft(
    workspaceId: string,
    repoId: string,
    candidateIds: string[],
  ): Promise<SkillDraftFromConventions> {
    const rows = await this.repo.getByIds(workspaceId, candidateIds);
    const candidates = rows.map(toConventionDto).filter((c) => c.status === 'accepted');
    if (candidates.length === 0) {
      throw new ValidationError('No accepted candidates among the given ids');
    }
    // Falls back to the raw repoId only if the repo row is somehow gone —
    // client/UI lets the user rename before saving either way.
    const repoRow = await this.container.reposRepo.getById(workspaceId, repoId);
    const repoSlug = repoRow ? slugifyRule(repoRow.fullName) : repoId;
    const name = `${repoSlug}-conventions`;
    const body = buildSkillBody(name, candidates);
    return {
      name,
      description: `${candidates.length} house convention(s) extracted from this repo.`,
      body,
      token_count: estimateTokenCount(body),
    };
  }

  async createSkillFromCandidates(
    workspaceId: string,
    input: CreateSkillFromConventionsBody,
  ): Promise<Skill> {
    // Defense in depth: only ever bundle candidates that are BOTH in the
    // given id list AND still `status: 'accepted'` right now — a client
    // could pass a stale/rejected id, this must never leak into the skill.
    const rows = await this.repo.getByIds(workspaceId, input.candidate_ids);
    const acceptedCount = rows.filter((r) => r.status === 'accepted').length;
    if (acceptedCount === 0) {
      throw new ValidationError('No accepted candidates among the given ids');
    }

    const row = await this.container.skillsRepo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      type: input.type,
      body: input.body,
      source: 'extracted',
      enabled: input.enabled,
    });
    return toSkillDto(row);
  }
}

/** Rough token estimate (chars/4) for the draft's live token counter — not
 *  billed anywhere, just a UI hint, so a cheap heuristic is fine. */
function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}
