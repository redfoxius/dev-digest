"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import type { Verdict } from "@devdigest/shared";
import { IntentCard } from "./_components/IntentCard";
import { PrBriefBanner } from "./_components/PrBriefBanner";
import { BlastRadiusCard } from "./_components/BlastRadiusCard";
import { s } from "./styles";

interface OverviewTabProps {
  prBody: string | null | undefined;
  prId: string | null | undefined;
  verdict: Verdict | null | undefined;
  score: number | null | undefined;
  findings: { critical: number; warning: number; suggestion: number } | null | undefined;
  latestRunCostUsd: number | null | undefined;
  /** Switches the PR page to the full "Blast radius" tab — threaded through
   *  to BlastRadiusCard's "View full blast radius" action. */
  onOpenBlast: () => void;
  /** Jump to a caller's file:line — threaded through to BlastRadiusCard;
   *  page.tsx's `handleCallerClick` decides Files-changed tab vs. GitHub
   *  link depending on whether the file is part of this PR's diff. */
  onViewInDiff: (file: string, line: number) => void;
  /** Files where onViewInDiff will actually jump in-app (already accounts
   *  for whether the blast index's commit matches this PR's head SHA, not
   *  just raw diff membership) — anything else shows the GitHub icon. */
  prFilePaths: Set<string>;
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
  onOpenBlast,
  onViewInDiff,
  prFilePaths,
}: OverviewTabProps) {
  return (
    <>
      <PrBriefBanner verdict={verdict} score={score} findings={findings} costUsd={latestRunCostUsd} />

      <IntentCard prId={prId} />

      <BlastRadiusCard
        prId={prId}
        onViewFull={onOpenBlast}
        onViewInDiff={onViewInDiff}
        prFilePaths={prFilePaths}
      />

      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
