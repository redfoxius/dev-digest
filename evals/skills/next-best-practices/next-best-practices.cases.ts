import type { SkillCase } from "../../src/index.js";

const CLIENT_COMPONENT_SNIPPET = `\`\`\`tsx
'use client';

export default async function ReviewPanel({ reviewId }: { reviewId: string }) {
  const cookieStore = cookies();
  const theme = cookieStore.get('theme');
  return <div data-theme={theme?.value}>Review {reviewId}</div>;
}
\`\`\``;

export const cases: SkillCase[] = [
  {
    name: "flags an async 'use client' component and a missing await on cookies()",
    kind: "quality",
    prompt: `Review this Next.js component for correctness issues.\n\n${CLIENT_COMPONENT_SNIPPET}`,
    practices: [
      "the review flags 'async function' combined with 'use client' as an invalid pattern — async Client Components are not supported",
      "the review flags cookies() being called without await, since Next.js 15+ made cookies() async",
      "the review does not treat this snippet as correct as-is",
    ],
    threshold: 0.65,
    maxTurns: 8,
  },
  {
    name: "recommends next/image over a raw <img> tag for a remote image",
    kind: "quality",
    prompt:
      "I need to render a user's avatar from an external URL in a Next.js page. Simplest is a plain " +
      "`<img src={user.avatarUrl} />`, right?",
    practices: [
      "the answer recommends next/image instead of a raw <img> tag",
      "the answer mentions that a remote image source needs to be configured (e.g. remotePatterns/images config) for next/image to allow it",
    ],
    threshold: 0.6,
    maxTurns: 6,
  },
];
