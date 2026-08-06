import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, AgentSkillLink, Skill } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/agents.json";

// Mocks are read inside the vi.mock factories below (which Vitest hoists
// above these imports), so the spies themselves must be created via
// vi.hoisted rather than a plain module-level const.
const { setSkillsMutate, setEnabledMutate } = vi.hoisted(() => ({
  setSkillsMutate: vi.fn(),
  setEnabledMutate: vi.fn(),
}));

vi.mock("../../../../../../../lib/hooks/agents", () => ({
  useAgentSkills: () => ({ data: LINKS, isLoading: false }),
  useSetAgentSkills: () => ({ mutate: setSkillsMutate }),
  useSetAgentSkillEnabled: () => ({ mutate: setEnabledMutate }),
}));

vi.mock("../../../../../../../lib/hooks/skills", () => ({
  useSkills: () => ({ data: SKILLS, isLoading: false }),
}));

import { SkillsTab } from "./SkillsTab";

afterEach(() => {
  cleanup();
  setSkillsMutate.mockClear();
  setEnabledMutate.mockClear();
});

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
  skills_count: 1,
};

// s1: linked, enabled, manual+enabled (never needs vetting).
// s2: linked, but the LINK is disabled; the skill itself is
//     community-sourced and globally disabled -> needs vetting.
// s3: never linked to this agent (appended after, sorted by name).
const SKILLS: Skill[] = [
  {
    id: "s1",
    name: "z-skill",
    description: "",
    type: "custom",
    source: "manual",
    body: "body",
    enabled: true,
    version: 1,
  },
  {
    id: "s2",
    name: "a-skill",
    description: "",
    type: "security",
    source: "community",
    body: "body",
    enabled: false,
    version: 1,
  },
  {
    id: "s3",
    name: "m-skill",
    description: "",
    type: "rubric",
    source: "manual",
    body: "body",
    enabled: true,
    version: 1,
  },
];

const LINKS: AgentSkillLink[] = [
  { agent_id: "ag1", skill_id: "s1", order: 0, enabled: true },
  { agent_id: "ag1", skill_id: "s2", order: 1, enabled: false },
];

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      <SkillsTab agent={AGENT} />
    </NextIntlClientProvider>,
  );
}

describe("SkillsTab", () => {
  it("merges the catalog with the agent's links: linked first (in order), then unlinked", () => {
    renderTab();
    const names = screen.getAllByText(/-skill$/).map((el) => el.textContent);
    expect(names).toEqual(["z-skill", "a-skill", "m-skill"]);
  });

  it("shows the linked/total enabled count", () => {
    renderTab();
    // Only s1's link is enabled -> 1 of 3.
    expect(screen.getByText("1 of 3 enabled")).toBeInTheDocument();
  });

  it("checking an unlinked skill attaches it (enabled: true)", () => {
    renderTab();
    const checkboxes = screen.getAllByRole("checkbox");
    // Row order is s1, s2, s3 -> s3's checkbox is the third.
    fireEvent.click(checkboxes[2]!);
    expect(setEnabledMutate).toHaveBeenCalledWith({ skillId: "s3", enabled: true });
  });

  it("unchecking a linked+enabled skill detaches it (enabled: false)", () => {
    renderTab();
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]!); // s1
    expect(setEnabledMutate).toHaveBeenCalledWith({ skillId: "s1", enabled: false });
  });

  it("flags a globally-unvetted skill's row but not an already-vetted one", () => {
    renderTab();
    expect(screen.getByText("needs vetting")).toBeInTheDocument();
    // Exactly one row should carry the indicator (s2 only).
    expect(screen.getAllByText("needs vetting")).toHaveLength(1);
  });

  it("dragging a row onto another calls useSetAgentSkills with the full reordered id list", () => {
    renderTab();
    const handles = screen.getAllByRole("button", { name: /Reorder/ });
    // handles[2] = s3 (unlinked, currently last); drag it onto s1's row (handles[0]).
    fireEvent.dragStart(handles[2]!, { dataTransfer: { setData: vi.fn() } });
    fireEvent.dragOver(handles[0]!);
    fireEvent.drop(handles[0]!);
    expect(setSkillsMutate).toHaveBeenCalledWith(["s3", "s1", "s2"]);
  });
});
