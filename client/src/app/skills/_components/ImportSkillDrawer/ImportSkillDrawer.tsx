/* ImportSkillDrawer — "+ Add Skill" → File / URL. Community search is a
   separate, full-width panel (CommunitySkillsDrawer), not a third tab here —
   see docs/skills-feature-plan.md point 6. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Drawer, Tabs } from "@devdigest/ui";
import { FileTab } from "./_components/FileTab";
import { UrlTab } from "./_components/UrlTab";
import { s } from "./styles";

export function ImportSkillDrawer({
  initialTab = "file",
  onClose,
}: {
  initialTab?: "file" | "url";
  onClose: () => void;
}) {
  const t = useTranslations("skills");
  const [tab, setTab] = React.useState<"file" | "url">(initialTab);

  return (
    <Drawer title={t("drawer.title")} subtitle={t("drawer.subtitle")} onClose={onClose}>
      <div style={s.tabsBar}>
        <Tabs
          tabs={[
            { key: "file", label: t("drawer.tabs.file"), icon: "File" },
            { key: "url", label: t("drawer.tabs.url"), icon: "Globe" },
          ]}
          value={tab}
          onChange={(k) => setTab(k as "file" | "url")}
          pad="0"
        />
      </div>
      {tab === "file" ? <FileTab onImported={onClose} /> : <UrlTab onImported={onClose} />}
    </Drawer>
  );
}
