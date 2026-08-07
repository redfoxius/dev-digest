import type { CommunitySkill } from "@devdigest/shared";
import { ALL_LANGUAGES } from "./constants";

/** Distinct languages present in the catalog, in first-seen order — feeds
   the language filter chip row (in addition to the always-first "All
   languages" chip). */
export function distinctLanguages(skills: CommunitySkill[]): string[] {
  const seen = new Set<string>();
  for (const s of skills) seen.add(s.lang);
  return Array.from(seen);
}

/** Client-side search + language filter over the (small, static) community
   catalog — no server-side query params for this course-scope feature. */
export function filterCommunitySkills(skills: CommunitySkill[], search: string, lang: string): CommunitySkill[] {
  const q = search.trim().toLowerCase();
  return skills.filter((s) => {
    if (lang !== ALL_LANGUAGES && s.lang !== lang) return false;
    if (!q) return true;
    return `${s.name} ${s.desc}`.toLowerCase().includes(q);
  });
}
