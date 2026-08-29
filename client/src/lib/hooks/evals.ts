/* hooks/evals.ts — TanStack Query hooks for the Eval Pipeline
   (specs/cross-cutting/eval-pipeline). One file per API domain, mirroring
   `lib/hooks/agents.ts`'s useQuery/useMutation + api.get/post/put/del shape,
   including its convention of taking the owning resource's id as a HOOK
   parameter (not a mutate()-time variable) — see `useAgentSkills(agentId)`/
   `useSetAgentSkillEnabled(agentId)`.

   Endpoints covered (server/src/modules/evals/routes.ts):
     POST   /findings/:id/eval-case
     GET    /agents/:id/eval-cases
     POST   /agents/:id/eval-cases
     PUT    /agents/:id/eval-cases/:caseId
     DELETE /agents/:id/eval-cases/:caseId
     POST   /agents/:id/eval-cases/:caseId/run
     POST   /agents/:id/eval-runs
     GET    /agents/:id/eval-dashboard */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { EvalCase, EvalCaseInput, EvalDashboard, EvalRun } from "@devdigest/shared";

/** Manual create/update body — `owner_kind`/`owner_id` are always derived
   server-side from the route's `:id`, so callers never supply them (matches
   `EvalsService.createCase`/`updateCase`, which ignore anything a client
   sends for those two fields). */
export type EvalCaseFormInput = Omit<EvalCaseInput, "owner_kind" | "owner_id">;

// ---- Turn a finding into an eval case ----

/** `POST /findings/:id/eval-case` — turns an accepted/dismissed finding into
   a frozen eval case (AC-1/AC-2). The owning agent isn't known until the
   response arrives, so invalidation targets the returned `owner_id`. */
export function useCreateEvalCaseFromFinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (findingId: string) => api.post<EvalCase>(`/findings/${findingId}/eval-case`),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["eval-cases", data.owner_id] });
    },
  });
}

// ---- Manual eval-case CRUD + listing ----

/** `GET /agents/:id/eval-cases`. */
export function useEvalCases(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-cases", agentId],
    queryFn: () => api.get<EvalCase[]>(`/agents/${agentId}/eval-cases`),
    enabled: !!agentId,
  });
}

/** `POST /agents/:id/eval-cases`. */
export function useCreateEvalCase(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EvalCaseFormInput) => api.post<EvalCase>(`/agents/${agentId}/eval-cases`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["eval-cases", agentId] }),
  });
}

export interface UpdateEvalCaseMutationInput {
  caseId: string;
  patch: Partial<EvalCaseFormInput>;
}

/** `PUT /agents/:id/eval-cases/:caseId`. */
export function useUpdateEvalCase(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId, patch }: UpdateEvalCaseMutationInput) =>
      api.put<EvalCase>(`/agents/${agentId}/eval-cases/${caseId}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["eval-cases", agentId] }),
  });
}

/** `DELETE /agents/:id/eval-cases/:caseId`. */
export function useDeleteEvalCase(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caseId: string) => api.del<{ ok: boolean }>(`/agents/${agentId}/eval-cases/${caseId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["eval-cases", agentId] }),
  });
}

// ---- Run execution ----

/** `POST /agents/:id/eval-cases/:caseId/run` (N=1).
   NOTE: the route's real, current handler (`evals/routes.ts`) returns a bare
   `EvalRun` — NOT the `EvalRunResult` wrapper (`{run_id, case_id, result}`)
   spec §10 describes. That's a known, already-flagged spec/implementation
   discrepancy pending a fix-loop review; this hook's return type matches
   what the route actually returns today, not the spec. */
export function useRunEvalCase(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caseId: string) => api.post<EvalRun>(`/agents/${agentId}/eval-cases/${caseId}/run`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["eval-cases", agentId] }),
  });
}

/** `POST /agents/:id/eval-runs` (N=all). On success, invalidates BOTH the
   eval-cases list and the eval-dashboard query keys for this agent — the
   Evals tab's "Run all evals" button (AC-31) relies on this one hook
   refetching both. */
export function useRunEvalSet(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<EvalRun>(`/agents/${agentId}/eval-runs`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["eval-cases", agentId] });
      qc.invalidateQueries({ queryKey: ["eval-dashboard", agentId] });
    },
  });
}

// ---- Dashboard ----

/** `GET /agents/:id/eval-dashboard`. */
export function useEvalDashboard(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-dashboard", agentId],
    queryFn: () => api.get<EvalDashboard>(`/agents/${agentId}/eval-dashboard`),
    enabled: !!agentId,
  });
}
