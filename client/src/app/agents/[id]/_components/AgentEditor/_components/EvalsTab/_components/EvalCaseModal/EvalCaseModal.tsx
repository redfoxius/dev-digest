/* EvalCaseModal — create/edit modal for one eval case (spec §6.9, AC-32).
   Diff/Files/PR-meta raw text/JSON tabs, an editable `expected_output` JSON
   editor validated client-side against `EvalCaseExpectedOutput` before Save
   is enabled, and a one-line "Last run passed/failed · expected N, got M ·
   duration · cost" status when a prior run exists — omitted otherwise. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, Icon, Modal, Tabs, Textarea, TextInput } from "@devdigest/ui";
import type { EvalCase, EvalRunRecord } from "@devdigest/shared";
import { useCreateEvalCase, useUpdateEvalCase, type EvalCaseFormInput } from "@/lib/hooks/evals";
import { useToast } from "@/lib/toast";
import { lastRunStatusParts, parseExpectedOutput, parseJsonField } from "./helpers";
import { s } from "./styles";

type SubTab = "diff" | "files" | "meta";

function stringifyOrEmpty(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

export function EvalCaseModal({
  agentId,
  evalCase,
  lastRun,
  onClose,
}: {
  agentId: string;
  /** `null` = create a new case; otherwise editing this existing one. */
  evalCase: EvalCase | null;
  lastRun?: EvalRunRecord;
  onClose: () => void;
}) {
  const t = useTranslations("agents");
  const toast = useToast();
  const create = useCreateEvalCase(agentId);
  const update = useUpdateEvalCase(agentId);
  const saving = create.isPending || update.isPending;

  const [name, setName] = React.useState(evalCase?.name ?? "");
  const [notes, setNotes] = React.useState(evalCase?.notes ?? "");
  const [diffText, setDiffText] = React.useState(evalCase?.input_diff ?? "");
  const [filesText, setFilesText] = React.useState(stringifyOrEmpty(evalCase?.input_files));
  const [metaText, setMetaText] = React.useState(stringifyOrEmpty(evalCase?.input_meta));
  const [expectedText, setExpectedText] = React.useState(
    stringifyOrEmpty(evalCase?.expected_output ?? { expectations: [] }),
  );
  const [subTab, setSubTab] = React.useState<SubTab>("diff");

  const { value: expectedValue, error: expectedError } = parseExpectedOutput(expectedText);
  const canSave = name.trim().length > 0 && expectedError === null && !saving;

  const subTabs = [
    { key: "diff", label: t("evals.modal.tabs.diff") },
    { key: "files", label: t("evals.modal.tabs.files") },
    { key: "meta", label: t("evals.modal.tabs.meta") },
  ];

  function handleSave() {
    if (!canSave) return;
    const payload: EvalCaseFormInput = {
      name: name.trim(),
      input_diff: diffText,
      input_files: parseJsonField(filesText),
      input_meta: parseJsonField(metaText),
      expected_output: expectedValue,
      notes: notes.trim() || null,
    };
    const onSuccess = () => {
      toast.success(t(evalCase ? "evals.modal.updateSuccess" : "evals.modal.createSuccess", { name: payload.name }));
      onClose();
    };
    if (evalCase) {
      update.mutate({ caseId: evalCase.id, patch: payload }, { onSuccess });
    } else {
      create.mutate(payload, { onSuccess });
    }
  }

  const status = lastRun ? lastRunStatusParts(lastRun) : null;

  return (
    <Modal
      width={720}
      title={evalCase ? t("evals.modal.editTitle") : t("evals.modal.createTitle")}
      subtitle={name || undefined}
      onClose={onClose}
      footer={
        <div style={s.footerActions}>
          <Button kind="secondary" onClick={onClose} disabled={saving}>
            {t("evals.modal.cancel")}
          </Button>
          <Button kind="primary" icon="Check" disabled={!canSave} onClick={handleSave}>
            {saving ? t("evals.modal.saving") : t("evals.modal.save")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        {status && (
          <div role="status" style={s.statusLine}>
            {status.passed ? (
              <Icon.CheckCircle size={14} style={{ color: "var(--ok)" }} aria-hidden="true" />
            ) : (
              <Icon.XCircle size={14} style={{ color: "var(--crit)" }} aria-hidden="true" />
            )}
            {t("evals.modal.lastRunStatus", {
              result: status.passed ? t("evals.modal.passed") : t("evals.modal.failed"),
              expected: status.expected ?? "—",
              got: status.got ?? "—",
              duration: status.duration,
              cost: status.cost,
            })}
          </div>
        )}

        <FormField label={t("evals.modal.name")} required>
          <TextInput value={name} onChange={setName} placeholder={t("evals.modal.namePlaceholder")} />
        </FormField>

        <div style={s.subTabPanel}>
          <Tabs tabs={subTabs} value={subTab} onChange={(k) => setSubTab(k as SubTab)} pad="0" />
          <div style={{ marginTop: 12 }}>
            {subTab === "diff" && (
              <Textarea value={diffText} onChange={setDiffText} rows={8} mono placeholder={t("evals.modal.diffPlaceholder")} />
            )}
            {subTab === "files" && (
              <Textarea value={filesText} onChange={setFilesText} rows={8} mono placeholder={t("evals.modal.filesPlaceholder")} />
            )}
            {subTab === "meta" && (
              <Textarea value={metaText} onChange={setMetaText} rows={8} mono placeholder={t("evals.modal.metaPlaceholder")} />
            )}
          </div>
        </div>

        <FormField label={t("evals.modal.expectedOutput")} required hint={t("evals.modal.expectedOutputHint")}>
          <Textarea value={expectedText} onChange={setExpectedText} rows={8} mono />
          {expectedError && (
            <div role="alert" style={s.errorText}>
              {expectedError}
            </div>
          )}
        </FormField>

        <FormField label={t("evals.modal.notes")}>
          <Textarea value={notes} onChange={setNotes} rows={2} />
        </FormField>
      </div>
    </Modal>
  );
}
