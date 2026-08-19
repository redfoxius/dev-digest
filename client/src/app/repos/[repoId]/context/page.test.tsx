/* page.test.tsx — no `page.tsx` in this repo currently has its own colocated
   test (conventions/page.tsx's loading/error/empty/populated states, the
   closest precedent, are likewise untested; only its _components/* get
   *.test.tsx files) — but AC-13..AC-16's page-composition states (skeleton,
   not-indexed empty state, degraded status label, populated grouped list,
   preview selection) all live directly in THIS page.tsx (mirroring
   conventions/page.tsx's own inline state-handling shape), not in a
   sub-component, so this is the only place they can be exercised. Mocks
   `@/lib/hooks/context-docs` and `@/lib/repo-context` (data layer) plus
   `@/components/app-shell` (routing/command-palette chrome, irrelevant
   here) — the 3 already-built ContextDocGroup/ContextDocRow/
   DocumentPreviewPane sub-components render for real. */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ContextDocument } from "@devdigest/shared";
import messages from "../../../../../messages/en/context.json";

const { useContextDocsMock, useContextDocPreviewMock, reindexMutate } = vi.hoisted(() => ({
  useContextDocsMock: vi.fn(),
  useContextDocPreviewMock: vi.fn(),
  reindexMutate: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "repo1" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({
    repoId: "repo1",
    setRepoId: vi.fn(),
    repos: [{ id: "repo1", full_name: "acme/widgets" }],
    activeRepo: { id: "repo1", full_name: "acme/widgets" },
    reposLoaded: true,
  }),
  useRepoNotFound: () => false,
}));

vi.mock("@/lib/hooks/context-docs", () => ({
  useContextDocs: useContextDocsMock,
  useReindexContextDocs: () => ({ mutate: reindexMutate, isPending: false }),
  useContextDocPreview: useContextDocPreviewMock,
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import ContextPage from "./page";

afterEach(() => {
  cleanup();
  reindexMutate.mockClear();
  useContextDocPreviewMock.mockReset();
  useContextDocPreviewMock.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
});

function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <ContextPage />
    </NextIntlClientProvider>,
  );
}

function doc(o: Partial<ContextDocument>): ContextDocument {
  return {
    id: o.path ?? "d",
    path: "specs/public-api.md",
    root: "specs",
    size_bytes: 120,
    chunk_count: 4,
    index_status: "indexed",
    used_by_agents: 1,
    used_by_skills: 2,
    last_indexed_at: "2026-08-01T00:00:00Z",
    ...o,
  };
}

describe("ContextPage", () => {
  it("renders skeleton rows while loading", () => {
    useContextDocsMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    const { container } = renderPage();
    expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
  });

  it("shows a reindex CTA when the repo is indexed but no documents were discovered", () => {
    useContextDocsMock.mockReturnValue({
      data: {
        documents: [],
        index_status: "indexed",
        file_count: 0,
        total_chunk_count: 0,
        last_indexed_at: "2026-08-01T00:00:00Z",
        coverage_percent: 0,
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("No documents discovered")).toBeInTheDocument();
    const ctaButtons = screen.getAllByRole("button", { name: "Reindex" });
    fireEvent.click(ctaButtons[ctaButtons.length - 1]!);
    expect(reindexMutate).toHaveBeenCalled();
  });

  it("renders a grouped, populated list with per-row used-by counts and the coverage percentage", () => {
    const documents: ContextDocument[] = [
      doc({ path: "specs/public-api.md", root: "specs", used_by_agents: 2, used_by_skills: 1 }),
      doc({ id: "d2", path: "docs/architecture.md", root: "docs", used_by_agents: 0, used_by_skills: 0 }),
    ];
    useContextDocsMock.mockReturnValue({
      data: {
        documents,
        index_status: "indexed",
        file_count: 2,
        total_chunk_count: 6,
        last_indexed_at: "2026-08-01T00:00:00Z",
        coverage_percent: 25,
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    // Grouped by root, in ROOT_ORDER (specs, docs, insights).
    expect(screen.getByText("Specs (1)")).toBeInTheDocument();
    expect(screen.getByText("Docs (1)")).toBeInTheDocument();
    expect(screen.queryByText(/^Insights/)).not.toBeInTheDocument();

    // Per-row used-by-agent/skill counts (ContextDocRow's own rendering).
    expect(screen.getByText("2 agents · 1 skill")).toBeInTheDocument();
    expect(screen.getByText("0 agents · 0 skills")).toBeInTheDocument();

    // Coverage indicator from `coverage_percent`.
    expect(screen.getByText("Coverage: 25%")).toBeInTheDocument();
  });

  it("selecting a row renders read-only preview content with no edit affordance anywhere in the DOM", () => {
    const documents: ContextDocument[] = [doc({ path: "specs/public-api.md" })];
    useContextDocsMock.mockReturnValue({
      data: {
        documents,
        index_status: "indexed",
        file_count: 1,
        total_chunk_count: 4,
        last_indexed_at: "2026-08-01T00:00:00Z",
        coverage_percent: 100,
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    useContextDocPreviewMock.mockReturnValue({
      data: { path: "specs/public-api.md", content: "# Public API\n\nDo not break it." },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    renderPage();
    fireEvent.click(screen.getByText("specs/public-api.md"));

    expect(screen.getByText(/Do not break it\./)).toBeInTheDocument();
    // AC-14: no edit/save affordance anywhere in the DOM.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
  });

  it('shows an explicit "not yet indexed" empty state (never an error boundary) when index_status is "not_indexed"', () => {
    useContextDocsMock.mockReturnValue({
      data: {
        documents: [],
        index_status: "not_indexed",
        file_count: 0,
        total_chunk_count: null,
        last_indexed_at: null,
        coverage_percent: 0,
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Repo not indexed yet")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
    // The Reindex action is disabled rather than firing a doomed request.
    expect(screen.getByRole("button", { name: "Re-index" })).toBeDisabled();
  });

  it("shows a degraded status label instead of a chunk count when indexing is disabled or misconfigured, without blocking the rest of the page", () => {
    const documents: ContextDocument[] = [
      doc({ path: "specs/public-api.md", chunk_count: null, index_status: "disabled" }),
    ];
    useContextDocsMock.mockReturnValue({
      data: {
        documents,
        index_status: "disabled",
        file_count: 1,
        total_chunk_count: null,
        last_indexed_at: "2026-08-01T00:00:00Z",
        coverage_percent: 0,
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    // Repo-wide status line AND the per-row badge (ContextDocRow's own
    // chunkCountLabel) both show the degraded label instead of a number.
    expect(screen.getAllByText(/Indexing disabled/).length).toBeGreaterThanOrEqual(2);
    // The rest of the page (the document list itself) still renders.
    expect(screen.getByText("specs/public-api.md")).toBeInTheDocument();
  });
});
