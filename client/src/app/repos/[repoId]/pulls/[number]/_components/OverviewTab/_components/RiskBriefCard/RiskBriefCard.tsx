"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Card, EmptyState, ErrorState, SectionLabel, Skeleton } from "@devdigest/ui";
import { usePrRiskBrief, useGenerateRiskBrief } from "@/lib/hooks/risk-brief";
import { ApiError } from "@/lib/api";
import { RISK_SEVERITY_COLOR } from "@/lib/risk-severity";
import { s } from "./styles";

interface RiskBriefCardProps {
  prId: string | null | undefined;
  /** Jump to a `review_focus[]` entry's exact file:line in the
   *  Files-changed tab. ALWAYS an in-app jump, never a GitHub fallback —
   *  `review_focus[]` entries are server-validated to always reference the
   *  PR's own diff files (AC-10/AC-20), unlike `BlastRadiusCard`'s
   *  `onViewInDiff`, which does have a GitHub-fallback branch for caller
   *  files outside the diff. Kept as a distinctly-named prop for exactly
   *  that reason — wiring (WI-15) must bind this to the page's raw,
   *  always-in-app `handleViewInDiff`, not `handleCallerClick`. */
  onViewInDiff: (file: string, line: number) => void;
}

/**
 * PR Why + Risk Brief card (specs/cross-cutting/pr-why-risk-brief) — the
 * Overview tab's fourth, additive lens: a composed LLM judgment over the
 * PR's already-derived Intent, Blast Radius, diff stats, linked issue, and
 * relevant Project Context specs. Self-contained fetching, same pattern as
 * the sibling `IntentCard`/`BlastRadiusCard`.
 *
 * Renders a color-coded `risk_level` badge, `what`/`why`, the `risks[]`
 * list, and a clickable `review_focus[]` list (AC-17). An empty state
 * offers a "Generate" action (`force: false`, AC-18); a separate,
 * ALWAYS-rendered "Regenerate" action in the section header always forces
 * a fresh call (`force: true`, AC-19) regardless of whether a brief
 * already exists. When the last generate/regenerate mutation resolved with
 * a `degraded_reason`, this renders a distinct error/retry state — never a
 * fabricated `risk_level` or an empty-but-present `risks`/`review_focus` as
 * if it were a real result (AC-21).
 */
export function RiskBriefCard({ prId, onViewInDiff }: RiskBriefCardProps) {
  const t = useTranslations("brief");
  const { data: brief, isLoading, isError, error, refetch } = usePrRiskBrief(prId);
  const generateRiskBrief = useGenerateRiskBrief(prId);

  // The last generate/regenerate mutation's own resolved payload takes
  // priority over the persisted GET data — a `degraded_reason` result must
  // render as an error state even if a prior, still-valid persisted brief
  // exists (the persisted row itself is left untouched server-side, but the
  // card must not silently keep showing it as if the regenerate succeeded).
  const degradedReason = generateRiskBrief.data?.degraded_reason;
  const effectiveBrief = generateRiskBrief.data?.brief ?? brief ?? null;

  const regenerateButton = (
    <Button
      kind="secondary"
      size="sm"
      icon="RefreshCw"
      loading={generateRiskBrief.isPending}
      disabled={generateRiskBrief.isPending}
      onClick={() => generateRiskBrief.mutate({ force: true })}
    >
      {generateRiskBrief.isPending ? t("riskBriefCard.regenerating") : t("riskBriefCard.regenerate")}
    </Button>
  );

  return (
    <section>
      <Card>
        <SectionLabel icon="ListChecks" right={regenerateButton}>
          {t("riskBriefCard.title")}
        </SectionLabel>

        {isLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Skeleton height={16} width="70%" />
            <Skeleton height={16} width="50%" />
          </div>
        )}

        {!isLoading && isError && (
          <ErrorState
            title={t("riskBriefCard.loadError")}
            body={error instanceof ApiError ? error.message : t("riskBriefCard.loadErrorBody")}
            onRetry={() => refetch()}
          />
        )}

        {!isLoading && !isError && degradedReason && (
          <ErrorState
            title={t(`riskBriefCard.degraded.${degradedReason}.title`)}
            body={t(`riskBriefCard.degraded.${degradedReason}.body`)}
            onRetry={() => generateRiskBrief.mutate({ force: true })}
          />
        )}

        {!isLoading && !isError && !degradedReason && !effectiveBrief && (
          <EmptyState
            icon="ListChecks"
            title={t("riskBriefCard.emptyTitle")}
            body={t("riskBriefCard.emptyBody")}
            cta={t("riskBriefCard.generate")}
            ctaLoading={generateRiskBrief.isPending}
            onCta={() => generateRiskBrief.mutate({ force: false })}
          />
        )}

        {!isLoading && !isError && !degradedReason && effectiveBrief && (
          <>
            <div style={s.riskLevelRow}>
              <Badge {...RISK_SEVERITY_COLOR[effectiveBrief.risk_level]}>
                {t(`riskBriefCard.riskLevel.${effectiveBrief.risk_level}`)}
              </Badge>
            </div>
            <p style={s.whatText}>{effectiveBrief.what}</p>
            <p style={s.whyText}>{effectiveBrief.why}</p>

            <div style={s.subsection}>
              <SectionLabel icon="Shield">{t("riskBriefCard.risks")}</SectionLabel>
              {effectiveBrief.risks.length > 0 ? (
                <div style={s.riskRow}>
                  {effectiveBrief.risks.map((risk, i) => (
                    <Badge key={`${risk.kind}-${i}`} {...RISK_SEVERITY_COLOR[risk.severity]}>
                      {risk.title}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p style={s.emptyBullet}>{t("riskBriefCard.noRisks")}</p>
              )}
            </div>

            <div style={s.subsection}>
              <SectionLabel icon="ListChecks">{t("riskBriefCard.reviewFocus")}</SectionLabel>
              {effectiveBrief.review_focus.length > 0 ? (
                <ul style={s.focusList}>
                  {effectiveBrief.review_focus.map((item, i) => (
                    <li key={`${item.file}:${item.line}:${i}`}>
                      <button
                        style={s.focusRow}
                        onClick={() => onViewInDiff(item.file, item.line)}
                        aria-label={`${item.file}:${item.line} — ${item.reason}`}
                      >
                        <span className="mono" style={s.focusLocation}>
                          {item.file}:{item.line}
                        </span>
                        <span style={s.focusReason}>{item.reason}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p style={s.emptyBullet}>{t("riskBriefCard.noReviewFocus")}</p>
              )}
            </div>
          </>
        )}
      </Card>
    </section>
  );
}

export default RiskBriefCard;
