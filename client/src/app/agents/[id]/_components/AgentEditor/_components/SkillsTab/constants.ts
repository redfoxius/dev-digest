import type { SkillType } from "@devdigest/shared";

/** Colored type badge per skill type — reuses existing semantic CSS vars
   (no new tokens introduced) rather than inventing per-type colors. */
export const SKILL_TYPE_COLORS: Record<SkillType, string> = {
  rubric: "var(--info)",
  convention: "var(--accent)",
  security: "var(--crit)",
  custom: "var(--text-secondary)",
};
