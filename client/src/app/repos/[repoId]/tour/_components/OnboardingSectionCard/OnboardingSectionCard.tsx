import React from "react";
import type { OnboardingSection } from "@devdigest/shared";
import { Markdown } from "@devdigest/ui";
import { MermaidDiagram } from "@/components/mermaid-diagram";
import { githubBlobUrl } from "@/lib/github-urls";
import { s } from "../../styles";

interface OnboardingSectionCardProps {
  section: OnboardingSection;
  title: string;
  /** Anchor id this section's in-page nav button scrolls to. */
  anchorId: string;
  /** Needed to build a real "Open on GitHub" link for each `links[]` entry
     — null when the tour has no `indexed_sha` yet (defensive; a persisted
     tour always has one). */
  repoFullName: string | null;
  indexedSha: string | null;
  openOnGitHubLabel: string;
}

/**
 * One Onboarding Tour section — composes the existing, previously-unused
 * `Markdown`/`MermaidDiagram` primitives (docs/onboarding-generator-plan.md
 * Work Item 13). The diagram is rendered ONLY when present — the server
 * already nulls it out for every non-`architecture` section (AC-16), and
 * `MermaidDiagram` itself already degrades a malformed diagram string to
 * "render nothing" (AC-17) rather than throwing, so no guard is duplicated
 * here.
 */
export function OnboardingSectionCard({
  section,
  title,
  anchorId,
  repoFullName,
  indexedSha,
  openOnGitHubLabel,
}: OnboardingSectionCardProps) {
  return (
    <section id={anchorId} style={s.card} aria-labelledby={`${anchorId}-heading`}>
      <h2 id={`${anchorId}-heading`} style={s.cardTitle}>
        {title}
      </h2>
      <Markdown>{section.body}</Markdown>
      {section.diagram && <MermaidDiagram chart={section.diagram} />}
      {section.links.length > 0 && (
        <div style={s.linksRow}>
          {section.links.map((link, i) => (
            <a
              key={`${link.path}-${i}`}
              href={repoFullName && indexedSha ? githubBlobUrl(repoFullName, indexedSha, link.path) : undefined}
              target="_blank"
              rel="noopener noreferrer"
              style={s.linkChip}
              title={`${openOnGitHubLabel}: ${link.path}`}
            >
              {link.label}
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

export default OnboardingSectionCard;
