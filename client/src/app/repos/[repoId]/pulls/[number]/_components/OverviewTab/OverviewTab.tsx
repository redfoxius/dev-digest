"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { IntentCard } from "./_components/IntentCard";
import { s } from "./styles";

interface OverviewTabProps {
  prBody: string | null | undefined;
  prId: string | null | undefined;
}

// Kept free of any fetching logic (only threads `prId` through) — the
// data-fetching concern (usePrIntent/useDeriveIntent) lives inside
// IntentCard itself, preserving OverviewTab's presentational/pure shape.
export function OverviewTab({ prBody, prId }: OverviewTabProps) {
  return (
    <>
      <IntentCard prId={prId} />

      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
