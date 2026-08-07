/* CreateSkillFromConventionsModal — "Create skill from conventions": on open,
   fetches a prefilled draft (name/description/body) merged from the given
   accepted candidate ids; everything is editable before Create. Mirrors the
   Skill Config tab's code-editor field (@uiw/react-textarea-code-editor). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import CodeEditor from "@uiw/react-textarea-code-editor";
import { Button, FormField, Icon, Modal, SelectInput, TextInput, Toggle } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { useCreateSkillFromConventions, useSkillDraftFromConventions } from "@/lib/hooks/conventions";
import { useToast } from "@/lib/toast";
import { useTheme } from "@/lib/theme";
import { s } from "./styles";

const SKILL_TYPES: SkillType[] = ["convention", "rubric", "security", "custom"];

export function CreateSkillFromConventionsModal({
  repoId,
  repoLabel,
  candidateIds,
  onClose,
  onCreated,
}: {
  repoId: string;
  repoLabel: string;
  candidateIds: string[];
  onClose: () => void;
  onCreated?: (skill: Skill) => void;
}) {
  const t = useTranslations("conventions");
  const toast = useToast();
  const { theme } = useTheme();
  const draft = useSkillDraftFromConventions(repoId);
  const create = useCreateSkillFromConventions(repoId);

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [body, setBody] = React.useState("");
  const [type, setType] = React.useState<SkillType>("convention");
  const [enabled, setEnabled] = React.useState(true);
  const requested = React.useRef(false);

  React.useEffect(() => {
    if (requested.current || candidateIds.length === 0) return;
    requested.current = true;
    draft.mutate(candidateIds, {
      onSuccess: (data) => {
        setName(data.name);
        setDescription(data.description);
        setBody(data.body);
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateIds]);

  const handleCreate = () => {
    if (!name.trim() || !body.trim()) return;
    create.mutate(
      { candidate_ids: candidateIds, name: name.trim(), description: description.trim(), body, type, enabled },
      {
        onSuccess: (skill) => {
          toast.success(`Skill "${skill.name}" created`);
          onCreated?.(skill);
          onClose();
        },
      },
    );
  };

  return (
    <Modal
      width={760}
      title="Create skill from conventions"
      subtitle={name || "…"}
      onClose={onClose}
      footer={
        <div style={s.footerActions}>
          <Button kind="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            kind="primary"
            icon="Sparkles"
            disabled={draft.isPending || create.isPending || !name.trim() || !body.trim()}
            onClick={handleCreate}
          >
            {create.isPending ? "Creating…" : "Create skill"}
          </Button>
        </div>
      }
    >
      <div style={s.banner}>
        <Icon.Sparkles size={15} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>
          Merged from {candidateIds.length} accepted convention{candidateIds.length === 1 ? "" : "s"} in{" "}
          <strong>{repoLabel}</strong>. Everything below is editable before you save.
        </span>
      </div>

      <div style={s.field}>
        <FormField label="Name" required>
          <TextInput value={name} onChange={setName} placeholder="repo-conventions" mono />
        </FormField>
      </div>
      <div style={s.field}>
        <FormField label="Description">
          <TextInput value={description} onChange={setDescription} placeholder="What this skill covers" />
        </FormField>
      </div>
      <div style={s.row}>
        <div style={{ ...s.field, flex: 1 }}>
          <FormField label="Type">
            <SelectInput
              value={type}
              onChange={(v) => setType(v as SkillType)}
              options={SKILL_TYPES.map((v) => ({ value: v, label: v }))}
            />
          </FormField>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          Enabled
          <Toggle on={enabled} onChange={setEnabled} size={16} />
        </label>
      </div>

      <FormField label="Skill body" required>
        <div style={s.editorFrame}>
          <div style={s.editorTitleBar}>
            <Icon.FileText size={13} style={{ color: "var(--text-muted)" }} />
            <span className="mono">{(name || "skill").trim() || "skill"}.md</span>
            <span style={s.tokenCount}>{Math.ceil(body.length / 4)} tokens</span>
          </div>
          <CodeEditor
            value={body}
            language="markdown"
            onChange={(e) => setBody(e.target.value)}
            padding={12}
            minHeight={260}
            data-color-mode={theme}
            style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 13 }}
          />
        </div>
      </FormField>
    </Modal>
  );
}
