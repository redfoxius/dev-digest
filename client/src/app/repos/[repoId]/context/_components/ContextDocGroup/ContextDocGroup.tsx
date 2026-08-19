/* ContextDocGroup — one root section ("Specs"/"Docs"/"Insights") of the
   Project Context page's document list (AC-13's "grouped by root"). */
"use client";

import type { ContextDocument, ContextDocRoot } from "@devdigest/shared";
import { ROOT_LABEL } from "../../constants";
import { ContextDocRow } from "../ContextDocRow";
import { s } from "./styles";

export function ContextDocGroup({
  root,
  documents,
  selectedPath,
  onSelect,
}: {
  root: ContextDocRoot;
  documents: ContextDocument[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  if (documents.length === 0) return null;
  return (
    <div style={s.group}>
      <div style={s.heading}>
        {ROOT_LABEL[root]} ({documents.length})
      </div>
      <div style={s.rows}>
        {documents.map((doc) => (
          <ContextDocRow
            key={doc.id}
            doc={doc}
            selected={doc.path === selectedPath}
            onSelect={() => onSelect(doc.path)}
          />
        ))}
      </div>
    </div>
  );
}
