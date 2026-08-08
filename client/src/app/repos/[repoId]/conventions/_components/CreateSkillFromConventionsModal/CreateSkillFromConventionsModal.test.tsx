/* Uses the REAL useSkillDraftFromConventions/useCreateSkillFromConventions
   hooks (only `fetch` is mocked) under a real QueryClientProvider, wrapped in
   <React.StrictMode>, asserting the form ends up populated once the draft
   resolves. Note: this does NOT reliably reproduce the original bug on its
   own — that race (a ref-guarded "call mutate only once" effect losing the
   draft because Strict Mode's dev-only mount→cleanup→mount replay tears down
   the FIRST mutate call's subscription before its response lands) needs real
   network latency to manifest; it was found and the fix verified against a
   live dev server (console-instrumented, see CreateSkillFromConventionsModal
   git history), not caught by this jsdom test even pre-fix. This test still
   guards the basic contract: a resolved draft actually lands in form state. */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import messages from "../../../../../../../messages/en/conventions.json";
import { ToastProvider } from "@/lib/toast";

import { CreateSkillFromConventionsModal } from "./CreateSkillFromConventionsModal";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, statusText: "OK", json: async () => body } as Response;
}

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
        <ToastProvider>{ui}</ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const DRAFT = {
  name: "repo-conventions",
  description: "2 house convention(s) extracted from this repo.",
  body: "# repo-conventions\n\nHouse conventions.",
  token_count: 12,
};

describe("CreateSkillFromConventionsModal (smoke)", () => {
  it("populates the form once the draft mutation resolves, even under Strict Mode's double-invoked effect", async () => {
    // Resolves on a real macrotask (not synchronously) so the response lands
    // AFTER Strict Mode's dev-only mount→cleanup→mount effect replay has
    // already run — the exact ordering that exposed the original bug: a
    // ref-guarded "call mutate only once" effect drops the draft, because
    // the FIRST (real) mutate call's mutation-observer subscription is
    // exactly what Strict Mode's cleanup tears down before this resolves.
    const fetchMock = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(jsonResponse(DRAFT)), 0)),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(
      <React.StrictMode>
        <CreateSkillFromConventionsModal
          repoId="repo-1"
          repoLabel="acme/widgets"
          candidateIds={["c1", "c2"]}
          onClose={vi.fn()}
        />
      </React.StrictMode>,
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue("repo-conventions")).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue("2 house convention(s) extracted from this repo.")).toBeInTheDocument();
    // The body itself lives inside @uiw/react-textarea-code-editor's own
    // internal DOM, which jsdom doesn't reliably reflect via `.value` — the
    // token count is plain React output computed straight from the `body`
    // state (`Math.ceil(body.length / 4)`), so it's a reliable proxy that
    // setBody(data.body) actually ran.
    expect(screen.getByText(`${Math.ceil(DRAFT.body.length / 4)} tokens`)).toBeInTheDocument();
  });

  it("does not fetch a draft when there are no candidate ids", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(
      <CreateSkillFromConventionsModal repoId="repo-1" repoLabel="acme/widgets" candidateIds={[]} onClose={vi.fn()} />,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
