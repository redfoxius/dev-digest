/* CompareRunsModal — compares exactly two Eval Dashboard "Recent Runs" rows
   (spec §6.7, AC-26/AC-27, plan Work Item 14). Composed entirely from data
   already returned by `GET /agents/:id/eval-dashboard` (the two selected
   `EvalTrendPoint`s, passed in as props — no re-fetch) and
   `GET /agents/:id/versions`/`GET /agents/:id/versions/:version` (fetched
   here): each run's live agent version is resolved client-side via
   `resolveAgentVersionForBatch` (AC-22, already built in this folder's own
   `helpers.ts`), then that version's full snapshot is fetched to diff its
   `config.system_prompt` against the other run's resolved version (AC-27).

   A run whose `ran_at` predates every known `agent_versions` snapshot has no
   resolvable version (e.g. a batch run before the agent's very first
   snapshot) — rendered as an inline message for that run rather than a
   crash, per this work item's brief. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ErrorState, Icon, Modal, Skeleton } from "@devdigest/ui";
import type { EvalTrendPoint } from "@devdigest/shared";
import { useAgentVersion, useAgentVersions } from "@/lib/hooks/agents";
import { formatCost } from "@/lib/format";
import { resolveAgentVersionForBatch } from "./helpers";
import { computeDiffLines, formatRatio, hasPromptChanged, signedCostDelta, signedDelta, sortRunsByRanAtAsc } from "./format";
import { formatRanAt } from "../../helpers";
import { s } from "./styles";

export function CompareRunsModal({
  agentId,
  runs,
  onClose,
}: {
  agentId: string;
  /** Exactly the 2 currently-selected Recent-Runs rows — the caller (
     `EvalDashboardDrilldown`) only ever mounts this component once its own
     `selected` Set has exactly 2 entries. */
  runs: [EvalTrendPoint, EvalTrendPoint];
  onClose: () => void;
}) {
  const t = useTranslations("evalDashboard");

  const {
    data: versions,
    isLoading: versionsLoading,
    isError: versionsError,
    refetch: refetchVersions,
  } = useAgentVersions(agentId);

  const [earlier, later] = sortRunsByRanAtAsc(runs);

  const resolvedEarlier = versions ? resolveAgentVersionForBatch(versions, earlier.ran_at) : undefined;
  const resolvedLater = versions ? resolveAgentVersionForBatch(versions, later.ran_at) : undefined;

  const earlierVersionQuery = useAgentVersion(agentId, resolvedEarlier?.version);
  const laterVersionQuery = useAgentVersion(agentId, resolvedLater?.version);

  const deltaRecall = later.recall - earlier.recall;
  const deltaPrecision = later.precision - earlier.precision;
  const deltaCitation = later.citation_accuracy - earlier.citation_accuracy;
  // `cost_usd` is nullable (`EvalTrendPoint.cost_usd`) — the delta is only
  // computable when both sides are known.
  const deltaCost = earlier.cost_usd != null && later.cost_usd != null ? later.cost_usd - earlier.cost_usd : null;

  const bothVersionsResolved = !!resolvedEarlier && !!resolvedLater;
  const promptsLoading = bothVersionsResolved && (earlierVersionQuery.isLoading || laterVersionQuery.isLoading);
  const promptsError = bothVersionsResolved && (earlierVersionQuery.isError || laterVersionQuery.isError);
  const promptsReady = bothVersionsResolved && !!earlierVersionQuery.data && !!laterVersionQuery.data;
  const diffLines =
    promptsReady && earlierVersionQuery.data && laterVersionQuery.data
      ? computeDiffLines(earlierVersionQuery.data.config.system_prompt, laterVersionQuery.data.config.system_prompt)
      : [];

  return (
    <Modal width={760} title={t("compare.title")} onClose={onClose}>
      <div style={s.body}>
        {versionsLoading ? (
          <Skeleton height={140} />
        ) : versionsError ? (
          <ErrorState body={t("compare.loadError")} onRetry={() => refetchVersions()} />
        ) : (
          <>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>{t("compare.metricHeader")}</th>
                  <th style={s.th}>
                    {resolvedEarlier ? t("compare.versionLabel", { version: resolvedEarlier.version }) : t("compare.earlierRun")}
                  </th>
                  <th style={s.th}>
                    {resolvedLater ? t("compare.versionLabel", { version: resolvedLater.version }) : t("compare.laterRun")}
                  </th>
                  <th style={s.th}>{t("compare.deltaHeader")}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={s.td}>{t("compare.metrics.recall")}</td>
                  <td style={s.td}>{formatRatio(earlier.recall)}</td>
                  <td style={s.td}>{formatRatio(later.recall)}</td>
                  <td style={s.deltaCell(deltaRecall)}>{signedDelta(deltaRecall)}</td>
                </tr>
                <tr>
                  <td style={s.td}>{t("compare.metrics.precision")}</td>
                  <td style={s.td}>{formatRatio(earlier.precision)}</td>
                  <td style={s.td}>{formatRatio(later.precision)}</td>
                  <td style={s.deltaCell(deltaPrecision)}>{signedDelta(deltaPrecision)}</td>
                </tr>
                <tr>
                  <td style={s.td}>{t("compare.metrics.citationAccuracy")}</td>
                  <td style={s.td}>{formatRatio(earlier.citation_accuracy)}</td>
                  <td style={s.td}>{formatRatio(later.citation_accuracy)}</td>
                  <td style={s.deltaCell(deltaCitation)}>{signedDelta(deltaCitation)}</td>
                </tr>
                <tr>
                  <td style={s.td}>{t("compare.metrics.cost")}</td>
                  <td style={s.td}>{formatCost(earlier.cost_usd)}</td>
                  <td style={s.td}>{formatCost(later.cost_usd)}</td>
                  <td style={s.deltaCell(deltaCost)}>{signedCostDelta(deltaCost)}</td>
                </tr>
              </tbody>
            </table>

            {!resolvedEarlier && (
              <p style={s.note}>{t("compare.versionUnresolved", { date: formatRanAt(earlier.ran_at) })}</p>
            )}
            {!resolvedLater && <p style={s.note}>{t("compare.versionUnresolved", { date: formatRanAt(later.ran_at) })}</p>}

            <div style={s.section}>
              <h3 style={s.h3}>{t("compare.systemPromptDiff")}</h3>
              {!bothVersionsResolved ? (
                <p style={s.note}>{t("compare.promptDiffUnavailable")}</p>
              ) : promptsLoading ? (
                <Skeleton height={160} />
              ) : promptsError ? (
                <ErrorState body={t("compare.loadError")} />
              ) : !hasPromptChanged(diffLines) ? (
                <p style={s.note}>{t("compare.noPromptDiff")}</p>
              ) : (
                <div style={s.diffPanel}>
                  {diffLines.map((line, i) => (
                    <div key={i} data-diff-type={line.type} style={s.diffLine(line.type)}>
                      {line.type === "add" && <Icon.Plus size={10} aria-hidden="true" style={{ display: "inline" }} />}
                      {line.type === "remove" && <Icon.X size={10} aria-hidden="true" style={{ display: "inline" }} />}
                      {" "}
                      {line.text}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
