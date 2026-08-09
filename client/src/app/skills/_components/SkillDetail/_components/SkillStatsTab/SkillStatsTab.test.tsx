import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill, SkillStats } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/skills.json";

let mockStats: SkillStats | undefined;
let mockIsLoading = false;
let mockIsError = false;
const refetch = vi.fn();

vi.mock("../../../../../../lib/hooks/skills", () => ({
  useSkillStats: () => ({ data: mockStats, isLoading: mockIsLoading, isError: mockIsError, refetch }),
}));

import { SkillStatsTab } from "./SkillStatsTab";

afterEach(() => {
  cleanup();
  mockStats = undefined;
  mockIsLoading = false;
  mockIsError = false;
  refetch.mockClear();
});

const SKILL: Skill = {
  id: "sk1",
  name: "breaking-change",
  description: "Flags breaking API changes",
  type: "convention",
  source: "manual",
  body: "# breaking-change",
  enabled: true,
  version: 1,
};

function Harness() {
  return (
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <SkillStatsTab skill={SKILL} />
    </NextIntlClientProvider>
  );
}

describe("SkillStatsTab", () => {
  it("renders the 4 KPI tiles, agents list, and findings-by-category donut", () => {
    mockStats = {
      used_by: 2,
      pull_frequency: 0.5,
      accept_rate: 0.75,
      findings_count: 3,
      agents_using_this_skill: [
        { agent_id: "agent-1", agent_name: "API Contract Reviewer" },
        { agent_id: "agent-2", agent_name: "Test Quality Reviewer" },
      ],
      findings_by_category: [
        { category: "security", count: 2 },
        { category: "bug", count: 1 },
      ],
    };
    render(<Harness />);

    expect(screen.getByText("2")).toBeInTheDocument(); // used_by
    expect(screen.getByText("50")).toBeInTheDocument(); // pull_frequency %
    expect(screen.getByText("75")).toBeInTheDocument(); // accept_rate %
    expect(screen.getByText("3")).toBeInTheDocument(); // findings_count

    expect(screen.getByText("API Contract Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Test Quality Reviewer")).toBeInTheDocument();
    expect(screen.getByText("security")).toBeInTheDocument();
    expect(screen.getByText("bug")).toBeInTheDocument();
  });

  it("shows a no-data note when the skill has no usage yet, without crashing on nulls", () => {
    mockStats = {
      used_by: 0,
      pull_frequency: null,
      accept_rate: null,
      findings_count: 0,
      agents_using_this_skill: [],
      findings_by_category: [],
    };
    render(<Harness />);

    expect(screen.getByText(/No usage data yet/)).toBeInTheDocument();
    expect(screen.getByText("Not linked to any agent yet.")).toBeInTheDocument();
    expect(screen.getByText("No findings from this skill's runs yet.")).toBeInTheDocument();
  });

  it("renders an ErrorState with retry on load failure", () => {
    mockIsError = true;
    render(<Harness />);
    expect(screen.getByText("Could not load this skill's stats.")).toBeInTheDocument();
  });
});
