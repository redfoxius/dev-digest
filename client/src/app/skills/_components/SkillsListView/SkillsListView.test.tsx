import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";

// Keep the drawer subtrees out of this component's own test — they get
// their own ImportSkillDrawer.test.tsx / CommunitySkillsDrawer.test.tsx.
vi.mock("../ImportSkillDrawer", () => ({ ImportSkillDrawer: () => <div data-testid="import-drawer" /> }));
vi.mock("../CommunitySkillsDrawer", () => ({ CommunitySkillsDrawer: () => <div data-testid="community-drawer" /> }));

const updateMutate = vi.fn();
let mockSkills: Skill[] = [];
vi.mock("../../../../lib/hooks/skills", () => ({
  useSkills: () => ({ data: mockSkills, isLoading: false, isError: false, refetch: vi.fn() }),
  useUpdateSkill: () => ({ mutate: updateMutate, isPending: false }),
}));

import { SkillsListView } from "./SkillsListView";

afterEach(() => {
  cleanup();
  updateMutate.mockClear();
});

const RUBRIC: Skill = {
  id: "sk1",
  name: "pr-quality-rubric",
  description: "Rates PR quality",
  type: "rubric",
  source: "manual",
  body: "# pr-quality-rubric",
  enabled: true,
  version: 1,
};

const UNVETTED: Skill = {
  id: "sk2",
  name: "owasp-top-10-review",
  description: "Maps diff changes to the OWASP Top 10",
  type: "security",
  source: "imported_url",
  body: "# owasp",
  enabled: false,
  version: 1,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(<NextIntlClientProvider locale="en" messages={{ skills: messages }}>{ui}</NextIntlClientProvider>);
}

describe("SkillsListView (smoke)", () => {
  it("renders each skill's name, type badge, and source badge", () => {
    mockSkills = [RUBRIC];
    renderWithIntl(<SkillsListView onSelect={vi.fn()} onNewSkill={vi.fn()} />);
    expect(screen.getByText("pr-quality-rubric")).toBeInTheDocument();
    expect(screen.getByText("rubric")).toBeInTheDocument();
    expect(screen.getByText("Manual")).toBeInTheDocument();
  });

  it("flags an unvetted (disabled, non-manual) skill with a needs-vetting badge", () => {
    mockSkills = [UNVETTED];
    renderWithIntl(<SkillsListView onSelect={vi.fn()} onNewSkill={vi.fn()} />);
    expect(screen.getByText("needs vetting")).toBeInTheDocument();
  });

  it("calls onSelect with the skill id when a row is clicked", () => {
    mockSkills = [RUBRIC];
    const onSelect = vi.fn();
    renderWithIntl(<SkillsListView onSelect={onSelect} onNewSkill={vi.fn()} />);
    fireEvent.click(screen.getByText("pr-quality-rubric"));
    expect(onSelect).toHaveBeenCalledWith("sk1");
  });

  it("calls onNewSkill when the New skill button is clicked", () => {
    mockSkills = [];
    const onNewSkill = vi.fn();
    renderWithIntl(<SkillsListView onSelect={vi.fn()} onNewSkill={onNewSkill} />);
    fireEvent.click(screen.getByText("New skill"));
    expect(onNewSkill).toHaveBeenCalled();
  });

  it("toggling a row's Toggle calls useUpdateSkill without navigating", () => {
    mockSkills = [RUBRIC];
    const onSelect = vi.fn();
    renderWithIntl(<SkillsListView onSelect={onSelect} onNewSkill={vi.fn()} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(updateMutate).toHaveBeenCalledWith({ id: "sk1", patch: { enabled: false } });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows the empty state when there are no skills", () => {
    mockSkills = [];
    renderWithIntl(<SkillsListView onSelect={vi.fn()} onNewSkill={vi.fn()} />);
    expect(screen.getByText("No skills yet")).toBeInTheDocument();
  });
});
