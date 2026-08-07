import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { CommunitySkill } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";
import { ToastProvider } from "../../../../lib/toast";

const installMutate = vi.fn();
let mockCommunity: CommunitySkill[] = [];

vi.mock("../../../../lib/hooks/skills", () => ({
  useCommunitySkills: () => ({ data: mockCommunity, isLoading: false, isError: false, refetch: vi.fn() }),
  useInstallCommunitySkill: () => ({ mutate: installMutate, isPending: false, variables: undefined }),
}));

import { CommunitySkillsDrawer } from "./CommunitySkillsDrawer";

afterEach(() => {
  cleanup();
  installMutate.mockClear();
});

const SKILLS: CommunitySkill[] = [
  { name: "owasp-top-10-review", repo: "secdev/agent-skills", stars: 1240, lang: "any", desc: "Maps diff changes to the OWASP Top 10." },
  { name: "react-hooks-rules", repo: "frontend-guild/skills", stars: 842, lang: "TypeScript", desc: "Detects conditional hooks." },
];

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>{ui}</ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("CommunitySkillsDrawer (smoke)", () => {
  it("renders result cards with name, stars, repo and language", () => {
    mockCommunity = SKILLS;
    renderWithProviders(<CommunitySkillsDrawer onClose={vi.fn()} />);
    expect(screen.getByText("owasp-top-10-review")).toBeInTheDocument();
    expect(screen.getByText("1240")).toBeInTheDocument();
    expect(screen.getByText("secdev/agent-skills")).toBeInTheDocument();
    expect(screen.getAllByText("Import").length).toBe(2);
  });

  it("filters by the search box across name + description", () => {
    mockCommunity = SKILLS;
    renderWithProviders(<CommunitySkillsDrawer onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/Search community skills/), { target: { value: "hooks" } });
    expect(screen.getByText("react-hooks-rules")).toBeInTheDocument();
    expect(screen.queryByText("owasp-top-10-review")).not.toBeInTheDocument();
  });

  it("filters by language chip", () => {
    mockCommunity = SKILLS;
    renderWithProviders(<CommunitySkillsDrawer onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "TypeScript" }));
    expect(screen.getByText("react-hooks-rules")).toBeInTheDocument();
    expect(screen.queryByText("owasp-top-10-review")).not.toBeInTheDocument();
  });

  it("clicking + Import calls useInstallCommunitySkill with the skill's name", () => {
    mockCommunity = SKILLS;
    renderWithProviders(<CommunitySkillsDrawer onClose={vi.fn()} />);
    fireEvent.click(screen.getAllByText("Import")[0]!);
    expect(installMutate).toHaveBeenCalledWith("owasp-top-10-review", expect.anything());
  });

  it("shows the no-match empty state when nothing matches the filter", () => {
    mockCommunity = SKILLS;
    renderWithProviders(<CommunitySkillsDrawer onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/Search community skills/), { target: { value: "zzz-nope" } });
    expect(screen.getByText("No matching skills")).toBeInTheDocument();
  });
});
