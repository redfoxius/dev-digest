import type { SkillCase } from "../../src/index.js";

const COMPONENT_SNIPPET = `\`\`\`tsx
// app/reviews/[id]/_components/ReviewSummary/ReviewSummary.tsx
export function ReviewSummary({ reviewId }: { reviewId: string }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch(\`\${process.env.NEXT_PUBLIC_API_BASE}/reviews/\${reviewId}\`)
      .then((r) => r.json())
      .then(setData);
  }, [reviewId]);

  if (!data) return <p>Loading...</p>;
  return <div>{data.summary}</div>;
}
\`\`\``;

export const cases: SkillCase[] = [
  {
    name: "flags an inline fetch() in a component body as a CRITICAL data-access-boundary violation",
    kind: "quality",
    prompt: `Review this component for architectural placement issues. Where should this logic live?\n\n${COMPONENT_SNIPPET}`,
    practices: [
      "the review flags the inline fetch() call inside the component body as a violation of the lib/api.ts data-access boundary, calling it CRITICAL or similarly high severity",
      "the review recommends moving the data fetching into a lib/hooks/<domain>.ts TanStack Query hook rather than leaving it in the component or just wrapping it in useEffect more carefully",
      "the review does not suggest a generic services/ folder, since this repo has no services/ folder and uses lib/api.ts + lib/hooks/*.ts instead",
    ],
    // 3 practices → 0.7 sat between the 0.667/1.0 achievable scores, requiring all 3.
    threshold: 0.6,
    maxTurns: 8,
  },
  {
    name: "distinguishes route-colocated components from the shared components/ directory",
    kind: "quality",
    prompt:
      "I'm building a new 'RunBadge' component that's only used inside one route's page. Should I put " +
      "it in the top-level src/components/ directory so it's easy to find, or somewhere else?",
    practices: [
      "the answer recommends colocating RunBadge under that route's private _components/ folder rather than the top-level src/components/ directory, since it's used in only one route",
      "the answer explains that src/components/ is reserved for UI reused across 2+ routes",
    ],
    // 2 practices → only 0.5/1.0 are achievable non-zero scores; 0.65 required both.
    threshold: 0.5,
    maxTurns: 6,
  },
];
