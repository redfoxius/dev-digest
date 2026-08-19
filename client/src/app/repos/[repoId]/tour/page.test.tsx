/* page.test.tsx — Onboarding Tour page (docs/onboarding-generator-plan.md
   Work Item 14). Mocks `@/lib/hooks/onboarding` (data layer) and
   `@/components/app-shell` (routing/command-palette chrome, irrelevant
   here), per `conventions/page.tsx`'s untested precedent and
   `context/page.test.tsx`'s own established mocking shape (the only
   colocated `page.test.tsx` in this codebase before this one). */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { OnboardingTourResponse } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import messages from "../../../../../messages/en/onboarding.json";

const { useOnboardingTourMock, regenerateMutate, notifySuccess } = vi.hoisted(() => ({
  useOnboardingTourMock: vi.fn(),
  regenerateMutate: vi.fn(),
  notifySuccess: vi.fn(),
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

let regenerateState: { isPending: boolean; isError: boolean; error: unknown } = {
  isPending: false,
  isError: false,
  error: null,
};

vi.mock("@/lib/hooks/onboarding", () => ({
  useOnboardingTour: useOnboardingTourMock,
  useRegenerateTour: () => ({ mutate: regenerateMutate, ...regenerateState }),
}));

vi.mock("@/lib/toast", () => ({
  notify: { success: notifySuccess, error: vi.fn(), info: vi.fn(), toast: vi.fn() },
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import OnboardingTourPage from "./page";

afterEach(() => {
  cleanup();
  regenerateMutate.mockClear();
  notifySuccess.mockClear();
  regenerateState = { isPending: false, isError: false, error: null };
});

function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
      <OnboardingTourPage />
    </NextIntlClientProvider>,
  );
}

function tourFixture(overrides: Partial<OnboardingTourResponse> = {}): OnboardingTourResponse {
  return {
    tour: {
      sections: [
        { kind: "architecture", title: "Architecture overview", body: "System layout.", diagram: "flowchart TD\nA-->B", links: [] },
        { kind: "critical_paths", title: "Critical paths", body: "Key chains.", diagram: null, links: [{ label: "Entry", path: "src/index.ts" }] },
        { kind: "how_to_run", title: "How to run locally", body: "pnpm dev.", diagram: null, links: [] },
        { kind: "reading_path", title: "Guided reading path", body: "Start here.", diagram: null, links: [] },
        { kind: "first_tasks", title: "First tasks", body: "Fix a typo.", diagram: null, links: [] },
      ],
    },
    indexed_sha: "sha1",
    file_count: 42,
    generated_at: "2026-08-19T00:00:00Z",
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    stale: false,
    ...overrides,
  };
}

describe("OnboardingTourPage", () => {
  it("loading state renders skeleton-shaped placeholders, not a bare spinner", () => {
    useOnboardingTourMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    const { container } = renderPage();
    // Real skeleton blocks (one per section), matching spec §10's
    // "loading (skeleton sections)" UI-state entry — control point #4.
    expect(container.querySelectorAll(".skeleton").length).toBe(5);
  });

  it("empty state shows a Generate CTA with no auto-generation on mount", () => {
    useOnboardingTourMock.mockReturnValue({
      data: { tour: null, indexed_sha: null, file_count: null, generated_at: null, provider: null, model: null, stale: false },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getAllByText("Generate onboarding tour").length).toBeGreaterThan(0);
    expect(regenerateMutate).not.toHaveBeenCalled();
  });

  it("a real load failure (network/500) shows an error state, not the empty-state copy", () => {
    useOnboardingTourMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError("Cannot reach the DevDigest engine at http://localhost:3001. Is the API running?", 0, "network_error"),
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByText("Couldn’t load the onboarding tour")).toBeInTheDocument();
    expect(screen.getByText(/Cannot reach the DevDigest engine/)).toBeInTheDocument();
    expect(screen.queryByText("Generate onboarding tour")).not.toBeInTheDocument();
  });

  it("populated state renders header/subtitle/5 anchors in fixed order plus each section's content", () => {
    useOnboardingTourMock.mockReturnValue({
      data: tourFixture(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByText("Onboarding for acme/widgets")).toBeInTheDocument();
    expect(screen.getByText(/Generated from index of 42 files/)).toBeInTheDocument();

    const nav = screen.getByRole("navigation");
    const navButtons = nav.querySelectorAll("button");
    expect(Array.from(navButtons).map((b) => b.textContent)).toEqual([
      "Architecture overview",
      "Critical paths",
      "How to run locally",
      "Guided reading path",
      "First tasks",
    ]);

    expect(screen.getByText("System layout.")).toBeInTheDocument();
    expect(screen.getByText("Entry")).toBeInTheDocument(); // a link chip
  });

  it("stale: true renders a non-blocking banner with a Regenerate shortcut, alongside the still-visible content", () => {
    useOnboardingTourMock.mockReturnValue({
      data: tourFixture({ stale: true }),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByText(/this tour may be out of date/i)).toBeInTheDocument();
    expect(screen.getByText("System layout.")).toBeInTheDocument(); // content still there
  });

  it("clicking Share link copies the current URL to the clipboard and shows a confirmation toast, with no new network request", async () => {
    useOnboardingTourMock.mockReturnValue({
      data: tourFixture(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Share link" }));

    await waitFor(() => expect(notifySuccess).toHaveBeenCalledWith("Link copied to clipboard."));
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(regenerateMutate).not.toHaveBeenCalled();
  });

  it("a 502 Regenerate failure on an already-populated tour shows a dismissible banner and PRESERVES the previously rendered content — never blanks the page", () => {
    useOnboardingTourMock.mockReturnValue({
      data: tourFixture(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    regenerateState = {
      isPending: false,
      isError: true,
      error: Object.assign(new Error("Onboarding generation failed: provider unreachable"), {
        name: "ApiError",
        code: "external_service_error",
      }),
    };
    renderPage();

    // Previously-rendered sections' content is still in the DOM.
    expect(screen.getByText("System layout.")).toBeInTheDocument();
    expect(screen.getByText("Onboarding for acme/widgets")).toBeInTheDocument();
    // An honest, distinct error banner — never a blank page, never a
    // silent success claim.
    const banner = screen.getByRole("alert");
    expect(banner.textContent).toContain("your previous tour is still shown below");
    // Dismissible.
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a 422 not_indexed Regenerate failure on the empty state shows the honest never-indexed message, distinct from a generic failure", () => {
    useOnboardingTourMock.mockReturnValue({
      data: { tour: null, indexed_sha: null, file_count: null, generated_at: null, provider: null, model: null, stale: false },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    regenerateState = {
      isPending: false,
      isError: true,
      error: Object.assign(new Error("This repo has not been indexed yet — index it before generating a tour."), {
        name: "ApiError",
        code: "not_indexed",
      }),
    };
    renderPage();

    // The empty state itself is still visible (never silently swapped for a
    // blank error page).
    expect(screen.getAllByText("Generate onboarding tour").length).toBeGreaterThan(0);
    const banner = screen.getByRole("alert");
    expect(banner.textContent).toContain("hasn't been indexed yet");
    // Distinct from the "generation failed" wording used for a 502.
    expect(banner.textContent).not.toContain("Generation failed");
  });

  it("clicking Regenerate disables the button with a loading indicator for the call's duration", () => {
    useOnboardingTourMock.mockReturnValue({
      data: tourFixture(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    regenerateState = { isPending: true, isError: false, error: null };
    renderPage();

    const button = screen.getByRole("button", { name: "Regenerating…" });
    expect(button).toBeDisabled();
  });

  it("a malformed diagram string on the architecture section renders the section's body/links normally, hides the diagram region, and throws nothing (AC-17)", () => {
    useOnboardingTourMock.mockReturnValue({
      data: tourFixture({
        tour: {
          sections: [
            { kind: "architecture", title: "Architecture overview", body: "System layout.", diagram: "not a real diagram at all", links: [] },
            { kind: "critical_paths", title: "Critical paths", body: "Key chains.", diagram: null, links: [] },
            { kind: "how_to_run", title: "How to run locally", body: "pnpm dev.", diagram: null, links: [] },
            { kind: "reading_path", title: "Guided reading path", body: "Start here.", diagram: null, links: [] },
            { kind: "first_tasks", title: "First tasks", body: "Fix a typo.", diagram: null, links: [] },
          ],
        },
      }),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    expect(() => renderPage()).not.toThrow();
    expect(screen.getByText("System layout.")).toBeInTheDocument();
    // AC-17's actual Verify clause: "the diagram region is empty/absent
    // rather than throwing" — a real mermaid render writes an <svg> into the
    // DOM (`MermaidDiagram.tsx`'s `ref.current.innerHTML = svg`); the
    // "invalid" branch renders `null` and never touches the ref at all, so
    // no <svg> should ever appear INSIDE the architecture section — scoped
    // to that section specifically, since the page header's own "Share
    // link"/"Regenerate" buttons legitimately render unrelated lucide
    // <svg> icons. A last-resort `querySelector` (no accessible role exists
    // for a decorative diagram) — same accepted exception documented in
    // client/INSIGHTS.md's Badge/lucide-icon entry.
    const architectureHeading = screen.getByRole("heading", { name: "Architecture overview" });
    const architectureSection = architectureHeading.closest("section")!;
    expect(architectureSection.querySelector("svg")).not.toBeInTheDocument();
  });

  it("AC-36 — a successful Regenerate announces 'Tour regenerated.' via the aria-live region", () => {
    useOnboardingTourMock.mockReturnValue({
      data: tourFixture(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    regenerateMutate.mockImplementation((_vars: unknown, opts?: { onSuccess?: () => void }) => {
      opts?.onSuccess?.();
    });
    renderPage();

    const liveRegion = screen.getByRole("status");
    expect(liveRegion).toHaveTextContent("");

    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));

    expect(liveRegion).toHaveTextContent("Tour regenerated.");
  });

  it("AC-36 — a failed Regenerate announces the same distinct failure message via the aria-live region, not a generic one", () => {
    useOnboardingTourMock.mockReturnValue({
      data: tourFixture(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    regenerateMutate.mockImplementation((_vars: unknown, opts?: { onError?: (err: unknown) => void }) => {
      opts?.onError?.(
        Object.assign(new Error("provider unreachable"), { name: "ApiError", code: "external_service_error" }),
      );
    });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));

    const liveRegion = screen.getByRole("status");
    expect(liveRegion.textContent).toContain("Generation failed");
  });
});
