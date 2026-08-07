import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/en/skills.json";
import { ToastProvider } from "../../../../lib/toast";
import type { ImportPreview } from "../../../../lib/hooks/skills";

const createMutate = vi.fn();
const filePreviewMutate = vi.fn();
const fileConfirmMutate = vi.fn();
const urlPreviewMutate = vi.fn();
const urlConfirmMutate = vi.fn();

vi.mock("../../../../lib/hooks/skills", () => ({
  useCreateSkill: () => ({ mutate: createMutate, isPending: false }),
  useImportFilePreview: () => ({ mutate: filePreviewMutate, isPending: false, isError: false }),
  useImportFileConfirm: () => ({ mutate: fileConfirmMutate, isPending: false, isError: false }),
  useImportUrlPreview: () => ({ mutate: urlPreviewMutate, isPending: false, isError: false }),
  useImportUrlConfirm: () => ({ mutate: urlConfirmMutate, isPending: false, isError: false }),
}));

import { ImportSkillDrawer } from "./ImportSkillDrawer";

afterEach(() => {
  cleanup();
  createMutate.mockClear();
  filePreviewMutate.mockClear();
  fileConfirmMutate.mockClear();
  urlPreviewMutate.mockClear();
  urlConfirmMutate.mockClear();
});

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>{ui}</ToastProvider>
    </NextIntlClientProvider>,
  );
}

const PREVIEW: ImportPreview = {
  name: "sql-injection-gate",
  description: "",
  type: "security",
  body: "# sql-injection-gate\n\nFlag string-concatenated SQL.",
  ignored_files: ["setup.sh"],
  evidence_files: [],
};

describe("ImportSkillDrawer (smoke)", () => {
  it("File tab: paste form submits via useCreateSkill (no preview step)", () => {
    renderWithProviders(<ImportSkillDrawer initialTab="file" onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("pr-quality-rubric"), { target: { value: "my-skill" } });
    fireEvent.change(screen.getByPlaceholderText(/Describe the rule/), {
      target: { value: "# my-skill\n\nBody." },
    });
    fireEvent.click(screen.getByText("Import skill"));
    expect(createMutate).toHaveBeenCalledWith(
      { name: "my-skill", type: "custom", body: "# my-skill\n\nBody." },
      expect.anything(),
    );
  });

  it("File tab: an uploaded file's preview shows the ignored-files notice and a Confirm action", () => {
    filePreviewMutate.mockImplementation((_file, opts) => opts?.onSuccess?.(PREVIEW));
    renderWithProviders(<ImportSkillDrawer initialTab="file" onClose={vi.fn()} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["# sql-injection-gate"], "skill.zip", { type: "application/zip" });
    fireEvent.change(input, { target: { files: [file] } });

    expect(filePreviewMutate).toHaveBeenCalled();
    expect(screen.getByText("Flag string-concatenated SQL.")).toBeInTheDocument();
    expect(screen.getByText("1 file(s) ignored")).toBeInTheDocument();
    expect(screen.getByText("setup.sh")).toBeInTheDocument();
    expect(screen.getByText("Manual — enabled immediately")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Import skill"));
    expect(fileConfirmMutate).toHaveBeenCalledWith(PREVIEW, expect.anything());
  });

  it("URL tab: fetches a preview then confirms via useImportUrlConfirm", () => {
    urlPreviewMutate.mockImplementation((_url, opts) => opts?.onSuccess?.(PREVIEW));
    renderWithProviders(<ImportSkillDrawer initialTab="url" onClose={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("https://example.com/skills/security.md"), {
      target: { value: "https://example.com/skills/sql-injection-gate.md" },
    });
    fireEvent.click(screen.getByText("Import from URL"));
    expect(urlPreviewMutate).toHaveBeenCalledWith(
      "https://example.com/skills/sql-injection-gate.md",
      expect.anything(),
    );

    expect(screen.getByText("Flag string-concatenated SQL.")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Import from URL"));
    expect(urlConfirmMutate).toHaveBeenCalledWith(PREVIEW, expect.anything());
  });
});
