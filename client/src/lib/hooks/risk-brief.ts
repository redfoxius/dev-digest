/* hooks/risk-brief.ts — PR Why + Risk Brief (specs/cross-cutting/pr-why-risk-brief).
   Composed LLM `{what, why, risk_level, risks[], review_focus[]}` over a PR's
   already-derived Intent, Blast Radius, diff stats, linked issue, and
   relevant Project Context specs. `GET`/`POST /pulls/:id/brief`.

   Query key deliberately named `pr-risk-brief` — NOT `pr-brief`/`prBrief`,
   both of which already name unrelated, existing things in this codebase
   (the composed-but-unused `PrBrief` contract, and `pulls/routes.ts`'s
   `{score, latest_run_cost_usd, findings, verdict}` aggregate). See
   spec.md's Glossary for the full rationale. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { RiskBrief, RiskBriefGenerateResult } from "@devdigest/shared";

/** Persisted risk brief for a PR, or `null` if never generated. Never
   triggers an LLM call — read-only over the persisted `pr_brief` row. */
export function usePrRiskBrief(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["pr-risk-brief", prId],
    queryFn: () => api.get<RiskBrief | null>(`/pulls/${prId}/brief`),
    enabled: !!prId,
  });
}

/** Generate (or regenerate) a PR's risk brief. `force: true` always issues a
   fresh LLM call, even against a valid cache hit; `force: false`/omitted
   returns a cached brief when the PR's `head_sha` hasn't advanced. On
   success, invalidates both this brief's own query key AND the PR-detail
   (`usePullDetail`, `["pull", prId]`) query key, since `GET /pulls/:id`'s
   `risk_level` field is sourced from this same persisted brief. */
export function useGenerateRiskBrief(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input?: { force?: boolean }) =>
      api.post<RiskBriefGenerateResult>(`/pulls/${prId}/brief`, { force: input?.force ?? false }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pr-risk-brief", prId] });
      qc.invalidateQueries({ queryKey: ["pull", prId] });
    },
  });
}
