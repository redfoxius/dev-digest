import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, within, cleanup, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ContextDocument, Skill, SkillContextDocLink } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/skills.json";

// Mocks are read inside the vi.mock factories below (hoisted above these
// imports), so the spies themselves must be created via vi.hoisted rather
// than a plain module-level const — same pattern as SkillsTab.test.tsx.
const {
  setDocsMutate,
  setEnabledMutate,
  useContextDocsMock,
  useSkillContextDocsMock,
  refetchDocsMock,
  refetchLinksMock,
} = vi.hoisted(() => ({
  setDocsMutate: vi.fn(),
  setEnabledMutate: vi.fn(),
  refetchDocsMock: vi.fn(),
  refetchLinksMock: vi.fn(),
  useContextDocsMock: vi.fn(),
  useSkillContextDocsMock: vi.fn(),
}));

vi.mock("../../../../../../lib/hooks/context-docs", () => ({
  useContextDocs: useContextDocsMock,
  useSkillContextDocs: useSkillContextDocsMock,
  useSetSkillContextDocs: () => ({ mutate: setDocsMutate }),
  useSetSkillContextDocEnabled: () => ({ mutate: setEnabledMutate }),
}));

vi.mock("../../../../../../lib/repo-context", () => ({
  useActiveRepo: () => ({
    repoId: "repo1",
    setRepoId: vi.fn(),
    repos: [],
    activeRepo: null,
    reposLoaded: true,
  }),
}));

import { ContextTab } from "./ContextTab";

afterEach(() => {
  cleanup();
  setDocsMutate.mockClear();
  setEnabledMutate.mockClear();
  refetchDocsMock.mockClear();
  refetchLinksMock.mockClear();
});

const SKILL: Skill = {
  id: "sk1",
  name: "public-api-rubric",
  description: "Checks public API changes",
  type: "custom",
  source: "manual",
  body: "body",
  enabled: true,
  version: 1,
};

// d1/d2 are attached (d1 enabled, d2 disabled); d3 is never attached
// (appended after, alphabetically). "specs/missing-doc.md" is attached but
// no longer resolves in the latest scan (AC-22: document: null).
const DOCUMENTS: ContextDocument[] = [
  {
    id: "d1",
    path: "specs/public-api.md",
    root: "specs",
    size_bytes: 120,
    chunk_count: null,
    index_status: "indexed",
    used_by_agents: 0,
    used_by_skills: 1,
    last_indexed_at: "2026-08-01T00:00:00Z",
  },
  {
    id: "d2",
    path: "docs/architecture.md",
    root: "docs",
    size_bytes: 200,
    chunk_count: null,
    index_status: "indexed",
    used_by_agents: 0,
    used_by_skills: 1,
    last_indexed_at: "2026-08-01T00:00:00Z",
  },
  {
    id: "d3",
    path: "insights/notes.md",
    root: "insights",
    size_bytes: 90,
    chunk_count: null,
    index_status: "indexed",
    used_by_agents: 0,
    used_by_skills: 0,
    last_indexed_at: "2026-08-01T00:00:00Z",
  },
];

const LINKS: SkillContextDocLink[] = [
  { path: "specs/public-api.md", order: 0, enabled: true, document: DOCUMENTS[0]! },
  { path: "docs/architecture.md", order: 1, enabled: false, document: DOCUMENTS[1]! },
  { path: "specs/missing-doc.md", order: 2, enabled: false, document: null },
];

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ContextTab skill={SKILL} />
    </NextIntlClientProvider>,
  );
}

