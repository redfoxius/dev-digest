/* hooks/smart-diff.ts — Smart Diff (deterministic, risk-ordered file grouping)
   for a PR's Files-changed tab. */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { SmartDiff } from "@devdigest/shared";

/** Grouped/classified diff for a PR (core/wiring/boilerplate + per-file
   finding badges). Works before any review has run (empty finding badges). */
export function usePrSmartDiff(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["pr-smart-diff", prId],
    queryFn: () => api.get<SmartDiff>(`/pulls/${prId}/smart-diff`),
    enabled: !!prId,
  });
}
