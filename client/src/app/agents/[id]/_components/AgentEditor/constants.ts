import type { IconName } from "@devdigest/ui";

/** Editor tab descriptor. `labelKey` resolves under the `agents` namespace. */
export interface EditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/** Editor tabs. Part-0 shipped Config only; Skills, Context, and Evals were
   added on top of it — later lessons add Stats/CI. */
export const TABS: readonly EditorTab[] = [
  { key: "config", labelKey: "editor.tabs.config", icon: "Settings" },
  { key: "skills", labelKey: "editor.tabs.skills", icon: "Sparkles" },
  { key: "context", labelKey: "editor.tabs.context", icon: "FileText" },
  { key: "evals", labelKey: "editor.tabs.evals", icon: "FlaskConical" },
];

/** Single source of truth for which `?tab=` values the page route accepts —
   mirrors `SkillDetail/constants.ts`'s `VALID_DETAIL_TABS` derivation so a
   new tab can never be added to `TABS` without the page route also
   accepting it (a hardcoded, separately-maintained whitelist previously
   drifted out of sync with this list when the Context tab was added). */
export const VALID_TABS: readonly string[] = TABS.map((tb) => tb.key);
