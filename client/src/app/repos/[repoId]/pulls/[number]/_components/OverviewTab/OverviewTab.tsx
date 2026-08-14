"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import type { Verdict } from "@devdigest/shared";
import { IntentCard } from "./_components/IntentCard";
import { PrBriefBanner } from "./_components/PrBriefBanner";
import { s } from "./styles";

interface OverviewTabProps {
  prBody: string | null | undefined;
  prId: string | null | undefined;
  verdict: Verdict | null | undefined;
  score: number | null | undefined;
  findings: { critical: number; warning: number; suggestion: number } | null | undefined;
  latestRunCostUsd: number | null | undefined;
}

// Kept free of any fetching logic (only threads props through) — the
// data-fetching concern (usePrIntent/useDeriveIntent) lives inside
// IntentCard itself, and the PR Brief aggregate comes from `page.tsx`'s
// already-fetched `pr` object, preserving OverviewTab's presentational/pure
// shape (no new useQuery here).
export function OverviewTab({
  prBody,
  prId,
  verdict,
  score,
  findings,
  latestRunCostUsd,
}: OverviewTabProps) {
  return (
    <>
      <PrBriefBanner verdict={verdict} score={score} findings={findings} costUsd={latestRunCostUsd} />

      <IntentCard prId={prId} />

      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
