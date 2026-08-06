/* CommunitySkillsDrawer — its own full-width search panel, reachable from the
   same "+ Add Skill" dropdown as ImportSkillDrawer but NOT sharing its tabs
   (own title/subtitle, filter chips, result cards) — see
   docs/skills-feature-plan.md point 6. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Card, Drawer, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { useCommunitySkills, useInstallCommunitySkill } from "../../../../lib/hooks/skills";
import { useToast } from "../../../../lib/toast";
import { ALL_LANGUAGES, TAG_CHIPS } from "./constants";
import { distinctLanguages, filterCommunitySkills } from "./helpers";
import { s } from "./styles";

export function CommunitySkillsDrawer({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const { data: skills, isLoading, isError, refetch } = useCommunitySkills();
  const install = useInstallCommunitySkill();

  const [search, setSearch] = React.useState("");
  const [lang, setLang] = React.useState<string>(ALL_LANGUAGES);

  const languages = distinctLanguages(skills ?? []);
  const list = filterCommunitySkills(skills ?? [], search, lang);

  const importSkill = (name: string) =>
    install.mutate(name, {
      onSuccess: (data) => toast.success(t("file.success", { name: data.name })),
    });

  return (
    <Drawer width={960} title="Search community skills" subtitle="Import vetted skills from public repos" onClose={onClose}>
      <div style={s.search}>
        <Icon.Search size={14} style={s.searchIcon} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("community.searchPlaceholder")}
          style={s.searchInput}
        />
      </div>

      <div style={s.chipRow}>
        <button style={s.chip(lang === ALL_LANGUAGES)} onClick={() => setLang(ALL_LANGUAGES)}>
          {t("community.allLanguages")}
        </button>
        {languages.map((l) => (
          <button key={l} style={s.chip(lang === l)} onClick={() => setLang(l)}>
            {l}
          </button>
        ))}
        {TAG_CHIPS.map((tag) => (
          <button
            key={tag}
            style={s.chip(search.trim().toLowerCase() === tag)}
            onClick={() => setSearch((prev) => (prev.trim().toLowerCase() === tag ? "" : tag))}
          >
            {tag}
          </button>
        ))}
      </div>

      {isLoading && (
        <div style={s.grid}>
          <Skeleton height={140} />
          <Skeleton height={140} />
          <Skeleton height={140} />
        </div>
      )}
      {isError && <ErrorState body={t("community.loadError")} onRetry={() => refetch()} />}
      {!isLoading && !isError && list.length === 0 && (
        <EmptyState icon="Users" title={t("community.noMatch.title")} body={t("community.noMatch.body")} />
      )}
      {list.length > 0 && (
        <div style={s.grid}>
          {list.map((sk) => {
            const pending = install.isPending && install.variables === sk.name;
            return (
              <Card key={sk.name} style={s.card}>
                <div style={s.cardHeader}>
                  <span className="mono" style={s.cardName}>
                    {sk.name}
                  </span>
                  <span style={s.stars}>
                    <Icon.Star size={12} />
                    {sk.stars}
                  </span>
                </div>
                <div style={s.desc}>{sk.desc}</div>
                <div style={s.metaRow}>
                  <Icon.GitBranch size={12} />
                  <span>{sk.repo}</span>
                  <Icon.Dot size={10} />
                  <span>{sk.lang}</span>
                </div>
                <Button kind="secondary" size="sm" icon="Plus" onClick={() => importSkill(sk.name)} disabled={pending}>
                  {pending ? t("community.importing") : t("community.import")}
                </Button>
              </Card>
            );
          })}
        </div>
      )}
    </Drawer>
  );
}
