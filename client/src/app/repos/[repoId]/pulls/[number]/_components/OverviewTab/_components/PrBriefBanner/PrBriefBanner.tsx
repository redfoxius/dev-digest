"use client";

import { useTranslations } from "next-intl";
import type { RiskSeverity, Verdict } from "@devdigest/shared";
import { Badge } from "@devdigest/ui";
import { RISK_SEVERITY_COLOR } from "@/lib/risk-severity";
import { VerdictBanner } from "../../../VerdictBanner";
import { s } from "./styles";

interface PrBriefBannerProps {
  verdict: Verdict | null | undefined;
  score: number | null | undefined;
  findings: { critical: number; warning: number; suggestion: number } | null | undefined;
  costUsd?: number | null;
  riskLevel?: RiskSeverity | null;
}

// Top-of-Overview PR Brief banner (Phase 2 of
// docs/intent-smartdiff-improvements.md) — reuses VerdictBanner (previously
// only rendered per-run inside ReviewRunAccordion) with data aggregated
// server-side across the PR's LATEST review batch, not a single run.
//
// `riskLevel` (PR Why + Risk Brief feature, AC-23) is independent of
// `verdict` — a Risk Brief can exist before any review has run, so the
// badge must render in BOTH the empty-state branch below AND the normal
// VerdictBanner branch, not only the latter.
export function PrBriefBanner({ verdict, score, findings, costUsd, riskLevel }: PrBriefBannerProps) {
  const t = useTranslations("prReview");
  const riskBadge = riskLevel != null && (
    <Badge {...RISK_SEVERITY_COLOR[riskLevel]}>{t(`riskBadge.${riskLevel}`)}</Badge>
  );
  if (verdict == null) {
    return (
      <div style={s.emptyWrap}>
        <span>{t("prBrief.empty")}</span>
        {riskBadge}
      </div>
    );
  }
  const findingsCount = (findings?.critical ?? 0) + (findings?.warning ?? 0) + (findings?.suggestion ?? 0);
  const blockers = findings?.critical ?? 0;
  return (
    <div>
      {riskBadge && <div style={s.riskBadgeWrap}>{riskBadge}</div>}
      <VerdictBanner
        verdict={verdict}
        summary={null}
        score={score ?? null}
        findingsCount={findingsCount}
        blockers={blockers}
        costUsd={costUsd}
      />
    </div>
  );
}
