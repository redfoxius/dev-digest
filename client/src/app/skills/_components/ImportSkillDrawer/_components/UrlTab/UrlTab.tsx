/* UrlTab — "From URL" pane of ImportSkillDrawer. Fetch server-side →
   preview → confirm. Lands `source: 'imported_url'`, `enabled: false`
   (fetched without a human in the loop — needs vetting). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, TextInput, Markdown, Icon } from "@devdigest/ui";
import { useImportUrlConfirm, useImportUrlPreview, type ImportPreview } from "../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../lib/toast";
import { ApiError } from "../../../../../../lib/api";
import { s } from "../../styles";

export function UrlTab({ onImported }: { onImported: () => void }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const urlPreview = useImportUrlPreview();
  const urlConfirm = useImportUrlConfirm();

  const [url, setUrl] = React.useState("");
  const [preview, setPreview] = React.useState<ImportPreview | null>(null);

  const fetchPreview = () => {
    if (!url.trim()) return;
    setPreview(null);
    urlPreview.mutate(url.trim(), { onSuccess: (data) => setPreview(data) });
  };

  const confirm = () => {
    if (!preview) return;
    urlConfirm.mutate(preview, {
      onSuccess: (data) => {
        toast.success(t("url.success", { name: data.name }));
        setPreview(null);
        setUrl("");
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
        <div style={s.statusNote("var(--warn)", "var(--warn-bg)")}>
          <Icon.AlertTriangle size={14} />
          {t("url.hint")}
        </div>
        {urlConfirm.isError && (
          <div style={s.error}>
            {t("drawer.importFailed")}
            {urlConfirm.error instanceof ApiError ? `: ${urlConfirm.error.message}` : ""}
          </div>
        )}
        <div style={s.actions}>
          <Button kind="secondary" onClick={() => setPreview(null)}>
            {t("create.cancel")}
          </Button>
          <Button kind="primary" icon="Check" onClick={confirm} disabled={urlConfirm.isPending}>
            {urlConfirm.isPending ? t("file.importing") : t("url.import")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <FormField label={t("url.label")} hint={t("url.hint")}>
        <TextInput
          value={url}
          onChange={setUrl}
          placeholder={t("url.placeholder")}
          aria-invalid={urlPreview.isError}
          aria-describedby={urlPreview.isError ? "url-import-error" : undefined}
        />
      </FormField>
      {urlPreview.isError && (
        <div id="url-import-error" style={s.error}>
          {t("drawer.importFailed")}
          {urlPreview.error instanceof ApiError ? `: ${urlPreview.error.message}` : ""}
        </div>
      )}
      <div style={s.actions}>
        <Button kind="primary" icon="Search" onClick={fetchPreview} disabled={urlPreview.isPending || !url.trim()}>
          {urlPreview.isPending ? t("url.fetching") : t("url.import")}
        </Button>
      </div>
    </div>
  );
}
