/* SkillsListView — the /skills master list (left panel). Mirrors
   AgentsListView's header shape (title + search + "add" affordance) but adds
   a second, separate "+ New skill" entry point (blank-create, no drawer) next
   to the "+ Add Skill" import dropdown (file / URL / community). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Dropdown, EmptyState, ErrorState, Skeleton, Icon, Badge, Toggle } from "@devdigest/ui";
import { useSkills, useUpdateSkill } from "../../../../lib/hooks/skills";
import { needsVetting } from "../../../../lib/skills";
import { ImportSkillDrawer } from "../ImportSkillDrawer";
import { CommunitySkillsDrawer } from "../CommunitySkillsDrawer";
import { SOURCE_ICON, TYPE_META } from "./constants";
import { filterSkills } from "./helpers";
import { s } from "./styles";

export function SkillsListView({
  activeId,
  onSelect,
  onNewSkill,
}: {
  activeId?: string;
  onSelect: (id: string) => void;
  onNewSkill: () => void;
}) {
  const t = useTranslations("skills");
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const update = useUpdateSkill();
  const [search, setSearch] = React.useState("");
  const [importTab, setImportTab] = React.useState<"file" | "url" | null>(null);
  const [communityOpen, setCommunityOpen] = React.useState(false);

  const list = filterSkills(skills ?? [], search);

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div style={s.headerTop}>
          <h1 style={s.h1}>{t("page.heading")}</h1>
          <Button kind="secondary" size="sm" icon="Plus" onClick={onNewSkill}>
            {t("create.button")}
          </Button>
          <Dropdown
            width={230}
            align="right"
            trigger={
              <Button kind="primary" size="sm" icon="Plus" iconRight="ChevronDown">
                {t("page.addSkill")}
              </Button>
            }
            items={[
              { label: t("page.menu.fromFile"), icon: "File", onClick: () => setImportTab("file") },
              { label: t("page.menu.fromUrl"), icon: "Globe", onClick: () => setImportTab("url") },
              { label: t("page.menu.community"), icon: "Users", onClick: () => setCommunityOpen(true) },
            ]}
          />
        </div>
        <div style={s.search}>
          <Icon.Search size={13} style={s.searchIcon} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("page.searchPlaceholder")}
            style={s.searchInput}
          />
        </div>
      </div>

      <div style={s.list}>
        {isLoading && (
          <div style={s.skeletonWrap}>
            <Skeleton height={86} />
            <Skeleton height={86} />
            <Skeleton height={86} />
          </div>
        )}
        {isError && <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />}
        {!isLoading && !isError && list.length === 0 && (
          <EmptyState
            icon="Sparkles"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            onCta={() => setImportTab("file")}
          />
        )}
        {list.map((sk) => {
          const type = TYPE_META[sk.type];
          const TypeIcon = Icon[type.icon];
          const sourceIconName = SOURCE_ICON[sk.source];
          const active = sk.id === activeId;
          const vetting = needsVetting(sk);
          return (
            <div key={sk.id} onClick={() => onSelect(sk.id)} style={s.card(active, sk.enabled)}>
              <div style={s.cardHeaderRow}>
                <div style={s.iconBox(type.color, type.bg)}>
                  <TypeIcon size={14} />
                </div>
                <span style={s.name}>{sk.name}</span>
                <div onClick={(e) => e.stopPropagation()}>
                  <Toggle
                    on={sk.enabled}
                    onChange={(enabled) => update.mutate({ id: sk.id, patch: { enabled } })}
                    size={14}
                  />
                </div>
              </div>
              <div style={s.description}>{sk.description}</div>
              <div style={s.metaRow}>
                <Badge color={type.color} bg={type.bg}>
                  {t(`listItem.type.${sk.type}`)}
                </Badge>
                <Badge icon={sourceIconName}>{t(`listItem.source.${sk.source}`)}</Badge>
                {vetting && (
                  <span title={t("listItem.vettingTitle")}>
                    <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
                      {t("listItem.needsVetting")}
                    </Badge>
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {importTab && <ImportSkillDrawer initialTab={importTab} onClose={() => setImportTab(null)} />}
      {communityOpen && <CommunitySkillsDrawer onClose={() => setCommunityOpen(false)} />}
    </div>
  );
}
