/* EvalDashboardListView — /eval-dashboard (spec §6.10 AC-33, plan Work Item 13).
   Composes `useAgents()` (existing hook) with one `useEvalDashboard(agent.id)`
   call PER agent — N client-side calls, no new bulk backend endpoint, per
   spec §12/AC-33. Each row is its own component (`EvalDashboardRow`) so each
   agent's dashboard hook call is a real, independent hook call rather than
   one called in a loop from this component's own body. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useAgents } from "@/lib/hooks/agents";
import { EvalDashboardRow } from "./_components/EvalDashboardRow";
import { s } from "./styles";

export function EvalDashboardListView() {
  const t = useTranslations("evalDashboard");
  const router = useRouter();
  // Full destructure (data/isLoading/isError/refetch) — dropping `isError`
  // silently degrades a real load failure into the empty-state copy
  // (client/INSIGHTS.md, 2026-08-06 entry).
  const { data: agents, isLoading, isError, refetch } = useAgents();

  const list = agents ?? [];

  return (
    <AppShell crumb={[{ label: t("list.breadcrumbLab") }, { label: t("list.breadcrumb") }]}>
      <div style={s.page}>
        <div style={s.header}>
          <h1 style={s.h1}>{t("list.title")}</h1>
          <p style={s.subtitle}>{t("list.subtitle")}</p>
        </div>

        {isLoading && (
          <div style={s.list} aria-label={t("list.title")}>
            <Skeleton height={72} />
            <Skeleton height={72} />
            <Skeleton height={72} />
          </div>
        )}

        {isError && <ErrorState body={t("list.loadError")} onRetry={() => refetch()} />}

        {!isLoading && !isError && list.length === 0 && (
          <EmptyState icon="Gauge" title={t("list.emptyTitle")} body={t("list.emptyBody")} />
        )}

        {!isLoading && !isError && list.length > 0 && (
          <div style={s.list} role="list" aria-label={t("list.title")}>
            {list.map((agent) => (
              <EvalDashboardRow
                key={agent.id}
                agent={agent}
                onSelect={() => router.push(`/eval-dashboard/${agent.id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
