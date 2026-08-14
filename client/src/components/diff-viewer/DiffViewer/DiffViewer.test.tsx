import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, within, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile } from "@/lib/types";
import prReviewMessages from "../../../../messages/en/prReview.json";
import shellMessages from "../../../../messages/en/shell.json";
import type { ScrollTarget } from "../helpers";
import { DiffViewer } from "./DiffViewer";

afterEach(cleanup);

// jsdom has no real layout engine — `scrollIntoView` isn't implemented at
// all, so every FileCard-scroll assertion needs it stubbed.
beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

const FILES: PrFile[] = [
  { path: "src/api/handler.ts", additions: 3, deletions: 1, patch: "@@ -3,1 +4,2 @@\n+line four\n+line five\n" },
  { path: "src/other.ts", additions: 1, deletions: 0, patch: "@@ -1,1 +1,1 @@\n+export {}\n" },
];

function renderViewer(scrollTarget?: ScrollTarget | null) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: prReviewMessages, shell: shellMessages }}>
      <DiffViewer files={FILES} scrollTarget={scrollTarget} />
    </NextIntlClientProvider>,
  );
}

describe("DiffViewer — external scrollTarget (Phase 4)", () => {
  it("a scrollTarget matching a rendered file force-opens and scrolls it", () => {
    const { container } = renderViewer({ path: "src/api/handler.ts", line: 4, nonce: 1 });

    const row = container.querySelector<HTMLElement>('[data-file="src/api/handler.ts"]')!;
    expect(within(row).getByText("line four")).toBeInTheDocument();
    expect(row.querySelector('[data-line="4"]')).toBeTruthy();
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("a scrollTarget matching no rendered file is a no-op — no crash, nothing scrolls", () => {
    renderViewer({ path: "src/does-not-exist.ts", line: 1, nonce: 1 });

    // Both real files still render fine (no crash) — neither's scroll fired.
    expect(screen.getByText("src/api/handler.ts")).toBeInTheDocument();
    expect(screen.getByText("src/other.ts")).toBeInTheDocument();
    expect(window.HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("an omitted scrollTarget renders normally (additive/no-op)", () => {
    renderViewer();
    expect(screen.getByText("src/api/handler.ts")).toBeInTheDocument();
    expect(screen.getByText("src/other.ts")).toBeInTheDocument();
  });
});
