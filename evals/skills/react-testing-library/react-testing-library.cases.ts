import type { SkillCase } from "../../src/index.js";

const TEST_SNIPPET = `\`\`\`tsx
test('increments counter', () => {
  const useCounterSpy = vi.spyOn(hooks, 'useCounter');
  render(<Counter />);
  fireEvent.click(screen.getByTestId('increment-btn'));
  expect(useCounterSpy).toHaveBeenCalled();
  expect(component.state.count).toBe(1);
});
\`\`\``;

export const cases: SkillCase[] = [
  {
    name: "flags mocking an own hook and asserting on internal state instead of user-visible output",
    kind: "quality",
    prompt: `Review this React Testing Library test for anti-patterns.\n\n${TEST_SNIPPET}`,
    practices: [
      "the review flags spying on/mocking useCounter (the component's own hook) as violating 'mock at boundaries only' — own hooks/components should not be mocked",
      "the review flags asserting on component.state.count (internal state) instead of what the user sees, and recommends asserting on rendered output (e.g. screen.getByText) instead",
      "the review recommends using userEvent instead of fireEvent for the click interaction, or at least does not present fireEvent as the preferred choice",
    ],
    threshold: 0.65,
    maxTurns: 8,
  },
  {
    name: "recommends one combined flow test over many isolated assertions for a form component",
    kind: "quality",
    prompt:
      "For a login form component, I'm planning to write 8 separate tiny tests: one for each field " +
      "rendering, one for each field accepting input, one for the submit button existing, one for it " +
      "being clickable. Good test plan?",
    practices: [
      "the answer recommends consolidating into fewer, longer tests that walk through full user flows (e.g. happy path: fill fields -> submit -> success; validation errors; API failure) rather than 8 isolated tiny assertions",
      "the answer references the philosophy of fewer tests covering real use-cases over maximizing test count or line coverage",
    ],
    threshold: 0.6,
    maxTurns: 6,
  },
];
