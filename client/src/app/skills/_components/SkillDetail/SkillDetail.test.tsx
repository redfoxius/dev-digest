import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill, SkillVersion } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";
import { ToastProvider } from "../../../../lib/toast";

const updateMutate = vi.fn();
const restoreMutate = vi.fn();
let mockVersions: SkillVersion[] = [];

vi.mock("../../../../lib/hooks/skills", () => ({
  useCreateSkill: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateSkill: () => ({ mutate: updateMutate, isPending: false, isSuccess: false }),
  useSkillVersions: () => ({ data: mockVersions, isLoading: false, isError: false, refetch: vi.fn() }),
  useRestoreSkillVersion: () => ({ mutate: restoreMutate, isPending: false }),
}));

vi.mock("../../../../lib/theme", () => ({ useTheme: () => ({ theme: "dark" }) }));

import { SkillDetail } from "./SkillDetail";

afterEach(() => {
  cleanup();
  updateMutate.mockClear();
  restoreMutate.mockClear();
});

const SKILL: Skill = {
  id: "sk1",
  name: "pr-quality-rubric",
  description: "Rates PR quality",
  type: "rubric",
  source: "manual",
  body: "# pr-quality-rubric\n\nCheck test coverage.",
  enabled: true,
  version: 2,
};

function Harness({ skill, initialTab = "config" }: { skill: Skill; initialTab?: string }) {
  const [tab, setTab] = React.useState(initialTab);
  return (
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>
        <SkillDetail skill={skill} tab={tab} onTab={setTab} />
      </ToastProvider>
    </NextIntlClientProvider>
  );
}

describe("SkillDetail (smoke)", () => {
  it("Config tab: renders the name/description/type fields and the version badge", () => {
    render(<Harness skill={SKILL} />);
    expect(screen.getByDisplayValue("pr-quality-rubric")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Rates PR quality")).toBeInTheDocument();
    expect(screen.getByText("v2")).toBeInTheDocument();
    expect(screen.getByText("Save")).toBeInTheDocument();
  });

  it("Preview tab: renders the skill body as Markdown with the reviewing-agent caption", () => {
    render(<Harness skill={SKILL} initialTab="preview" />);
    expect(screen.getByText("Rendered as the reviewing agent receives it.")).toBeInTheDocument();
    expect(screen.getByText("Check test coverage.")).toBeInTheDocument();
  });

  it("Versions tab: lists versions, tags the current one, and offers Diff/Restore on older ones", () => {
    mockVersions = [
      { skill_id: "sk1", version: 2, body: SKILL.body, summary: "Tightened scope rule", created_at: "2026-08-01T00:00:00Z" },
      { skill_id: "sk1", version: 1, body: "# pr-quality-rubric\n\nOriginal.", summary: "Initial version", created_at: "2026-07-01T00:00:00Z" },
    ];
    render(<Harness skill={SKILL} initialTab="versions" />);
    expect(screen.getByText("v2")).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getByText("Tightened scope rule")).toBeInTheDocument();
    expect(screen.getByText("Diff")).toBeInTheDocument();
    expect(screen.getByText("Restore")).toBeInTheDocument();
  });

  it("Versions tab: Restore calls useRestoreSkillVersion with the target version", () => {
    mockVersions = [
      { skill_id: "sk1", version: 2, body: SKILL.body, summary: "Tightened scope rule", created_at: "2026-08-01T00:00:00Z" },
      { skill_id: "sk1", version: 1, body: "# pr-quality-rubric\n\nOriginal.", summary: "Initial version", created_at: "2026-07-01T00:00:00Z" },
    ];
    render(<Harness skill={SKILL} initialTab="versions" />);
    fireEvent.click(screen.getByText("Restore"));
    expect(restoreMutate).toHaveBeenCalledWith(
      { skillId: "sk1", version: 1 },
      expect.anything(),
    );
  });

  it("switching to the Evals/Stats tabs renders the out-of-scope placeholder, not a crash", () => {
    render(<Harness skill={SKILL} initialTab="evals" />);
    expect(screen.getByText(/separate, not-yet-built feature/)).toBeInTheDocument();
  });
});
