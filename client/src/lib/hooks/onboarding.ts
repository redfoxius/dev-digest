/* hooks/onboarding.ts — React Query hooks for the Onboarding Generator
   (server/src/modules/onboarding/routes.ts):
     GET  /repos/:repoId/onboarding             → persisted tour (or null), zero LLM calls
     POST /repos/:repoId/onboarding/regenerate  → exactly one fresh LLM call, replaces the tour
   See docs/onboarding-generator-plan.md. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { OnboardingTourResponse } from "@devdigest/shared";

const queryKeyFor = (repoId: string | null | undefined) => ["onboarding", repoId];

/** The persisted tour for a repo (or `tour: null` when never generated) —
   never triggers an LLM call. Callers must destructure the FULL
   `data/isLoading/isError/error/refetch` shape (not just `data/isLoading`)
   so a fetch failure doesn't silently degrade into the empty-state copy
   (client/INSIGHTS.md, 2026-08-06 entry). */
export function useOnboardingTour(repoId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeyFor(repoId),
    queryFn: () => api.get<OnboardingTourResponse>(`/repos/${repoId}/onboarding`),
    enabled: !!repoId,
  });
}

/** Always performs exactly one fresh LLM generation and replaces the repo's
   persisted tour — never a cache-hit short-circuit (AC-7). On success, seeds
   the `useOnboardingTour` query's cache directly, mirroring
   `useReindexContextDocs`'s `qc.setQueryData(...)` shape
   (`lib/hooks/context-docs.ts`). On failure (e.g. a 502 from a bad/timed-out
   generation), TanStack Query never touches the cache on a rejected
   mutation — the previously-fetched/cached tour is left completely
   untouched (AC-9), so the page keeps rendering whatever was last shown. */
export function useRegenerateTour(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<OnboardingTourResponse>(`/repos/${repoId}/onboarding/regenerate`),
    onSuccess: (data) => {
      qc.setQueryData(queryKeyFor(repoId), data);
    },
  });
}
