import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, within, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { SmartDiff } from "@devdigest/shared";
import type { PrFile } from "@/lib/types";
import prReviewMessages from "../../../../messages/en/prReview.json";
import shellMessages from "../../../../messages/en/shell.json";
import { SmartDiffViewer } from "./SmartDiffViewer";

afterEach(cleanup);

// jsdom has no real layout engine — `scrollIntoView` isn't implemented at
// all, so every FileCard-scroll assertion needs it stubbed.
beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

// ---- Fixtures ----
// A "core" file with two overlapping-severity findings (line 4 = WARNING,
// line 5 = CRITICAL — the worse of the two, exactly as the server-side
// overlap resolution in Phase 2 would have already produced).
const PATCH_HANDLER = "@@ -3,1 +4,2 @@\n+line four\n+line five\n";
// A "core" file whose diff exceeds AUTO_EXPAND_MAX_LINES (200) but still has
// a finding — must default open anyway. Its one finding spans 3 lines.
const PATCH_BIGCORE = "@@ -8,1 +10,3 @@\n+added line 10\n+added line 11\n+added line 12\n";
// A "wiring" file with no findings, small diff — defaults open by size alone.
const PATCH_WIRING = "@@ -1,1 +1,1 @@\n+export default {}\n";
// A "boilerplate" lockfile WITH a finding — must still default collapsed.
const PATCH_LOCKFILE = "@@ -1,1 +1,1 @@\n+{}\n";

const FILES: PrFile[] = [
  { path: "src/api/handler.ts", additions: 3, deletions: 1, patch: PATCH_HANDLER },
  { path: "src/api/bigcore.ts", additions: 150, deletions: 100, patch: PATCH_BIGCORE },
  { path: "vite.config.ts", additions: 5, deletions: 2, patch: PATCH_WIRING },
  { path: "package-lock.json", additions: 1, deletions: 1, patch: PATCH_LOCKFILE },
];

const SMART_DIFF: SmartDiff = {
  groups: [
    {
      role: "core",
      files: [
        {
          path: "src/api/handler.ts",
          pseudocode_summary: null,
          additions: 3,
          deletions: 1,
          findings_count: 2,
          finding_lines: [
            { line: 4, severity: "WARNING" },
            { line: 5, severity: "CRITICAL" },
          ],
        },
        {
          path: "src/api/bigcore.ts",
          pseudocode_summary: null,
          additions: 150,
          deletions: 100,
          findings_count: 1,
          finding_lines: [
            { line: 10, severity: "WARNING" },
            { line: 11, severity: "WARNING" },
            { line: 12, severity: "WARNING" },
          ],
        },
      ],
    },
    {
      role: "wiring",
      files: [
        {
          path: "vite.config.ts",
          pseudocode_summary: null,
          additions: 5,
          deletions: 2,
          findings_count: 0,
          finding_lines: [],
        },
      ],
    },
    {
      role: "boilerplate",
      files: [
        {
          path: "package-lock.json",
          pseudocode_summary: null,
          additions: 1,
          deletions: 1,
          findings_count: 1,
          finding_lines: [{ line: 1, severity: "SUGGESTION" }],
        },
      ],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] },
};

function renderViewer() {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ prReview: prReviewMessages, shell: shellMessages }}
    >
      <SmartDiffViewer smartDiff={SMART_DIFF} files={FILES} />
    </NextIntlClientProvider>,
  );
}

/** Scopes queries to one file's row (`data-file`), so two files sharing the
 *  same "N findings" wording (e.g. both showing "1 findings") can't collide. */
