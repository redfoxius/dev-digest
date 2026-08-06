/* SkillDetail — the /skills right pane. Two shapes, one component:
   - `skill` set: the full 5-tab shell (Config/Preview/Evals/Stats/Versions).
   - `skill` null: the "+ New skill" blank-create view — just the
     Config-tab-shaped form directly, no Tabs bar (no drawer, no preview
     step; Evals/Stats/Versions all need an existing skill id). */
"use client";

import React from "react";
import { EmptyState, Tabs } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { ConfigTab } from "./_components/ConfigTab";
import { PreviewTab } from "./_components/PreviewTab";
import { VersionsTab } from "./_components/VersionsTab";
import { TABS } from "./constants";
import { s } from "./styles";

export function SkillDetail({
  skill,
  tab,
  onTab,
  onCreated,
}: {
  skill: Skill | null;
  tab?: string;
  onTab?: (t: string) => void;
  onCreated?: (skill: Skill) => void;
}) {
  if (!skill) {
    return (
      <div style={s.wrap}>
        <div style={s.body}>
          <ConfigTab skill={null} onCreated={onCreated} />
        </div>
      </div>
    );
  }

  const activeTab = tab ?? "config";
  return (
    <div style={s.wrap}>
      <div style={s.tabsBar}>
        <Tabs tabs={[...TABS]} value={activeTab} onChange={onTab ?? (() => {})} pad="0 28px" />
      </div>
      <div style={s.body}>
        {activeTab === "config" && <ConfigTab skill={skill} />}
        {activeTab === "preview" && <PreviewTab skill={skill} />}
        {activeTab === "evals" && (
          <EmptyState
            icon="FlaskConical"
            title="Evals"
            body="Skill-level eval cases are a separate, not-yet-built feature (owner_kind: 'skill')."
          />
        )}
        {activeTab === "stats" && (
          <EmptyState
            icon="BarChart"
            title="Stats"
            body="Performance analytics for skills is a separate, not-yet-built feature."
          />
        )}
        {activeTab === "versions" && <VersionsTab skill={skill} />}
      </div>
    </div>
  );
}
