import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Tabs } from "./Tabs";

afterEach(cleanup);

describe("Tabs — pulse indicator", () => {
  it("renders no pulse dot by default", () => {
    const { container } = render(
      <Tabs
        value="overview"
        onChange={() => {}}
        tabs={[
          { key: "overview", label: "Overview" },
          { key: "findings", label: "Agent runs", count: 3 },
        ]}
      />,
    );
    expect(container.querySelector('[title="A review is currently running"]')).not.toBeInTheDocument();
  });

  it("renders a pulse dot next to the label when pulse is true, alongside the existing count badge", () => {
    const { container } = render(
      <Tabs
        value="overview"
        onChange={() => {}}
        tabs={[
          { key: "overview", label: "Overview" },
          { key: "findings", label: "Agent runs", count: 3, pulse: true },
        ]}
      />,
    );
    expect(container.querySelector('[title="A review is currently running"]')).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("clicking a tab still calls onChange with its key (no regression from the new prop)", () => {
    const onChange = vi.fn();
    render(
      <Tabs
        value="overview"
        onChange={onChange}
        tabs={[
          { key: "overview", label: "Overview" },
          { key: "findings", label: "Agent runs", pulse: true },
        ]}
      />,
    );
    fireEvent.click(screen.getByText("Agent runs"));
    expect(onChange).toHaveBeenCalledWith("findings");
  });

  it("string-shaped tab entries (no pulse concept) still render fine", () => {
    render(<Tabs value="a" onChange={() => {}} tabs={["a", "b"]} />);
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getByText("b")).toBeInTheDocument();
  });
});
