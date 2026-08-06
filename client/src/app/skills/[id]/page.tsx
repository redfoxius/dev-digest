/* /skills/:id — Skills master-detail (editor). Left agent list mirrors
   /skills; right pane is SkillDetail's 5-tab shell. `id === "new"` is the
   "+ New skill" blank-create state (no fetch, no drawer, no preview step —
   SkillDetail itself renders just the Config-tab-shaped form). Tab state
   lives in ?tab=, mirroring /agents/:id. */
"use client";

import React, { Suspense } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "../../../components/app-shell";
import { SkillsListView } from "../_components/SkillsListView";
import { SkillDetail } from "../_components/SkillDetail";
import { VALID_DETAIL_TABS } from "../_components/SkillDetail/constants";
import { useSkill } from "../../../lib/hooks/skills";
import { ApiError } from "../../../lib/api";

export default function SkillDetailPage() {
  return (
    <Suspense fallback={<Skeleton height={24} width={240} />}>
      <SkillDetailPageInner />
    </Suspense>
  );
}

function SkillDetailPageInner() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const t = useTranslations("skills");
  const { id } = params;
  const isNew = id === "new";

  const { data: skill, isLoading, isError, error, refetch } = useSkill(isNew ? null : id);

  const tabParam = search.get("tab") ?? "";
  const tab = VALID_DETAIL_TABS.includes(tabParam) ? tabParam : "config";
  const setTab = (t2: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("tab", t2);
    router.replace(`/skills/${id}?${sp.toString()}`);
  };

  const notFound = error instanceof ApiError && error.status === 404;
  const crumb = [
    { label: t("page.crumbLab") },
    { label: t("page.crumbSkills"), href: "/skills" },
    { label: isNew ? t("create.crumb") : skill?.name || t("detail.crumbSkill") },
  ];

  const failed = !isNew && (isError || (!isLoading && !skill));

  if (failed) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title={notFound ? t("detail.notFound.title") : undefined}
          body={
            notFound
              ? t("detail.notFound.body")
              : error instanceof ApiError
                ? error.message
                : t("detail.loadError")
          }
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div style={{ display: "flex", height: "calc(100vh - 52px)" }}>
        <div
          style={{
            width: 340,
            flexShrink: 0,
            borderRight: "1px solid var(--border)",
            background: "var(--bg-surface)",
          }}
        >
          <SkillsListView
            activeId={isNew ? undefined : id}
            onSelect={(sid) => router.push(`/skills/${sid}`)}
            onNewSkill={() => router.push("/skills/new")}
          />
        </div>
        {!isNew && (isLoading || !skill) ? (
          <div style={{ flex: 1, padding: 28 }}>
            <Skeleton height={24} width={240} />
            <div style={{ marginTop: 16 }}>
              <Skeleton height={200} />
            </div>
          </div>
        ) : (
          <SkillDetail
            skill={isNew ? null : (skill ?? null)}
            tab={tab}
            onTab={setTab}
            onCreated={(created) => router.replace(`/skills/${created.id}?tab=config`)}
          />
        )}
      </div>
    </AppShell>
  );
}
