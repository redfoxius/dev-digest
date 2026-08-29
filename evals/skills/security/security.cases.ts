import type { SkillCase } from "../../src/index.js";

const ROUTE_SNIPPET = `\`\`\`javascript
app.get('/proxy', async (req, res) => {
  const target = req.query.url;
  const response = await fetch(target);
  res.send(await response.text());
});

app.get('/me', (req, res) => {
  const payload = jwt.decode(req.headers.authorization);
  res.json({ userId: payload.userId });
});
\`\`\``;

export const cases: SkillCase[] = [
  {
    name: "flags SSRF via attacker-controlled fetch target and jwt.decode() instead of jwt.verify()",
    kind: "quality",
    prompt: `Review this Express route for security issues.\n\n${ROUTE_SNIPPET}`,
    practices: [
      "the review flags fetch(target) using req.query.url as attacker-controlled input with HIGH confidence (SSRF-shaped issue), tracing that the value comes directly from the request",
      "the review flags jwt.decode() being used instead of jwt.verify() on the /me route, explaining that decode() does not check the signature",
      "the review does not report either finding as merely theoretical/LOW confidence given both trace directly to attacker-controlled input",
    ],
    // 3 practices → 0.7 sat between 0.667/1.0, requiring all 3.
    threshold: 0.6,
    maxTurns: 8,
  },
  {
    name: "does not flag a server-controlled value using the golden rule",
    kind: "quality",
    prompt:
      "Is this safe? `const response = await fetch(process.env.INTERNAL_REPORTING_URL);` — the URL " +
      "comes from an environment variable set by our deployment config, never from user input.",
    practices: [
      "the answer states this is safe (or not a real vulnerability) because the value is server-controlled (an env var), not attacker-controlled",
      "the answer does not flag this as an SSRF or injection vulnerability given no attacker-controlled input is involved",
    ],
    // 2 practices → only 0.5/1.0 achievable; 0.6 required both.
    threshold: 0.5,
    maxTurns: 6,
  },
];