describe("ContextTab", () => {
  useContextDocsMock.mockImplementation(() => ({
    data: { documents: DOCUMENTS, index_status: "indexed", file_count: 3, total_chunk_count: null, last_indexed_at: "2026-08-01T00:00:00Z", coverage_percent: 33 },
    isLoading: false,
    isError: false,
    refetch: refetchDocsMock,
  }));
  useSkillContextDocsMock.mockImplementation(() => ({
    data: LINKS,
    isLoading: false,
    isError: false,
    refetch: refetchLinksMock,
  }));

  it("merges the catalog with the skill's links: attached first (in order), then unattached — with a missing attached row flagged", () => {
    renderTab();
    const names = within(screen.getByTestId("context-doc-list")).getAllByText(/\.md$/).map((el) => el.textContent);
    expect(names).toEqual([
      "specs/public-api.md",
      "docs/architecture.md",
      "specs/missing-doc.md",
      "insights/notes.md",
    ]);
    // Exactly the one attached-but-unresolved row is flagged "missing".
    expect(screen.getAllByText("missing")).toHaveLength(1);
  });

  it("shows the attached/total count", () => {
    renderTab();
    // Only specs/public-api.md's link is enabled -> 1 of 4.
    expect(screen.getByText("1 of 4 attached")).toBeInTheDocument();
  });

  it("checking an unattached document attaches it (enabled: true); unchecking an attached+enabled one detaches it (enabled: false)", () => {
    renderTab();
    const checkboxes = screen.getAllByRole("checkbox");
    // Row order: public-api.md, architecture.md, missing-doc.md, notes.md.
    fireEvent.click(checkboxes[3]!); // notes.md, never attached
    expect(setEnabledMutate).toHaveBeenCalledWith({ path: "insights/notes.md", enabled: true });

    fireEvent.click(checkboxes[0]!); // public-api.md, attached + enabled
    expect(setEnabledMutate).toHaveBeenCalledWith({ path: "specs/public-api.md", enabled: false });
  });

  it("dragging a row onto another calls useSetSkillContextDocs with the full reordered path list", () => {
    renderTab();
    const handles = screen.getAllByRole("button", { name: /Reorder/ });
    // handles[3] = notes.md (unattached, currently last); drag onto public-api.md's row (handles[0]).
    fireEvent.dragStart(handles[3]!, { dataTransfer: { setData: vi.fn() } });
    fireEvent.dragOver(handles[0]!);
    fireEvent.drop(handles[0]!);
    expect(setDocsMutate).toHaveBeenCalledWith(
      ["insights/notes.md", "specs/public-api.md", "docs/architecture.md", "specs/missing-doc.md"],
      expect.objectContaining({ onSettled: expect.any(Function) }),
    );
  });

  it('renders a "SERIALIZES AS" preview beginning with the real `## Project context` heading (not illustrative mockup text) for the currently-enabled attached document', () => {
    renderTab();
    // specs/public-api.md is the only currently-enabled attached document.
    const preview = screen.getByText(/## Project context/);
    expect(preview.textContent).toMatch(/^## Project context/);
    expect(preview.textContent).toContain("### specs/public-api.md");
    // The disabled/missing attachments must NOT appear in the serialized preview.
    expect(preview.textContent).not.toContain("docs/architecture.md");
    expect(preview.textContent).not.toContain("missing-doc.md");
  });

  it('the "SERIALIZES AS" preview wraps each enabled document in the real `<untrusted source="spec-{i}">` delimiter, index-labeled in this skill\'s own configured order', () => {
    useSkillContextDocsMock.mockReturnValueOnce({
      data: [
        { path: "specs/public-api.md", order: 0, enabled: true, document: DOCUMENTS[0]! },
        { path: "docs/architecture.md", order: 1, enabled: true, document: DOCUMENTS[1]! },
        { path: "specs/missing-doc.md", order: 2, enabled: false, document: null },
      ],
      isLoading: false,
      isError: false,
      refetch: refetchLinksMock,
    });
    renderTab();

    const text = screen.getByText(/## Project context/).textContent ?? "";
    expect(text).toMatch(/^## Project context/);

    // Two enabled documents -> two <untrusted>...</untrusted> blocks, in
    // this skill's own configured order (spec-0 = public-api.md first,
    // spec-1 = architecture.md second), each opened and matched by a close.
    const spec0Index = text.indexOf('<untrusted source="spec-0">');
    const spec1Index = text.indexOf('<untrusted source="spec-1">');
    expect(spec0Index).toBeGreaterThan(-1);
    expect(spec1Index).toBeGreaterThan(spec0Index);
    expect(text.indexOf("### specs/public-api.md")).toBeGreaterThan(spec0Index);
    expect(text.indexOf("### docs/architecture.md")).toBeGreaterThan(spec1Index);
    expect((text.match(/<untrusted source="spec-\d+">/g) ?? []).length).toBe(2);
    expect((text.match(/<\/untrusted>/g) ?? []).length).toBe(2);

    // The disabled/missing attachment must NOT appear in the serialized preview.
    expect(text).not.toContain("missing-doc.md");
  });

  it("the drag handle is keyboard-focusable and ArrowDown/ArrowUp move the focused row, persisting via the same reorder path a mouse drag-drop uses", () => {
    renderTab();
    const handles = screen.getAllByRole("button", { name: /Reorder/ });
    // handles[0] = public-api.md (first row). Focus it directly, as a
    // screen-reader/keyboard user tabbing to the handle would land here.
    handles[0]!.focus();
    expect(document.activeElement).toBe(handles[0]!);

    // ArrowDown swaps it past architecture.md (index 1).
    fireEvent.keyDown(handles[0]!, { key: "ArrowDown" });
    expect(setDocsMutate).toHaveBeenCalledWith(
      ["docs/architecture.md", "specs/public-api.md", "specs/missing-doc.md", "insights/notes.md"],
      expect.objectContaining({ onSettled: expect.any(Function) }),
    );

    // ArrowUp on the now-last handle (notes.md) moves it back up one.
    setDocsMutate.mockClear();
    const handlesAfter = screen.getAllByRole("button", { name: /Reorder/ });
    fireEvent.keyDown(handlesAfter[3]!, { key: "ArrowUp" });
    expect(setDocsMutate).toHaveBeenCalledWith(
      ["docs/architecture.md", "specs/public-api.md", "insights/notes.md", "specs/missing-doc.md"],
      expect.objectContaining({ onSettled: expect.any(Function) }),
    );
  });

  it("ArrowUp on the first row and ArrowDown on the last row are no-ops (nothing to swap with)", () => {
    renderTab();
    const handles = screen.getAllByRole("button", { name: /Reorder/ });
    fireEvent.keyDown(handles[0]!, { key: "ArrowUp" });
    fireEvent.keyDown(handles[3]!, { key: "ArrowDown" });
    expect(setDocsMutate).not.toHaveBeenCalled();
  });

  it("aria-live region announces the filtered document count on filter", () => {
    renderTab();
    fireEvent.change(screen.getByPlaceholderText("Filter documents…"), {
      target: { value: "public-api" },
    });
    expect(screen.getByRole("status")).toHaveTextContent("1 document found");
  });

  it("a second overlapping drag's optimistic order survives the FIRST (now-stale) mutation settling first", () => {
    const idToPath: Record<number, string> = { 0: "specs/public-api.md", 1: "docs/architecture.md", 2: "specs/missing-doc.md", 3: "insights/notes.md" };
    renderTab();

    // Drag 1: notes.md (last handle) onto public-api.md's row.
    let handles = screen.getAllByRole("button", { name: /Reorder/ });
    fireEvent.dragStart(handles[3]!, { dataTransfer: { setData: vi.fn() } });
    fireEvent.dragOver(handles[0]!);
    fireEvent.drop(handles[0]!);

    // Drag 2 starts before drag 1's mutation settles.
    handles = screen.getAllByRole("button", { name: /Reorder/ });
    fireEvent.dragStart(handles[0]!, { dataTransfer: { setData: vi.fn() } });
    fireEvent.dragOver(handles[3]!);
    fireEvent.drop(handles[3]!);

    expect(setDocsMutate).toHaveBeenCalledTimes(2);
    const [drag1Paths, opts1] = setDocsMutate.mock.calls[0]!;
    const [drag2Paths, opts2] = setDocsMutate.mock.calls[1]!;
    expect(drag1Paths).not.toEqual(drag2Paths);
    void idToPath;

    // Drag 1's mutation settles AFTER drag 2 already started (the race) —
    // must NOT clear drag 2's still-pending optimistic order.
    act(() => opts1.onSettled());
    expect(within(screen.getByTestId("context-doc-list")).getAllByText(/\.md$/).map((el) => el.textContent)).toEqual(drag2Paths);

    // Drag 2 (the LATEST) settles — this is the one allowed to clear it.
    act(() => opts2.onSettled());
    expect(within(screen.getByTestId("context-doc-list")).getAllByText(/\.md$/).map((el) => el.textContent)).toEqual([
      "specs/public-api.md",
      "docs/architecture.md",
      "specs/missing-doc.md",
      "insights/notes.md",
    ]);
  });

  it("shows an error state with retry when either query fails, instead of a misleading empty-filter message", () => {
    useContextDocsMock.mockReturnValueOnce({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: refetchDocsMock,
    });
    renderTab();
    expect(screen.getByText("Couldn't load project context documents for this skill.")).toBeInTheDocument();
    expect(screen.queryByText("No documents match this filter.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetchDocsMock).toHaveBeenCalled();
  });
});
