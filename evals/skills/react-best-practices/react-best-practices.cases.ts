import type { SkillCase } from "../../src/index.js";

const COMPONENT_SNIPPET = `\`\`\`tsx
function ReviewList({ reviews }) {
  const [sortedReviews, setSortedReviews] = useState([]);

  useEffect(() => {
    setSortedReviews([...reviews].sort((a, b) => b.score - a.score));
  }, [reviews]);

  function renderReviewCard(review) {
    return <div key={review.id}>{review.title}: {review.score}</div>;
  }

  return <div>{sortedReviews.map(renderReviewCard)}</div>;
}
\`\`\``;

export const cases: SkillCase[] = [
  {
    name: "flags derived state stored via useState+useEffect and a renderX() factory function",
    kind: "quality",
    prompt: `Review this React component for anti-patterns.\n\n${COMPONENT_SNIPPET}`,
    practices: [
      "the review flags sortedReviews as derived state that should be computed inline during render (or via useMemo if proven expensive), not synced via useState + useEffect — calling this out as the CRITICAL 'Derive, Don't Store' anti-pattern",
      "the review flags renderReviewCard as a render-factory function (camelCase function returning JSX) that should be a PascalCase component instead, and explains this breaks reconciliation/component identity",
      "the review does not merely suggest adding a dependency array fix to the useEffect without addressing that the effect itself is unnecessary",
    ],
    threshold: 0.7,
    maxTurns: 8,
  },
  {
    name: "pushes back on premature useMemo/useCallback for cheap computations",
    kind: "quality",
    prompt:
      "Should I wrap this in useMemo to be safe? `const label = useMemo(() => \`\${user.first} " +
      "\${user.last}\`, [user]);`",
    practices: [
      "the answer advises against useMemo here, since string concatenation is a cheap computation that doesn't need memoization",
      "the answer states useMemo should be reserved for computations that are actually expensive (measured, not assumed)",
    ],
    threshold: 0.6,
    maxTurns: 6,
  },
];