function fileRow(container: HTMLElement, path: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-file="${path}"]`);
  if (!el) throw new Error(`no file row for ${path}`);
  return el;
}

describe("SmartDiffViewer — section grouping", () => {
  it("starts boilerplate collapsed while core/wiring start open, and each header shows its role dot", () => {
    const { container } = renderViewer();

    expect(screen.getByRole("button", { name: /^Core\b/i })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /^Wiring\b/i })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /^Boilerplate\b/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    // Boilerplate's own section body isn't even mounted yet.
    expect(container.querySelector('[data-file="package-lock.json"]')).not.toBeInTheDocument();

    // Each group header renders its ROLE_COLORS dot.
    expect(container.querySelector('[data-role-dot="core"]')).toHaveStyle({
      backgroundColor: "var(--accent)",
    });
    expect(container.querySelector('[data-role-dot="wiring"]')).toHaveStyle({
      backgroundColor: "var(--warn)",
    });
    expect(container.querySelector('[data-role-dot="boilerplate"]')).toHaveStyle({
      backgroundColor: "var(--text-muted)",
    });
  });

  it("a boilerplate file with findings still starts collapsed even once its section opens", () => {
    const { container } = renderViewer();
    fireEvent.click(screen.getByRole("button", { name: /^Boilerplate\b/i }));

    // The section is open now (its FileCard renders, findings Chip and all)...
    const row = fileRow(container, "package-lock.json");
    expect(within(row).getByText("package-lock.json")).toBeInTheDocument();
    expect(within(row).getByText("1 findings")).toBeInTheDocument();
    // ...but the file's own FileCard is still collapsed — no diff content shown.
    expect(within(row).queryByText("{}")).not.toBeInTheDocument();
  });
});

describe("SmartDiffViewer — per-file default-open", () => {
  it("a file with findings_count > 0 defaults open even past the size threshold", () => {
    renderViewer();
    // src/api/bigcore.ts: additions+deletions = 250 > AUTO_EXPAND_MAX_LINES (200),
    // but findings_count > 0 forces it open anyway.
    expect(screen.getByText("added line 10")).toBeInTheDocument();
  });
});

describe("SmartDiffViewer — findings badge", () => {
  it('shows findings_count ("1 findings"), not finding_lines.length ("3 findings")', () => {
    const { container } = renderViewer();
    const row = fileRow(container, "src/api/bigcore.ts");
    expect(within(row).getByText("1 findings")).toBeInTheDocument();
    expect(within(row).queryByText("3 findings")).not.toBeInTheDocument();
  });
});

describe("SmartDiffViewer — per-line severity badges", () => {
  it("renders a severity badge on every line of a multi-line finding, not just the first", () => {
    const { container } = renderViewer();
    for (const line of [10, 11, 12]) {
      const row = container.querySelector(`[data-line="${line}"]`);
      expect(row).toBeTruthy();
      // WARNING's icon is lucide's AlertTriangle (class lucide-triangle-alert).
      expect(row!.querySelector("svg.lucide-triangle-alert")).toBeTruthy();
    }
  });

  it("renders the worse severity where two findings overlap on one line", () => {
    const { container } = renderViewer();
    const line4 = container.querySelector('[data-line="4"]');
    const line5 = container.querySelector('[data-line="5"]');
    expect(line4!.querySelector("svg.lucide-triangle-alert")).toBeTruthy(); // WARNING
    // CRITICAL's icon is lucide's AlertOctagon (class lucide-octagon-alert).
    expect(line5!.querySelector("svg.lucide-octagon-alert")).toBeTruthy();
    expect(line5!.querySelector("svg.lucide-triangle-alert")).toBeFalsy();
  });
});

describe("SmartDiffViewer — click-to-scroll", () => {
  it("clicking the findings Chip scrolls to the right data-line node and forces that FileCard open", () => {
    const { container } = renderViewer();
    fireEvent.click(screen.getByRole("button", { name: /^Boilerplate\b/i }));

    const row = fileRow(container, "package-lock.json");
    expect(within(row).queryByText("{}")).not.toBeInTheDocument();
    fireEvent.click(within(row).getByText("1 findings"));

    expect(within(row).getByText("{}")).toBeInTheDocument();
    expect(row.querySelector('[data-line="1"]')).toBeTruthy();
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("clicking the same findings Chip twice re-fires the scroll", () => {
    const { container } = renderViewer();
    fireEvent.click(screen.getByRole("button", { name: /^Boilerplate\b/i }));

    const row = fileRow(container, "package-lock.json");
    fireEvent.click(within(row).getByText("1 findings"));
    fireEvent.click(within(row).getByText("1 findings"));

    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(2);
  });
});
