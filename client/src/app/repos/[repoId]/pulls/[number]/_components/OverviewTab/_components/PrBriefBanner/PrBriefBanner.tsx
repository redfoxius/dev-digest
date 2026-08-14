"use client";

import { useTranslations } from "next-intl";
import type { Verdict } from "@devdigest/shared";
import { VerdictBanner } from "../../../VerdictBanner";
import { s } from "./styles";

interface PrBriefBannerProps {
  verdict: Verdict | null | undefined;
  score: number | null | undefined;
  findings: { critical: number; warning: number; suggestion: number } | null | undefined;
  costUsd?: number | null;
}

// Top-of-Overview PR Brief banner (Phase 2 of
// docs/intent-smartdiff-improvements.md) — reuses VerdictBanner (previously
// only rendered per-run inside ReviewRunAccordion) with data aggregated
// server-side across the PR's LATEST review batch, not a single run.
export function PrBriefBanner({ verdict, score, findings, costUsd }: PrBriefBannerProps) {
  const t = useTranslations("prReview");
  if (verdict == null) {
    return <div style={s.emptyWrap}>{t("prBrief.empty")}</div>;
  }
  const findingsCount = (findings?.critical ?? 0) + (findings?.warning ?? 0) + (findings?.suggestion ?? 0);
  const blockers = findings?.critical ?? 0;
  return (
    <VerdictBanner
      verdict={verdict}
      summary={null}
      score={score ?? null}
      findingsCount={findingsCount}
      blockers={blockers}
      costUsd={costUsd}
    />
  );
}
