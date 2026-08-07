/* SkillsTab — Agent Editor's unified skill-catalog list. One row per
   workspace skill (linked ones first, in order); a Checkbox both attaches
   and toggles injection, drag reorders the FULL list (checked + unchecked)
   via `useSetAgentSkills`. See docs/skills-feature-plan.md's "Client:
   Agent Editor — Skills tab" for the full spec this mirrors. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Checkbox, ErrorState, Icon, Badge, Skeleton } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import {
  useAgentSkills,
  useSetAgentSkillEnabled,
  useSetAgentSkills,
} from "../../../../../../../lib/hooks/agents";
import { useSkills } from "../../../../../../../lib/hooks/skills";
import { needsVetting } from "../../../../../../../lib/skills";
import { SKILL_TYPE_COLORS } from "./constants";
import { matchesSkillFilter, mergeSkills, reorderSkillRows, type SkillRow } from "./helpers";
import { s } from "./styles";

export function SkillsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const {
    data: skills,
    isLoading: skillsLoading,
    isError: skillsError,
    refetch: refetchSkills,
  } = useSkills();
  const {
    data: links,
    isLoading: linksLoading,
    isError: linksError,
    refetch: refetchLinks,
  } = useAgentSkills(agent.id);
  const setSkills = useSetAgentSkills(agent.id);
  const setEnabled = useSetAgentSkillEnabled(agent.id);

  const [filter, setFilter] = React.useState("");
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [overId, setOverId] = React.useState<string | null>(null);

  const merged = React.useMemo(() => mergeSkills(skills, links), [skills, links]);
  // Optimistic order for an in-flight drag reorder only — NOT a synced copy
  // of `merged`. Set on drop, cleared once that specific `setSkills` mutation
  // settles. An unrelated `merged` recompute (e.g. another mutation elsewhere
  // invalidating `skills`/`links` while this one is still in flight) no
  // longer snaps the visible order back mid-interaction, since nothing
  // resyncs `rows` from `merged` on every render.
  const [optimisticRows, setOptimisticRows] = React.useState<SkillRow[] | null>(null);
  // Guards against a SECOND overlapping drag: if a new drop starts before the
  // previous one's mutation has settled, only the LATEST drop's `onSettled`
  // may clear `optimisticRows` — otherwise the first mutation settling after
  // a second drag started would wipe out the second drag's still-pending
  // optimistic order, snapping the list back mid-interaction.
  const dragTokenRef = React.useRef(0);
  const rows = optimisticRows ?? merged;

  const loading = skillsLoading || linksLoading;
  const isError = skillsError || linksError;
  const total = rows.length;
  const linkedEnabled = rows.filter((r) => r.link?.enabled).length;
  const visible = rows.filter((r) => matchesSkillFilter(r.skill, filter));

  function handleToggle(skillId: string, enabled: boolean) {
    setEnabled.mutate({ skillId, enabled });
  }

  function handleDrop(targetId: string) {
    if (dragId && dragId !== targetId) {
      const next = reorderSkillRows(rows, dragId, targetId);
      setOptimisticRows(next);
      const token = ++dragTokenRef.current;
      setSkills.mutate(next.map((r) => r.skill.id), {
        onSettled: () => {
          if (dragTokenRef.current === token) setOptimisticRows(null);
        },
      });
    }
    setDragId(null);
    setOverId(null);
  }

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("skills.title")}</h2>
        <Badge color="var(--text-secondary)">{t("skills.enabledCount", { linked: linkedEnabled, total })}</Badge>
        <div style={s.filter}>
          <Icon.Search size={13} style={s.filterIcon} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("skills.filterPlaceholder")}
            style={s.filterInput}
          />
        </div>
      </div>
      <div style={s.hint}>{t("skills.orderHint")}</div>

      {!isError && !loading && (
        <div role="status" aria-live="polite" style={s.srOnly}>
          {t("skills.resultCount", { count: visible.length })}
        </div>
      )}
      {isError ? (
        <ErrorState
          body={t("skills.loadError")}
          onRetry={() => {
            void refetchSkills();
            void refetchLinks();
          }}
        />
      ) : loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Skeleton height={40} />
          <Skeleton height={40} />
          <Skeleton height={40} />
        </div>
      ) : visible.length === 0 ? (
        <div style={s.list}>
          <div style={s.empty}>No skills match this filter.</div>
        </div>
      ) : (
        <div style={s.list}>
          {visible.map((row) => {
            const { skill, link } = row;
            const enabled = link?.enabled ?? false;
            const unvetted = needsVetting(skill);
            return (
              <div
                key={skill.id}
                style={s.row(overId === skill.id && dragId !== skill.id)}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragId) setOverId(skill.id);
                }}
                onDragLeave={() => setOverId((cur) => (cur === skill.id ? null : cur))}
                onDrop={(e) => {
                  e.preventDefault();
                  handleDrop(skill.id);
                }}
              >
                <span
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", skill.id);
                    setDragId(skill.id);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverId(null);
                  }}
                  style={s.handle}
                  aria-label={`Reorder ${skill.name}`}
                  role="button"
                >
                  <Icon.Menu size={14} />
                </span>
                <Checkbox checked={enabled} onChange={(v) => handleToggle(skill.id, v)} />
                <span className="mono" style={s.name}>
                  {skill.name}
                </span>
                {unvetted && (
                  <span style={s.vetting}>
                    <Icon.AlertTriangle size={12} />
                    needs vetting
                  </span>
                )}
                <Badge color={SKILL_TYPE_COLORS[skill.type]}>{skill.type}</Badge>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
