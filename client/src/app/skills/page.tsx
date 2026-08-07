/* /skills — Skills master-detail (no skill selected). Left: the full
   catalog (SkillsListView). Right: a "pick one" prompt — matches
   `page.selectPrompt.*` copy written for exactly this state. */
"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { EmptyState } from "@devdigest/ui";
import { AppShell } from "../../components/app-shell";
import { SkillsListView } from "./_components/SkillsListView";

export default function SkillsPage() {
  const t = useTranslations("skills");
  const router = useRouter();

  const crumb = [{ label: t("page.crumbLab") }, { label: t("page.crumbSkills") }];

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
            onSelect={(id) => router.push(`/skills/${id}`)}
            onNewSkill={() => router.push("/skills/new")}
          />
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <EmptyState icon="Sparkles" title={t("page.selectPrompt.title")} body={t("page.selectPrompt.body")} />
        </div>
      </div>
    </AppShell>
  );
}
