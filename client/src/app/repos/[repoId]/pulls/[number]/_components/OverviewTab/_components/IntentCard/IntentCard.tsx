"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { Risk } from "@devdigest/shared";
import { Badge, Button, Card, ErrorState, SectionLabel, Skeleton } from "@devdigest/ui";
import { usePrIntent, useDeriveIntent } from "@/lib/hooks/reviews";
import { ApiError } from "@/lib/api";
import { EVIDENCE_TIER_COLOR, RISK_SEVERITY_COLOR } from "./constants";
import { s } from "./styles";

interface IntentCardProps {
  prId: string | null | undefined;
}

/**
 * PR-level "what is this PR trying to do" card (Intent Layer). Rendered on
 * the Overview tab, above the Description section, so it's visible before
 * the review results (Agent-runs is a separate tab). No numeric confidence
 * anywhere — only the qualitative `evidence_tier` badge.
 *
 * Reuses the "brief" i18n namespace (`messages/en/brief.json`) — including
 * its pre-existing, previously-unused `block.intent` title key — rather
 * than a new namespace, since this card is the first implementation of
 * `PrBrief`'s `Intent` block.
 */
export function IntentCard({ prId }: IntentCardProps) {
  const t = useTranslations("brief");
  const { data: intent, isLoading, isError, error, refetch } = usePrIntent(prId);
  const deriveIntent = useDeriveIntent(prId);

  // Re-derive button, modeled on the Conventions "Rescan" pattern
  // (`app/repos/[repoId]/conventions/page.tsx` + `useExtractConventions`).
  const deriveButton = (
    <Button
      kind="secondary"
      size="sm"
      icon="RefreshCw"
      loading={deriveIntent.isPending}
      disabled={deriveIntent.isPending}
      onClick={() => deriveIntent.mutate()}
    >
      {deriveIntent.isPending ? t("intentCard.deriving") : intent ? t("intentCard.rederive") : t("intentCard.derive")}
    </Button>
  );

  return (
    <section>
      <Card>
        <SectionLabel icon="Target" right={deriveButton}>
          {t("block.intent")}
        </SectionLabel>

        {isLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Skeleton height={16} width="70%" />
            <Skeleton height={16} width="50%" />
          </div>
        )}

        {!isLoading && isError && (
          <ErrorState
            title={t("intentCard.loadError")}
            body={error instanceof ApiError ? error.message : t("intentCard.loadErrorBody")}
            onRetry={() => refetch()}
          />
        )}

        {!isLoading && !isError && !intent && <p style={s.emptyBullet}>{t("intentCard.empty")}</p>}

        {!isLoading && !isError && intent && (
          <>
            <p style={s.intentText}>{intent.intent}</p>
            <div style={s.columns}>
              <div>
                <div style={s.columnLabel}>{t("intentCard.inScope")}</div>
                <ScopeList items={intent.in_scope} emptyLabel={t("intentCard.noneStated")} />
              </div>
              <div>
                <div style={s.columnLabel}>{t("intentCard.outOfScope")}</div>
                <ScopeList items={intent.out_of_scope} emptyLabel={t("intentCard.noneStated")} />
              </div>
            </div>
            <div style={s.subsection}>
              <Badge {...EVIDENCE_TIER_COLOR[intent.evidence_tier]}>
                {t(`intentCard.evidence.${intent.evidence_tier}`)}
              </Badge>
            </div>
            <div style={s.subsection}>
              <SectionLabel icon="Shield">{t("block.risks")}</SectionLabel>
              {intent.risks.length > 0 ? (
                <RiskChips risks={intent.risks} />
              ) : (
                <p style={s.emptyBullet}>{t("noRisks")}</p>
              )}
            </div>
          </>
        )}
      </Card>
    </section>
  );
}

/** Compact severity-colored chip row (Phase 1 — Risk Areas). Each risk
 *  renders as a small icon + title only — `explanation`/`file_refs` are
 *  derived/persisted but not shown inline in this first pass (per the
 *  confirmed mockup, docs/intent-smartdiff-improvements.md). Local,
 *  non-exported — one caller only, mirrors this file's `ScopeList`. */
function RiskChips({ risks }: { risks: Risk[] }) {
  return (
    <div style={s.riskRow}>
      {risks.map((risk, i) => (
        <Badge key={`${risk.kind}-${i}`} {...RISK_SEVERITY_COLOR[risk.severity]}>
          {risk.title}
        </Badge>
      ))}
    </div>
  );
}

function ScopeList({ items, emptyLabel }: { items: string[]; emptyLabel: string }) {
  if (items.length === 0) return <span style={s.emptyBullet}>{emptyLabel}</span>;
  return (
    <ul style={s.bulletList}>
      {items.map((item) => (
        <li key={item} style={s.bulletItem}>
          {item}
        </li>
      ))}
    </ul>
  );
}
