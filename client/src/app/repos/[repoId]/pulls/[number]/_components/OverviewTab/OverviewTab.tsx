"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import type { RiskSeverity, Verdict } from "@devdigest/shared";
import { IntentCard } from "./_components/IntentCard";
import { PrBriefBanner } from "./_components/PrBriefBanner";
import { BlastRadiusCard } from "./_components/BlastRadiusCard";
import { RiskBriefCard } from "./_components/RiskBriefCard";
import { s } from "./styles";

interface OverviewTabProps {
  prBody: string | null | undefined;
  prId: string | null | undefined;
  /** Grouped — all four fields are consumed exclusively by PrBriefBanner
   *  (verdict/score/findings/cost), so they're threaded through OverviewTab
   *  as one object rather than four separate flat props. */
  reviewSummary: {
    verdict: Verdict | null | undefined;
    score: number | null | undefined;
    findings: { critical: number; warning: number; suggestion: number } | null | undefined;
    latestRunCostUsd: number | null | undefined;
  };
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
  /** PR Why + Risk Brief (specs/cross-cutting/pr-why-risk-brief) — grouped
   *  because all three fields are the same logical concern (the Risk Brief
   *  feature) and get threaded into this tab's three risk-aware children. */
  riskBrief: {
    /** AC-23 — threaded into PrBriefBanner's risk badge. Sourced from
     *  `page.tsx`'s already-fetched `pr.risk_level` (`GET /pulls/:id`), not
     *  a new fetch here. */
    level: RiskSeverity | null | undefined;
    /** AC-24 — parent-derived map of a caller's `file` or an endpoint/cron
     *  string to the highest-severity `RiskBrief.risks[]` entry citing it
     *  (or the neutral `'flagged'` sentinel when only cited via
     *  `review_focus[]`), threaded into BlastRadiusCard's flagged-dot
     *  indicator. */
    flaggedRefs: Map<string, RiskSeverity | "flagged"> | undefined;
    /** Jump to a `review_focus[]` entry's exact file:line in the
     *  Files-changed tab — ALWAYS an in-app jump (AC-20), threaded into the
     *  new RiskBriefCard. Deliberately distinct from `onViewInDiff` above,
     *  which is bound to page.tsx's `handleCallerClick` and has a
     *  GitHub-fallback branch for caller files outside this PR's diff —
     *  Review Focus entries are server-validated to always be diff files
     *  and must never fall back to GitHub. */
    onJumpToDiff: (file: string, line: number) => void;
  };
}

// Kept free of any fetching logic (only threads props through) — the
// data-fetching concern (usePrIntent/useDeriveIntent, usePrRiskBrief) lives
// inside IntentCard/RiskBriefCard themselves, and the PR Brief aggregate
// plus `riskLevel`/`flaggedRefs` come from `page.tsx`'s already-fetched
// data, preserving OverviewTab's presentational/pure shape (no new
// useQuery here).
export function OverviewTab({
  prBody,
  prId,
  reviewSummary,
  onOpenBlast,
  onViewInDiff,
  prFilePaths,
  riskBrief,
}: OverviewTabProps) {
  return (
    <>
      <PrBriefBanner
        verdict={reviewSummary.verdict}
        score={reviewSummary.score}
        findings={reviewSummary.findings}
        costUsd={reviewSummary.latestRunCostUsd}
        riskLevel={riskBrief.level}
      />

      <IntentCard prId={prId} />

      <BlastRadiusCard
        prId={prId}
        onViewFull={onOpenBlast}
        onViewInDiff={onViewInDiff}
        prFilePaths={prFilePaths}
        flaggedRefs={riskBrief.flaggedRefs}
      />

      <RiskBriefCard prId={prId} onViewInDiff={riskBrief.onJumpToDiff} />

      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
