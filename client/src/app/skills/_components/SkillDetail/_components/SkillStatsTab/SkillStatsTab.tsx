/* SkillStatsTab — 4 KPI tiles, an "agents using this skill" list, and a
   findings-by-category donut, over a rolling 30-day window. `useSkillStats`
   returns zeros/nulls for a skill that's unlinked or has no runs yet — that
   state renders a lightweight note instead of empty tiles, since it's the
   expected state for any skill until new runs accumulate post-ship. See
   docs/skills-feature-plan.md#stats-tab--addendum. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Donut, ErrorState, Icon, MetricCard, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillStats } from "../../../../../../lib/hooks/skills";
import { s } from "./styles";

/** Findings categories are the same fixed 5-value set the review pipeline
   assigns (`FindingCategory`) — reusing the PR list's severity/category
   color convention (crit/accent/warn/info/ok) rather than inventing a new
   palette for one donut. */
const CATEGORY_COLOR: Record<string, string> = {
  bug: "var(--crit)",
  security: "var(--accent)",
  perf: "var(--warn)",
  style: "var(--info)",
  test: "var(--ok)",
};

function pct(v: number | null): string {
  return v == null ? "—" : `${Math.round(v * 100)}`;
}

export function SkillStatsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const { data: stats, isLoading, isError, refetch } = useSkillStats(skill.id);

  if (isLoading) {
    return (
      <div style={s.wrap}>
        <Skeleton height={90} />
        <Skeleton height={120} />
      </div>
    );
  }
  if (isError || !stats) {
    return <ErrorState body={t("stats.loadError")} onRetry={() => refetch()} />;
  }

  const noData = stats.used_by === 0 && stats.findings_count === 0;

  return (
    <div style={s.wrap}>
      <div style={s.tiles}>
        <MetricCard label={t("stats.usedBy")} value={stats.used_by} suffix={` ${t("stats.agents")}`} />
        <MetricCard label={t("stats.pullFrequency")} value={pct(stats.pull_frequency)} suffix="%" />
        <MetricCard label={t("stats.acceptRate")} value={pct(stats.accept_rate)} suffix="%" />
        <MetricCard label={t("stats.findings30d")} value={stats.findings_count} />
      </div>

      {noData && (
        <div style={s.note}>
          <Icon.Info size={13} style={{ verticalAlign: "-2px", marginRight: 6 }} />
          {t("stats.noData")}
        </div>
      )}

      <div style={s.section}>
        <span style={s.sectionTitle}>{t("stats.agentsUsingThisSkill")}</span>
        {stats.agents_using_this_skill.length === 0 ? (
          <div style={s.note}>{t("stats.noAgents")}</div>
        ) : (
          <div style={s.agentList}>
            {stats.agents_using_this_skill.map((a) => (
              <div key={a.agent_id} style={s.agentRow}>
                <span style={s.agentName}>{a.agent_name}</span>
                <Link href={`/agents/${a.agent_id}?tab=config`} style={s.agentLink}>
                  {t("stats.open")}
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={s.section}>
        <span style={s.sectionTitle}>{t("stats.findingsByCategory")}</span>
        {stats.findings_by_category.length === 0 ? (
          <div style={s.note}>{t("stats.noFindings")}</div>
        ) : (
          <Donut
            valuePrefix=""
            segments={stats.findings_by_category.map((c) => ({
              label: c.category,
              value: c.count,
              color: CATEGORY_COLOR[c.category] ?? "var(--text-muted)",
            }))}
          />
        )}
      </div>
    </div>
  );
}
