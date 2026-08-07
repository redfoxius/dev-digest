/* ConfigTab — name/description/type/body form. Doubles as:
   (1) the SkillDetail "Config" tab when editing an existing skill (`skill`
       set) — Save prompts an optional one-line "what changed?" summary and
       calls `useUpdateSkill`;
   (2) the standalone "+ New skill" blank-create view (`skill` is `null`) —
       no drawer/preview step, Save calls `useCreateSkill` directly. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import CodeEditor from "@uiw/react-textarea-code-editor";
import { Badge, Button, FormField, Icon, SelectInput, TextInput, Toggle } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { useCreateSkill, useUpdateSkill } from "../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../lib/toast";
import { useTheme } from "../../../../../../lib/theme";
import { needsVetting } from "../../../../../../lib/skills";
import { SKILL_TYPE_VALUES } from "./constants";
import { bodyFilename, estimateTokens } from "./helpers";
import { s } from "./styles";

export function ConfigTab({ skill, onCreated }: { skill: Skill | null; onCreated?: (skill: Skill) => void }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const { theme } = useTheme();
  const create = useCreateSkill();
  const update = useUpdateSkill();

  // Initial values only — the parent remounts this component via
  // `key={skill.id}` whenever the underlying skill identity changes
  // (switching selection in the list, or a create → edit hand-off), so no
  // effect-based resync is needed (or correct: an effect keyed on `skill?.id`
  // would leave stale field values in place if the cached `skill` object's
  // CONTENT changes without its `id` changing — e.g. a concurrent edit
  // refetched elsewhere).
  const [name, setName] = React.useState(skill?.name ?? "");
  const [description, setDescription] = React.useState(skill?.description ?? "");
  const [type, setType] = React.useState<SkillType>(skill?.type ?? "custom");
  const [body, setBody] = React.useState(skill?.body ?? "");
  const [enabled, setEnabled] = React.useState(skill?.enabled ?? true);

  const configChanged = skill
    ? name !== skill.name || description !== skill.description || type !== skill.type || body !== skill.body
    : false;
  const dirty = skill ? configChanged || enabled !== skill.enabled : name.trim() !== "" || body.trim() !== "";
  const vetting = skill ? needsVetting(skill) : false;

  const saveEdit = () => {
    if (!skill) return;
    let summary: string | undefined;
    if (configChanged && typeof window !== "undefined") {
      const entered = window.prompt("What changed? (optional — recorded on this skill's version history)", "");
      summary = entered?.trim() ? entered.trim() : undefined;
    }
    update.mutate(
      { id: skill.id, patch: { name, description, type, body, enabled, ...(summary ? { summary } : {}) } },
      { onSuccess: (data) => toast.success(t("preview.version", { version: data.version })) },
    );
  };

  const saveCreate = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error(t("create.nameRequired"));
      return;
    }
    if (!body.trim()) {
      toast.error(t("create.bodyRequired"));
      return;
    }
    create.mutate(
      { name: trimmedName, description: description.trim(), type, body },
      {
        onSuccess: (data) => {
          toast.success(t("create.success", { name: data.name }));
          onCreated?.(data);
        },
      },
    );
  };

  const pending = skill ? update.isPending : create.isPending;
  const saveLabel = skill
    ? update.isPending
      ? "Saving…"
      : t("preview.save")
    : create.isPending
      ? t("create.saving")
      : t("create.save");

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{skill ? skill.name || t("create.title") : t("create.title")}</h2>
        {skill && (
          <Badge mono>{t("preview.version", { version: skill.version })}</Badge>
        )}
        <label style={s.enabledLabel}>
          {enabled ? t("preview.enabled") : t("preview.disabled")}
          <Toggle on={enabled} onChange={setEnabled} size={16} />
        </label>
      </div>

      {vetting && (
        <div style={s.untrustedBanner}>
          <Icon.AlertTriangle size={16} style={{ color: "var(--warn)", flexShrink: 0, marginTop: 1 }} />
          <span>{t("preview.untrustedNotice")}</span>
        </div>
      )}

      <FormField label={t("file.nameLabel")} required>
        <TextInput value={name} onChange={setName} placeholder={t("file.namePlaceholder")} mono />
      </FormField>
      <FormField label={t("create.descriptionLabel")}>
        <TextInput value={description} onChange={setDescription} placeholder={t("create.descriptionPlaceholder")} />
      </FormField>
      <FormField label={t("create.typeLabel")}>
        <SelectInput
          value={type}
          onChange={(v) => setType(v as SkillType)}
          options={SKILL_TYPE_VALUES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }))}
        />
      </FormField>
      <FormField
        label={t("file.bodyLabel")}
        hint={t("file.bodyHint")}
        right={
          <span style={s.editorFieldRight}>
            {dirty && <span style={s.unsavedPill}>unsaved</span>}
            {body.length} chars · ~{estimateTokens(body)} tokens
          </span>
        }
      >
        <div style={s.editorFrame}>
          <div style={s.editorTitleBar}>
            <Icon.FileText size={13} style={{ color: "var(--text-muted)" }} />
            <span className="mono" style={s.editorFilename}>
              {bodyFilename(name)}
            </span>
          </div>
          <CodeEditor
            value={body}
            language="markdown"
            placeholder={t("file.bodyPlaceholder")}
            onChange={(e) => setBody(e.target.value)}
            padding={12}
            minHeight={220}
            data-color-mode={theme}
            style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 13 }}
          />
        </div>
      </FormField>

      <div style={s.actions}>
        <Button kind="primary" icon="Check" onClick={skill ? saveEdit : saveCreate} disabled={pending}>
          {saveLabel}
        </Button>
        {skill && update.isSuccess && !update.isPending && <span style={s.savedNote}>Saved</span>}
      </div>
    </div>
  );
}
