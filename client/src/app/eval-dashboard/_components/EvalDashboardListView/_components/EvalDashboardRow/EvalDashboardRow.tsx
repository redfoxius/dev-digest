/* EvalDashboardRow — one agent's summary row on the Eval Dashboard list page
   (AC-33). Fetches `GET /agents/:id/eval-dashboard` for its OWN agent only —
   the list view mounts one of these per agent, which is what makes the
   overall page's "N per-agent calls, composed client-side" shape (AC-33)
   real hook calls rather than a hook called in a loop.

   Deliberately does NOT resolve/display a "last-run agent version" — that
   needs the shared `resolveAgentVersionForBatch` helper, which is Work Item
   14's job and doesn't exist yet (plan WI-13 note). This row only renders
   what `EvalDashboard` already returns directly. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, Skeleton } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { useEvalDashboard } from "@/lib/hooks/evals";
import { s } from "./styles";

/** `Math.round(ratio * 100)` for a 0..1 metric ratio rendered as "NN%" —
   matches `AgentEditor/_components/EvalsTab/helpers.ts`'s own `pct` (each
   route keeps its own copy until a 4th consumer shows up, client/INSIGHTS.md
   2026-08-14 convention). */
function pct(ratio: number): number {
  return Math.round(ratio * 100);
}

export function EvalDashboardRow({ agent, onSelect }: { agent: Agent; onSelect: () => void }) {
  const t = useTranslations("evalDashboard");
  const { data: dashboard, isLoading } = useEvalDashboard(agent.id);

  return (
    <button
      type="button"
      style={s.row}
      onClick={onSelect}
      aria-label={t("list.openDetail", { name: agent.name })}
    >
      <div style={s.identity}>
        <Icon.Cpu size={15} style={{ color: "var(--accent)" }} aria-hidden="true" />
        <span style={s.name}>{agent.name}</span>
        <Badge color="var(--text-secondary)" mono>
          {agent.provider}/{agent.model}
        </Badge>
      </div>

      {isLoading || !dashboard ? (
        <div style={s.metrics}>
          <Skeleton width={240} height={16} />
        </div>
      ) : (
        <div style={s.metrics}>
          <span style={s.metric}>
            {t("list.metricLabels.recall")} <strong>{pct(dashboard.current.recall)}%</strong>
          </span>
          <span style={s.metric}>
            {t("list.metricLabels.precision")} <strong>{pct(dashboard.current.precision)}%</strong>
          </span>
          <span style={s.metric}>
            {t("list.metricLabels.citation")} <strong>{pct(dashboard.current.citation_accuracy)}%</strong>
          </span>
          <span style={s.tracesBadge}>
            {dashboard.current.traces_total > 0
              ? t("list.tracesPassed", {
                  passed: dashboard.current.traces_passed,
                  total: dashboard.current.traces_total,
                })
              : t("list.noRunsYet")}
          </span>
          <Badge color="var(--text-secondary)">{t("list.cases", { count: dashboard.cases_total })}</Badge>
        </div>
      )}

      <Icon.ChevronRight size={16} style={{ color: "var(--text-muted)" }} aria-hidden="true" />
    </button>
  );
}
