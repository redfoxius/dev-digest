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
// A "core" file with NO findings and a diff past AUTO_EXPAND_MAX_LINES — the
// only fixture that defaults COLLAPSED while still carrying a
// pseudocode_summary, needed to prove the Summary Chip renders collapsed.
const PATCH_BIGLOGIC = "@@ -20,1 +20,1 @@\n+recompute invoice total\n";

const FILES: PrFile[] = [
  { path: "src/api/handler.ts", additions: 3, deletions: 1, patch: PATCH_HANDLER },
  { path: "src/api/bigcore.ts", additions: 150, deletions: 100, patch: PATCH_BIGCORE },
  { path: "vite.config.ts", additions: 5, deletions: 2, patch: PATCH_WIRING },
  { path: "package-lock.json", additions: 1, deletions: 1, patch: PATCH_LOCKFILE },
  { path: "src/billing/biglogic.ts", additions: 150, deletions: 100, patch: PATCH_BIGLOGIC },
  // Present in `files` but deliberately absent from every SMART_DIFF group
  // below — used only by the "known asymmetry" external-scrollTarget test.
  { path: "src/orphan.ts", additions: 1, deletions: 0, patch: "@@ -1,1 +1,1 @@\n+export {}\n" },
];

const SMART_DIFF: SmartDiff = {
  groups: [
    {
      role: "core",
      files: [
        {
          path: "src/api/handler.ts",
          pseudocode_summary: "Handles incoming API requests and dispatches them to services.",
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
        {
          path: "src/billing/biglogic.ts",
          pseudocode_summary: "Recomputes the invoice total whenever a line item changes.",
          additions: 150,
          deletions: 100,
          findings_count: 0,
          finding_lines: [],
        },
      ],
    },
    {
      role: "wiring",
      files: [
        {
          path: "vite.config.ts",
          pseudocode_summary: "Configures the Vite build and dev server.",
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

function renderViewer(
  smartDiff: SmartDiff = SMART_DIFF,
  scrollTarget?: { path: string; line: number; nonce: number } | null,
) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ prReview: prReviewMessages, shell: shellMessages }}
    >
      <SmartDiffViewer smartDiff={smartDiff} files={FILES} scrollTarget={scrollTarget} />
    </NextIntlClientProvider>,
  );
}

// A `too_big` variant, reusing the same grouped/files fixtures above, with
// two proposed splits — one covering `src/api/handler.ts` +
// `src/api/bigcore.ts`, the other just `src/billing/biglogic.ts`.
const SMART_DIFF_WITH_SPLITS: SmartDiff = {
  ...SMART_DIFF,
  split_suggestion: {
    too_big: true,
    total_lines: 404,
    proposed_splits: [
      { name: "src/api", files: ["src/api/handler.ts", "src/api/bigcore.ts"] },
      { name: "Split 2", files: ["src/billing/biglogic.ts"] },
    ],
  },
};

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

describe("SmartDiffViewer — pseudocode_summary (Phase 5)", () => {
  it("shows the Summary Chip on a file's header even while collapsed, and the \"What this does\" text once opened", () => {
    const { container } = renderViewer();
    // src/billing/biglogic.ts: core, zero findings, diff past
    // AUTO_EXPAND_MAX_LINES — the one fixture that defaults COLLAPSED while
    // still carrying a non-null pseudocode_summary.
    const row = fileRow(container, "src/billing/biglogic.ts");

    // Collapsed by default — the Summary Chip is still visible on the header
    // row, but the "What this does" text (rendered only when open) isn't.
    expect(within(row).getByText("Summary")).toBeInTheDocument();
    expect(within(row).queryByText(/Recomputes the invoice total/)).not.toBeInTheDocument();

    // Open the card — the text block now appears right below the header.
    fireEvent.click(within(row).getByText("src/billing/biglogic.ts"));
    expect(within(row).getByText(/What this does:/)).toBeInTheDocument();
    expect(within(row).getByText(/Recomputes the invoice total/)).toBeInTheDocument();
  });

  it("a file with no pseudocode_summary shows neither the Summary Chip nor the text block", () => {
    const { container } = renderViewer();
    fireEvent.click(screen.getByRole("button", { name: /^Boilerplate\b/i }));
    const row = fileRow(container, "package-lock.json");

    expect(within(row).queryByText("Summary")).not.toBeInTheDocument();
    expect(within(row).queryByText(/What this does:/)).not.toBeInTheDocument();
  });

  it("a file with BOTH findings and a summary shows both Chips side by side in the header", () => {
    const { container } = renderViewer();
    const row = fileRow(container, "src/api/handler.ts");

    expect(within(row).getByText("2 findings")).toBeInTheDocument();
    expect(within(row).getByText("Summary")).toBeInTheDocument();
    expect(within(row).getByText(/Handles incoming API requests/)).toBeInTheDocument();
  });
});

describe("SmartDiffViewer — split_suggestion banner (Phase 6)", () => {
  it("the banner is absent when too_big is false", () => {
    renderViewer(SMART_DIFF);
    expect(screen.queryByText(/This PR is large/)).not.toBeInTheDocument();
  });

  it("the banner appears with one Chip per proposed split when too_big is true", () => {
    renderViewer(SMART_DIFF_WITH_SPLITS);
    expect(screen.getByText(/This PR is large/)).toBeInTheDocument();
    expect(screen.getByText("src/api · 2 files")).toBeInTheDocument();
    expect(screen.getByText("Split 2 · 1 files")).toBeInTheDocument();
  });

  it("clicking a split's Chip dims every FileCard not in that split, and leaves the ones in it un-dimmed", () => {
    const { container } = renderViewer(SMART_DIFF_WITH_SPLITS);
    fireEvent.click(screen.getByText("src/api · 2 files"));

    // In the split: NOT dimmed.
    expect(fileRow(container, "src/api/handler.ts")).not.toHaveAttribute("data-dimmed");
    expect(fileRow(container, "src/api/bigcore.ts")).not.toHaveAttribute("data-dimmed");
    // NOT in the split (a different core file, plus the whole wiring/boilerplate
    // groups): dimmed.
    expect(fileRow(container, "src/billing/biglogic.ts")).toHaveAttribute("data-dimmed", "true");
  });

  it("clicking a split's Chip scrolls its first file's FileCard into view", () => {
    const { container } = renderViewer(SMART_DIFF_WITH_SPLITS);
    const scrollIntoView = window.HTMLElement.prototype.scrollIntoView as ReturnType<typeof vi.fn>;

    fireEvent.click(screen.getByText("src/api · 2 files"));

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.instances[0]).toBe(fileRow(container, "src/api/handler.ts"));
  });

  it("clicking a split's Chip opens the core section if it was collapsed", () => {
    renderViewer(SMART_DIFF_WITH_SPLITS);
    const coreButton = screen.getByRole("button", { name: /^Core\b/i });
    fireEvent.click(coreButton); // collapse it
    expect(coreButton).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(screen.getByText("src/api · 2 files"));

    expect(coreButton).toHaveAttribute("aria-expanded", "true");
  });

  it("clicking the same split's Chip again clears the highlight (no FileCard stays dimmed)", () => {
    const { container } = renderViewer(SMART_DIFF_WITH_SPLITS);
    const chip = screen.getByText("src/api · 2 files");
    fireEvent.click(chip);
    expect(fileRow(container, "src/billing/biglogic.ts")).toHaveAttribute("data-dimmed", "true");

    fireEvent.click(chip);
    expect(fileRow(container, "src/billing/biglogic.ts")).not.toHaveAttribute("data-dimmed");
    expect(fileRow(container, "src/api/handler.ts")).not.toHaveAttribute("data-dimmed");
  });
});

describe("SmartDiffViewer — external scrollTarget (Phase 4)", () => {
  it("an external scrollTarget force-opens a collapsed section and scrolls the right FileCard", () => {
    const { container } = renderViewer(SMART_DIFF, { path: "package-lock.json", line: 1, nonce: 1 });

    // Boilerplate is collapsed by default — the external target must open it.
    expect(screen.getByRole("button", { name: /^Boilerplate\b/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    const row = fileRow(container, "package-lock.json");
    expect(within(row).getByText("{}")).toBeInTheDocument();
    expect(row.querySelector('[data-line="1"]')).toBeTruthy();
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("internal click-to-scroll wins over an external target on the same file", () => {
    const { container } = renderViewer(SMART_DIFF, { path: "src/api/handler.ts", line: 5, nonce: 1 });
    const row = fileRow(container, "src/api/handler.ts");
    const scrollIntoView = window.HTMLElement.prototype.scrollIntoView as ReturnType<typeof vi.fn>;

    // The internal findings-Chip click (line 4, the file's FIRST finding)
    // must win over the external target's line 5 once both are present.
    fireEvent.click(within(row).getByText("2 findings"));

    const line4El = row.querySelector('[data-line="4"]');
    expect(scrollIntoView.mock.instances.at(-1)).toBe(line4El);
  });

  it("regression: internal and external both at raw nonce 1 (the exact collision case) still re-fires the scroll", () => {
    // Both sources' raw nonce counters land on 1 here — before the
    // even/odd-parity fix in SmartDiffViewer.tsx, this exact combination
    // produced the SAME merged nonce for both sources and FileCard's scroll
    // effect (keyed on scrollToLine.nonce) silently failed to re-fire.
    const { container } = renderViewer(SMART_DIFF, { path: "src/api/handler.ts", line: 5, nonce: 1 });
    const row = fileRow(container, "src/api/handler.ts");
    const scrollIntoView = window.HTMLElement.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    const callsBeforeClick = scrollIntoView.mock.calls.length;

    fireEvent.click(within(row).getByText("2 findings"));

    // A genuinely new scroll fired (not silently swallowed by a nonce collision).
    expect(scrollIntoView.mock.calls.length).toBeGreaterThan(callsBeforeClick);
    expect(scrollIntoView.mock.instances.at(-1)).toBe(row.querySelector('[data-line="4"]'));
  });

  it("known asymmetry: an external target for a file present in `files` but absent from every group is a no-op, not a crash", () => {
    renderViewer(SMART_DIFF, { path: "src/orphan.ts", line: 1, nonce: 1 });

    // No section was force-opened (orphan.ts has no role), no crash.
    expect(screen.getByRole("button", { name: /^Boilerplate\b/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(window.HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});
