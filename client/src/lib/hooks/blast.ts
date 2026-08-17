/* hooks/blast.ts — Blast Radius (which symbols a PR's diff changed, who
   calls them, and which HTTP endpoints/cron jobs are reachable from those
   callers) for the PR page's "Blast" tab. docs/blast-radius-plan.md. */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { BlastRadiusResponse } from "@devdigest/shared";

/** Blast-radius map for a PR. Read-only over the already-persisted
   repo-intel index — cheap to fetch, no LLM call on this path. */
export function usePrBlastRadius(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["pr-blast-radius", prId],
    queryFn: () => api.get<BlastRadiusResponse>(`/pulls/${prId}/blast`),
    enabled: !!prId,
  });
}
