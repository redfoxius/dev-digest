import type { IconName } from "@devdigest/ui";

/** SkillDetail's 5-tab shell. Config/Preview/Versions are in scope; Evals/
   Stats render an out-of-scope placeholder (separate, not-yet-built
   eval-cases / performance-analytics features — see
   docs/skills-feature-plan.md's "Skill Editor — tab scope" table). */
export interface DetailTab {
  key: string;
  label: string;
  icon: IconName;
}

export const TABS: readonly DetailTab[] = [
  { key: "config", label: "Config", icon: "Settings" },
  { key: "context", label: "Context", icon: "FileText" },
  { key: "preview", label: "Preview", icon: "Eye" },
  { key: "evals", label: "Evals", icon: "FlaskConical" },
  { key: "stats", label: "Stats", icon: "BarChart" },
  { key: "versions", label: "Versions", icon: "History" },
];

export const VALID_DETAIL_TABS: readonly string[] = TABS.map((tb) => tb.key);
