/* FileTab — "From file" pane of ImportSkillDrawer. Two convergent paths:
   (1) paste form (name+body, matches `file.*` copy) — paste IS the final
       content, posts straight to `useCreateSkill`, no preview step;
   (2) drop-zone / <input type="file"> upload (.md/.markdown/.zip/.tar/
       .tar.gz) — goes through `useImportFilePreview` → an editable-preview
       step → `useImportFileConfirm`. Both land `source: 'manual'`,
       `enabled: true` (a human provided the content directly). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, TextInput, Textarea, Markdown, Icon } from "@devdigest/ui";
import {
  useCreateSkill,
  useImportFileConfirm,
  useImportFilePreview,
  type ImportPreview,
} from "../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../lib/toast";
import { ApiError } from "../../../../../../lib/api";
import { FILE_INPUT_ACCEPT } from "../../constants";
import { deriveSkillName } from "../../helpers";
import { s } from "../../styles";

export function FileTab({ onImported }: { onImported: () => void }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const createSkill = useCreateSkill();
  const filePreview = useImportFilePreview();
  const fileConfirm = useImportFileConfirm();

  const [pasteName, setPasteName] = React.useState("");
  const [pasteBody, setPasteBody] = React.useState("");
  const [dragOver, setDragOver] = React.useState(false);
  const [preview, setPreview] = React.useState<ImportPreview | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    setPreview(null);
    filePreview.mutate(file, { onSuccess: (data) => setPreview(data) });
  };

  const submitPaste = () => {
    const name = pasteName.trim() || deriveSkillName(pasteBody);
    if (!name) {
      toast.error(t("create.nameRequired"));
      return;
    }
    createSkill.mutate(
      { name, type: "custom", body: pasteBody },
      {
        onSuccess: (data) => {
          toast.success(t("file.success", { name: data.name }));
          setPasteName("");
          setPasteBody("");
          onImported();
        },
      },
    );
  };

  const confirmUpload = () => {
    if (!preview) return;
    fileConfirm.mutate(preview, {
      onSuccess: (data) => {
        toast.success(t("file.success", { name: data.name }));
        setPreview(null);
        onImported();
      },
    });
  };

  if (preview) {
    return (
      <div style={s.previewWrap}>
        <div style={s.previewCard}>
          <Markdown>{preview.body}</Markdown>
        </div>
        {preview.ignored_files.length > 0 && (
          <div style={s.ignoredNotice}>
            <span>
              <Icon.AlertTriangle size={13} style={{ marginRight: 6, verticalAlign: -2 }} />
              {preview.ignored_files.length} file(s) ignored
            </span>
            <ul style={s.ignoredList}>
              {preview.ignored_files.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        )}
        <div style={s.statusNote("var(--ok)", "var(--ok-bg)")}>
          <Icon.CheckCircle size={14} />
          Manual — enabled immediately
        </div>
        {fileConfirm.isError && (
          <div style={s.error}>
            {t("drawer.importFailed")}
            {fileConfirm.error instanceof ApiError ? `: ${fileConfirm.error.message}` : ""}
          </div>
        )}
        <div style={s.actions}>
          <Button kind="secondary" onClick={() => setPreview(null)}>
            {t("create.cancel")}
          </Button>
          <Button kind="primary" icon="Check" onClick={confirmUpload} disabled={fileConfirm.isPending}>
            {fileConfirm.isPending ? t("file.importing") : t("file.import")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={s.section}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            pickFile(e.dataTransfer.files[0]);
          }}
          style={s.dropzone(dragOver)}
          aria-invalid={filePreview.isError}
          aria-describedby={filePreview.isError ? "file-import-error" : undefined}
        >
          <Icon.Upload size={22} style={{ color: "var(--text-muted)" }} />
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>Drop a file, or click to browse</div>
          <div style={s.dropzoneHint}>.md, .markdown, .zip, .tar, .tar.gz</div>
          <input
            ref={inputRef}
            type="file"
            accept={FILE_INPUT_ACCEPT}
            style={{ display: "none" }}
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
        </div>
        {filePreview.isPending && <div style={s.dropzoneHint}>{t("file.importing")}</div>}
        {filePreview.isError && (
          <div id="file-import-error" style={s.error}>
            {t("drawer.importFailed")}
            {filePreview.error instanceof ApiError ? `: ${filePreview.error.message}` : ""}
          </div>
        )}
      </div>

      <div style={s.divider}>
        <span style={s.dividerLine} />
        or paste directly
        <span style={s.dividerLine} />
      </div>

      <FormField label={t("file.nameLabel")} hint={t("file.nameHint")}>
        <TextInput value={pasteName} onChange={setPasteName} placeholder={t("file.namePlaceholder")} mono />
      </FormField>
      <FormField label={t("file.bodyLabel")} hint={t("file.bodyHint")}>
        <Textarea value={pasteBody} onChange={setPasteBody} placeholder={t("file.bodyPlaceholder")} rows={8} mono />
      </FormField>
      <div style={s.actions}>
        <Button
          kind="primary"
          icon="Check"
          onClick={submitPaste}
          disabled={createSkill.isPending || !pasteBody.trim()}
        >
          {createSkill.isPending ? t("file.importing") : t("file.import")}
        </Button>
      </div>
    </div>
  );
}
