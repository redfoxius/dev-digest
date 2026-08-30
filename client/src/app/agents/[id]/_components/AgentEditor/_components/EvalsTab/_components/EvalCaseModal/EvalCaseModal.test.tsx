import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCase, EvalRunRecord } from "@devdigest/shared";
import messages from "../../../../../../../../../../messages/en/agents.json";
import { ToastProvider } from "@/lib/toast";

const { createMutate, updateMutate } = vi.hoisted(() => ({
  createMutate: vi.fn(),
  updateMutate: vi.fn(),
}));

vi.mock("@/lib/hooks/evals", () => ({
  useCreateEvalCase: () => ({ mutate: createMutate, isPending: false }),
  useUpdateEvalCase: () => ({ mutate: updateMutate, isPending: false }),
}));

import { EvalCaseModal } from "./EvalCaseModal";

afterEach(() => {
  cleanup();
  createMutate.mockClear();
  updateMutate.mockClear();
});

const CASE: EvalCase = {
  id: "c1",
  owner_kind: "agent",
  owner_id: "ag1",
  name: "Hardcoded secret",
  input_diff: "diff --git a/a.ts b/a.ts",
  input_files: null,
  input_meta: { repo: "acme/app", pr_number: 42, title: "Add config" },
  expected_output: {
    expectations: [{ type: "must_find", file: "a.ts", start_line: 12, end_line: 12, description: "secret" }],
  },
  notes: "from an accepted finding",
};

const PASSED_RUN: EvalRunRecord = {
  id: "run1",
  case_id: "c1",
  case_name: "Hardcoded secret",
  ran_at: "2026-08-20T10:00:00Z",
  actual_output: { findings: [{ file: "a.ts" }], must_find_matched: 1, must_find_total: 1, noise_count: 0, kept: 1, dropped: 0 },
  pass: true,
  recall: 1,
  precision: 1,
  citation_accuracy: 1,
  duration_ms: 1500,
  cost_usd: 0.0021,
};

function renderModal(props: Partial<Parameters<typeof EvalCaseModal>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      <ToastProvider>
        <EvalCaseModal agentId="ag1" evalCase={null} onClose={vi.fn()} {...props} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("EvalCaseModal", () => {
  it("renders no status line for a case with no prior run", () => {
    renderModal({ evalCase: CASE, lastRun: undefined });
    expect(screen.queryByText(/^Last run/)).not.toBeInTheDocument();
  });

  it("renders the last-run status line with that run's own values when a prior run exists (AC-32)", () => {
    renderModal({ evalCase: CASE, lastRun: PASSED_RUN });
    expect(screen.getByText("Last run passed · expected 1, got 1 · 1.5s · $0.0021")).toBeInTheDocument();
  });

  it("pre-fills the editable expected_output JSON editor from the case's own expected_output", () => {
    renderModal({ evalCase: CASE });
    const textareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    const expectedField = textareas.find((el) => el.value.includes("must_find"));
    expect(expectedField?.value).toContain('"a.ts"');
  });

  it("disables Save and surfaces an inline error when expected_output is invalid JSON", () => {
    renderModal({ evalCase: CASE });
    const textareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    const expectedField = textareas.find((el) => el.value.includes("must_find"))!;
    fireEvent.change(expectedField, { target: { value: "{not valid json" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Invalid JSON.");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("disables Save and surfaces an inline error when expected_output doesn't match EvalExpectation's shape", () => {
    renderModal({ evalCase: CASE });
    const textareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    const expectedField = textareas.find((el) => el.value.includes("must_find"))!;
    fireEvent.change(expectedField, {
      target: { value: JSON.stringify({ expectations: [{ type: "bogus", file: "x" }] }) },
    });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    // start_line/end_line are missing and type is invalid — some validation
    // detail from EvalCaseExpectedOutput.safeParse must surface inline.
    expect(screen.getByRole("alert")).toHaveTextContent(/expectations/);
  });

  it("clicking Save on an existing case calls useUpdateEvalCase's mutate with the caseId and the edited patch", () => {
    renderModal({ evalCase: CASE });
    const nameInput = screen.getByDisplayValue("Hardcoded secret");
    fireEvent.change(nameInput, { target: { value: "Hardcoded secret (renamed)" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: "c1",
        patch: expect.objectContaining({ name: "Hardcoded secret (renamed)" }),
      }),
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("clicking Save on a new case calls useCreateEvalCase's mutate with the entered name", () => {
    renderModal({ evalCase: null });
    const nameInput = screen.getByPlaceholderText("e.g. Hardcoded secret in config.ts");
    fireEvent.change(nameInput, { target: { value: "New case" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "New case" }),
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("Save stays disabled while the name field is empty", () => {
    renderModal({ evalCase: null });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("switches between Diff/Files/PR-meta tabs by accessible name, each keyboard-operable via a native button", () => {
    renderModal({ evalCase: CASE });
    expect(screen.getByPlaceholderText(/Unified diff text/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "PR meta" }));
    expect(screen.queryByPlaceholderText(/Unified diff text/)).not.toBeInTheDocument();
  });
});
