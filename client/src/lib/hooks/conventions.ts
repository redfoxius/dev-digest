/* hooks/conventions.ts — React Query hooks for the Conventions Extractor
   (server/src/modules/conventions/routes.ts):
     POST /repos/:id/conventions/extract         → run extraction (config + cheap-model pools)
     GET  /repos/:id/conventions                 → list candidates
     PATCH /conventions/:id                      → edit rule/category or accept/reject
     POST /repos/:id/conventions/skill-draft     → prefilled, editable skill draft
     POST /repos/:id/conventions/skill           → persist the skill (source: 'extracted')
   See docs/conventions-extractor-plan.md. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  ConventionCandidate,
  CreateSkillFromConventionsBody,
  ExtractConventionsResponse,
  Skill,
  SkillDraftFromConventions,
  UpdateConventionBody,
} from "@devdigest/shared";

export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["conventions", repoId],
    queryFn: () => api.get<ConventionCandidate[]>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
  });
}

/** Runs both the deterministic config-parser pool and the cheap-model pool
   (see docs/conventions-extractor-plan.md, Decision 10) and returns the
   repo's full candidate list. Also used as "Re-scan" — never touches rows
   already accepted/rejected, only inserts new deduped ones. */
export function useExtractConventions(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<ExtractConventionsResponse>(`/repos/${repoId}/conventions/extract`),
    onSuccess: (data) => {
      qc.setQueryData(["conventions", repoId], data.candidates);
    },
  });
}

export interface UpdateConventionInput {
  id: string;
  patch: UpdateConventionBody;
}

/** Accept/reject a candidate, or edit its rule/category text. */
export function useUpdateConvention(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateConventionInput) => api.patch<ConventionCandidate>(`/conventions/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conventions", repoId] }),
  });
}

/** Prefilled, editable draft (name/description/body) merged from the given
   accepted candidates — nothing persisted yet, matches the "Create skill
   from conventions" modal's preview step. */
export function useSkillDraftFromConventions(repoId: string | null | undefined) {
  return useMutation({
    mutationFn: (candidateIds: string[]) =>
      api.post<SkillDraftFromConventions>(`/repos/${repoId}/conventions/skill-draft`, {
        candidate_ids: candidateIds,
      }),
  });
}

/** Persists the (possibly user-edited) draft as a new Skill (`source:
   'extracted'`). Linking it to an agent happens separately, via the
   existing Agent Editor Skills tab — not part of this mutation. */
export function useCreateSkillFromConventions(repoId: string | null | undefined) {
  return useMutation({
    mutationFn: (body: CreateSkillFromConventionsBody) =>
      api.post<Skill>(`/repos/${repoId}/conventions/skill`, body),
  });
}
