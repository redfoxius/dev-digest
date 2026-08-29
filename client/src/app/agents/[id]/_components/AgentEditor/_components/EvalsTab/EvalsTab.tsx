/* EvalsTab — Agent Editor's eval-case regression harness view
   (specs/cross-cutting/eval-pipeline/spec.md §6.9, plan Work Item 12).
   Fetches `GET /agents/:id/eval-dashboard` (summary cards) +
   `GET /agents/:id/eval-cases` (case list, one row per case, pass/fail/
   never-run icon derived from that case's own most recent run) — "Run all
   evals" (AC-31) refetches both via `useRunEvalSet`'s own `onSuccess`
   invalidation, no extra plumbing needed here. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog, ErrorState, Icon, IconBtn, MetricCard, Skeleton } from "@devdigest/ui";
import type { Agent, EvalCase } from "@devdigest/shared";
import { useDeleteEvalCase, useEvalCases, useEvalDashboard, useRunEvalCase, useRunEvalSet } from "@/lib/hooks/evals";
import { useToast } from "@/lib/toast";
import { EvalCaseModal } from "./_components/EvalCaseModal";
import { caseStatusIcon, gotCount, latestRunForCase, mustFindCount, pct, type CaseRunStatus } from "./helpers";
import { s } from "./styles";

const STATUS_ICON: Record<CaseRunStatus, keyof typeof Icon> = {
  pass: "CheckCircle",
  fail: "XCircle",
  "never-run": "Slash",
};
const STATUS_COLOR: Record<CaseRunStatus, string> = {
  pass: "var(--ok)",
  fail: "var(--crit)",
  "never-run": "var(--text-muted)",
};

export function EvalsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const toast = useToast();

  const { data: dashboard, isLoading: dashLoading, isError: dashError, refetch: refetchDash } =
    useEvalDashboard(agent.id);
  const { data: cases, isLoading: casesLoading, isError: casesError, refetch: refetchCases } =
    useEvalCases(agent.id);
  const runSet = useRunEvalSet(agent.id);
  const runCase = useRunEvalCase(agent.id);
  const deleteCase = useDeleteEvalCase(agent.id);

  const [editingCase, setEditingCase] = React.useState<EvalCase | "new" | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<EvalCase | null>(null);
  const [runningCaseId, setRunningCaseId] = React.useState<string | null>(null);

  const loading = dashLoading || casesLoading;
  const isError = dashError || casesError;
  const recentRuns = dashboard?.recent_runs ?? [];
  const caseRows = cases ?? [];

  function handleRunAll() {
    runSet.mutate(undefined, {
      onSuccess: () => toast.success(t("evals.runAllSuccess")),
    });
  }

  function handleRunCase(evalCase: EvalCase) {
    setRunningCaseId(evalCase.id);
    runCase.mutate(evalCase.id, {
      onSuccess: () => toast.success(t("evals.runCaseSuccess", { name: evalCase.name })),
      onSettled: () => setRunningCaseId(null),
    });
  }

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("evals.title")}</h2>
        <Button kind="secondary" icon="Plus" onClick={() => setEditingCase("new")}>
          {t("evals.newCase")}
        </Button>
        <Button kind="primary" icon="Play" loading={runSet.isPending} onClick={handleRunAll}>
          {runSet.isPending ? t("evals.runningAll") : t("evals.runAll")}
        </Button>
      </div>

      {isError ? (
        <ErrorState
          body={t("evals.loadError")}
          onRetry={() => {
            void refetchDash();
            void refetchCases();
          }}
        />
      ) : loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Skeleton height={90} />
          <Skeleton height={40} />
          <Skeleton height={40} />
        </div>
      ) : (
        <>
          <div style={s.tiles}>
            <MetricCard
              label={t("evals.recall")}
              value={pct(dashboard!.current.recall)}
              suffix="%"
              delta={dashboard!.delta.recall * 100}
            />
            <MetricCard
              label={t("evals.precision")}
              value={pct(dashboard!.current.precision)}
              suffix="%"
              delta={dashboard!.delta.precision * 100}
            />
            <MetricCard
              label={t("evals.citationAccuracy")}
              value={pct(dashboard!.current.citation_accuracy)}
              suffix="%"
              delta={dashboard!.delta.citation_accuracy * 100}
            />
            <MetricCard
              label={t("evals.tracesPassed")}
              value={`${dashboard!.current.traces_passed}/${dashboard!.current.traces_total}`}
            />
          </div>

          {dashboard!.alert && (
            <div role="status" style={s.alert}>
              <Icon.AlertTriangle size={13} />
              {dashboard!.alert}
            </div>
          )}

          {caseRows.length === 0 ? (
            <div style={s.empty}>{t("evals.empty")}</div>
          ) : (
            <div style={s.list} role="list" aria-label={t("evals.title")}>
              {caseRows.map((c) => {
                const lastRun = latestRunForCase(recentRuns, c.id);
                const status = caseStatusIcon(lastRun);
                const StatusIcon = Icon[STATUS_ICON[status]];
                const expected = mustFindCount(c);
                const got = gotCount(lastRun);
                return (
                  <div key={c.id} style={s.row} role="listitem">
                    <span title={t(`evals.status.${status}`)}>
                      <StatusIcon size={16} style={{ color: STATUS_COLOR[status] }} aria-hidden="true" />
                    </span>
                    <span style={s.name}>{c.name}</span>
                    <span style={s.counts}>
                      {t("evals.expectedGot", { expected, got: got ?? "—" })}
                    </span>
                    <div style={s.actions}>
                      <IconBtn
                        icon="Play"
                        label={t("evals.runCase", { name: c.name })}
                        onClick={() => handleRunCase(c)}
                      />
                      <IconBtn icon="Edit" label={t("evals.editCase", { name: c.name })} onClick={() => setEditingCase(c)} />
                      <IconBtn
                        icon="Trash"
                        label={t("evals.deleteCase", { name: c.name })}
                        danger
                        onClick={() => setDeleteTarget(c)}
                      />
                    </div>
                    {runningCaseId === c.id && (
                      <span role="status" style={s.counts}>
                        {t("evals.running")}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {editingCase && (
        <EvalCaseModal
          agentId={agent.id}
          evalCase={editingCase === "new" ? null : editingCase}
          lastRun={editingCase === "new" ? undefined : latestRunForCase(recentRuns, editingCase.id)}
          onClose={() => setEditingCase(null)}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={t("evals.deleteConfirmTitle")}
          body={t("evals.deleteConfirmBody", { name: deleteTarget.name })}
          pending={deleteCase.isPending}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            deleteCase.mutate(deleteTarget.id, {
              onSuccess: () => {
                toast.success(t("evals.deleteSuccess", { name: deleteTarget.name }));
                setDeleteTarget(null);
              },
            });
          }}
        />
      )}
    </div>
  );
}
