import type { ContextDocRoot } from "@devdigest/shared";

/** Colored type badge per search root — reuses existing semantic CSS vars
   (no new tokens introduced), mirroring SkillsTab's SKILL_TYPE_COLORS. */
export const ROOT_TYPE_COLORS: Record<ContextDocRoot, string> = {
  specs: "var(--accent)",
  docs: "var(--info)",
  insights: "var(--text-secondary)",
};

/** Rough chars-per-token ratio for the live "≈ N tokens" footer estimate.
   Duplicated (not imported) from
   client/src/app/skills/_components/SkillDetail/_components/ConfigTab/constants.ts:9
   — the client cannot import `reviewer-core` (server-only TS-source path
   alias, not wired for client), per this feature's plan Gotchas. */
export const CHARS_PER_TOKEN = 4;
