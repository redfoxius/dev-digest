import type { Skill } from "@devdigest/shared";

/** Untrusted-source skills (`imported_url`/`community`) start disabled until
   a human vets them — distinct from a skill someone simply chose to turn
   off. `manual` (typed, pasted, or directly uploaded) never needs vetting.
   Shared by SkillsListView, ConfigTab, PreviewTab, and the Agent Editor's
   Skills tab — a single domain rule, not per-component logic. */
export function needsVetting(skill: Skill): boolean {
  return !skill.enabled && skill.source !== "manual";
}
