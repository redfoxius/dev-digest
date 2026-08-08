import React from "react";
import { Button } from "../primitives";
import { Modal } from "./Modal";

/** In-app replacement for `window.confirm()` — same overlay/border/animation
   as every other Modal in the app, so a destructive action doesn't drop the
   user into a browser-chrome popup mid-flow. */
export function ConfirmDialog({
  title,
  body,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  danger = true,
  pending,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      width={420}
      title={title}
      onClose={onCancel}
      footer={
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Button kind="secondary" onClick={onCancel} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button kind={danger ? "danger" : "primary"} onClick={onConfirm} disabled={pending}>
            {pending ? "…" : confirmLabel}
          </Button>
        </div>
      }
    >
      <div style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.5 }}>{body}</div>
    </Modal>
  );
}
