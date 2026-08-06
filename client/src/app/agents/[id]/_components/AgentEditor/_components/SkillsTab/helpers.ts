import type { AgentSkillLink, Skill } from "@devdigest/shared";

/** One row of the unified Skills-tab list: every workspace skill, paired
   with this agent's link row when one exists. `link` is undefined for a
   skill that has never been attached to this agent. */
export interface SkillRow {
  skill: Skill;
  link?: AgentSkillLink;
}

/** Merges the full workspace catalog with this agent's current links into
   ONE ordered list: linked skills first (ascending by their existing
   `order`), then unlinked skills appended after, stable by name. A link
   whose `skill_id` no longer resolves to a catalog skill (deleted skill)
   is dropped rather than rendered as a ghost row. */
export function mergeSkills(skills: Skill[] | undefined, links: AgentSkillLink[] | undefined): SkillRow[] {
  const skillById = new Map((skills ?? []).map((sk) => [sk.id, sk]));
  const sortedLinks = (links ?? []).slice().sort((a, b) => a.order - b.order);

  const linkedRows: SkillRow[] = [];
  const linkedIds = new Set<string>();
  for (const link of sortedLinks) {
    const skill = skillById.get(link.skill_id);
    if (!skill) continue; // stale link, catalog skill no longer exists
    linkedRows.push({ skill, link });
    linkedIds.add(skill.id);
  }

  const unlinkedRows: SkillRow[] = (skills ?? [])
    .filter((sk) => !linkedIds.has(sk.id))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((skill) => ({ skill }));

  return [...linkedRows, ...unlinkedRows];
}

/** Case-insensitive substring match over the skill's name, for the
   "Filter skills…" input. Empty/whitespace filter matches everything. */
export function matchesSkillFilter(skill: Skill, filter: string): boolean {
  const needle = filter.trim().toLowerCase();
  if (!needle) return true;
  return skill.name.toLowerCase().includes(needle);
}

/** Moves the row identified by `dragId` to sit at the position currently
   occupied by `targetId`, preserving every other row's relative order.
   Returns `rows` unchanged if either id can't be found or they're equal. */
export function reorderSkillRows(rows: SkillRow[], dragId: string, targetId: string): SkillRow[] {
  if (dragId === targetId) return rows;
  const dragIndex = rows.findIndex((r) => r.skill.id === dragId);
  const targetIndex = rows.findIndex((r) => r.skill.id === targetId);
  if (dragIndex === -1 || targetIndex === -1) return rows;

  const next = rows.slice();
  const [dragged] = next.splice(dragIndex, 1);
  const insertAt = next.findIndex((r) => r.skill.id === targetId);
  next.splice(insertAt === -1 ? targetIndex : insertAt, 0, dragged!);
  return next;
}
