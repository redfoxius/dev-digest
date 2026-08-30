/* EvalDashboardDrilldown — /eval-dashboard/:agentId (spec §6.10 AC-34, plan
   Work Item 13). Self-fetching (`useAgent` + `useEvalDashboard`), route-level
   view: alert banner, metric cards with delta+sparkline, a chronological
   trend chart, and the Recent Runs table (`trend[]` rows — the plan's own
   Context note: `EvalTrendPoint`/`trend[]` IS the batch-level "Recent Runs"
   data, no separate shape needed) with row-selection checkboxes.

   The Compare button's ENABLEMENT (exactly 2 rows selected) opens
   `CompareRunsModal` (Work Item 14, spec §6.7 AC-26/AC-27) with the 2
   currently-selected rows. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Button, Checkbox, ErrorState, Icon, LineChart, MetricCard, Skeleton } from "@devdigest/ui";
import type { EvalTrendPoint } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { useAgent } from "@/lib/hooks/agents";
import { useEvalDashboard } from "@/lib/hooks/evals";
import { formatCost } from "@/lib/format";
import { CompareRunsModal } from "./_components/CompareRunsModal";
import { formatRanAt, pct, sortRunsDescending, toggleRowSelection } from "./helpers";
import { s } from "./styles";

export function EvalDashboardDrilldown({ agentId }: { agentId: string }) {
  const t = useTranslations("evalDashboard");
  const router = useRouter();

  const { data: agent, isLoading: agentLoading } = useAgent(agentId);
  const {
    data: dashboard,
    isLoading: dashLoading,
    isError: dashError,
    refetch: refetchDashboard,
  } = useEvalDashboard(agentId);

  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const [compareOpen, setCompareOpen] = React.useState<boolean>(false);

  const agentName = agent?.name ?? t("drilldown.breadcrumbFallback");
  const crumb = [
    { label: t("list.breadcrumbLab") },
    { label: t("list.breadcrumb"), href: "/eval-dashboard" },
    { label: agentName },
  ];

  const loading = agentLoading || dashLoading;
  const trend = dashboard?.trend ?? [];
  const recentRunsDesc = React.useMemo(() => sortRunsDescending(trend), [trend]);
  const atCap = selected.size >= 2;
  const selectedRuns = React.useMemo(
    () =>
      Array.from(selected)
        .sort((a, b) => a - b)
        .map((i) => recentRunsDesc[i])
        .filter((run): run is EvalTrendPoint => !!run),
    [selected, recentRunsDesc],
  );

  function toggleRow(index: number) {
    setSelected((prev) => toggleRowSelection(prev, index));
  }

  function handleCompare() {
    setCompareOpen(true);
  }

  if (dashError) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          <ErrorState body={t("drilldown.loadError")} onRetry={() => refetchDashboard()} />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <div style={s.header}>
          <Icon.Cpu size={18} style={{ color: "var(--accent)" }} aria-hidden="true" />
          <h1 style={s.h1}>{agentName}</h1>
          {dashboard && <Badge color="var(--text-secondary)">{t("drilldown.casesTotal", { count: dashboard.cases_total })}</Badge>}
          <Button kind="secondary" size="sm" icon="ChevronLeft" onClick={() => router.push("/eval-dashboard")}>
            {t("list.breadcrumb")}
          </Button>
        </div>

        {loading || !dashboard ? (
          <div style={s.metricsRow} aria-label={agentName}>
            <Skeleton height={90} />
            <Skeleton height={90} />
            <Skeleton height={90} />
          </div>
        ) : (
          <>
            {dashboard.alert && (
              <div role="status" style={s.alert}>
                <Icon.AlertTriangle size={14} aria-hidden="true" />
                {dashboard.alert}
              </div>
            )}

            <div style={s.metricsRow}>
              <MetricCard
                label={t("drilldown.metrics.recall")}
                value={pct(dashboard.current.recall)}
                suffix="%"
                delta={dashboard.delta.recall * 100}
                trend={trend.map((p) => p.recall)}
                color="var(--accent)"
              />
              <MetricCard
                label={t("drilldown.metrics.precision")}
                value={pct(dashboard.current.precision)}
                suffix="%"
                delta={dashboard.delta.precision * 100}
                trend={trend.map((p) => p.precision)}
                color="var(--ok)"
              />
              <MetricCard
                label={t("drilldown.metrics.citationAccuracy")}
                value={pct(dashboard.current.citation_accuracy)}
                suffix="%"
                delta={dashboard.delta.citation_accuracy * 100}
                trend={trend.map((p) => p.citation_accuracy)}
                color="var(--warn)"
              />
              <MetricCard
                label={t("drilldown.metrics.tracesPassed")}
                value={`${dashboard.current.traces_passed}/${dashboard.current.traces_total}`}
              />
            </div>

            {trend.length === 0 ? (
              <p style={s.emptyNote}>{t("drilldown.noRuns")}</p>
            ) : (
              <>
                <div style={s.section}>
                  <h2 style={s.h2}>{t("drilldown.metricTrend")}</h2>
                  <div style={s.legend}>
                    <span style={s.legendItem}>
                      <span style={s.legendDot("var(--accent)")} />
                      {t("drilldown.metrics.recall")}
                    </span>
                    <span style={s.legendItem}>
                      <span style={s.legendDot("var(--ok)")} />
                      {t("drilldown.metrics.precision")}
                    </span>
                    <span style={s.legendItem}>
                      <span style={s.legendDot("var(--warn)")} />
                      {t("drilldown.metrics.citationAccuracy")}
                    </span>
                  </div>
                  <LineChart
                    series={[
                      { name: t("drilldown.metrics.recall"), color: "var(--accent)", data: trend.map((p) => p.recall) },
                      { name: t("drilldown.metrics.precision"), color: "var(--ok)", data: trend.map((p) => p.precision) },
                      {
                        name: t("drilldown.metrics.citationAccuracy"),
                        color: "var(--warn)",
                        data: trend.map((p) => p.citation_accuracy),
                      },
                    ]}
                  />
                </div>

                <div style={s.section}>
                  <h2 style={s.h2}>{t("drilldown.recentRuns")}</h2>
                  <div style={s.tableWrap}>
                    <table style={s.table}>
                      <thead>
                        <tr>
                          <th style={s.th}>
                            <span style={s.srOnly}>{t("drilldown.table.select")}</span>
                          </th>
                          <th style={s.th}>{t("drilldown.table.ranAt")}</th>
                          <th style={s.th}>{t("drilldown.table.recall")}</th>
                          <th style={s.th}>{t("drilldown.table.precision")}</th>
                          <th style={s.th}>{t("drilldown.table.citation")}</th>
                          <th style={s.th}>{t("drilldown.table.passRate")}</th>
                          <th style={s.th}>{t("drilldown.table.cost")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recentRunsDesc.map((run, i) => {
                          const isChecked = selected.has(i);
                          return (
                            <tr key={run.ran_at}>
                              <td style={s.td}>
                                <Checkbox
                                  checked={isChecked}
                                  onChange={isChecked || !atCap ? () => toggleRow(i) : undefined}
                                  label={
                                    <span style={s.srOnly}>
                                      {t("drilldown.selectRunLabel", { date: formatRanAt(run.ran_at) })}
                                    </span>
                                  }
                                />
                              </td>
                              <td style={s.td}>{formatRanAt(run.ran_at)}</td>
                              <td style={s.td}>{pct(run.recall)}%</td>
                              <td style={s.td}>{pct(run.precision)}%</td>
                              <td style={s.td}>{pct(run.citation_accuracy)}%</td>
                              <td style={s.td}>{pct(run.pass_rate)}%</td>
                              <td style={s.td}>{formatCost(run.cost_usd)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div style={s.compareRow}>
                    <Button kind="primary" disabled={selected.size !== 2} onClick={handleCompare}>
                      {t("drilldown.compare")}
                    </Button>
                    {selected.size !== 2 && <span style={s.compareHint}>{t("drilldown.compareHint")}</span>}
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {compareOpen && selectedRuns.length === 2 && (
          <CompareRunsModal
            agentId={agentId}
            runs={[selectedRuns[0]!, selectedRuns[1]!]}
            onClose={() => setCompareOpen(false)}
          />
        )}
      </div>
    </AppShell>
  );
}
