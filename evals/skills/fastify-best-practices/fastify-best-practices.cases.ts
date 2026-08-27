import type { SkillCase } from "../../src/index.js";

const ROUTE_SNIPPET = `\`\`\`typescript
import Fastify from 'fastify';
const app = Fastify({ logger: true });

app.get('/users/:id', async (request, reply) => {
  const id = request.params.id;
  const user = await db.query('SELECT * FROM users WHERE id = ' + id);
  return user;
});

app.listen({ port: 3000 });
\`\`\``;

export const cases: SkillCase[] = [
  {
    name: "flags a route with no schema validation and registered outside a plugin",
    kind: "quality",
    prompt: `Review this Fastify server for best-practice issues.\n\n${ROUTE_SNIPPET}`,
    practices: [
      "the review flags the /users/:id route as missing a JSON Schema for params/response validation and serialization",
      "the review flags registering the route directly on the top-level app instance instead of inside an encapsulated plugin",
      "the review does not merely praise the use of async/await without addressing the missing schema and plugin-encapsulation issues",
    ],
    threshold: 0.65,
    maxTurns: 8,
  },
  {
    name: "recommends router.use-style barrier auth over per-route checks",
    kind: "quality",
    prompt:
      "I'm adding an admin-only Fastify plugin with 6 routes. My plan is to check `request.user.isAdmin` " +
      "individually inside each of the 6 route handlers. Good approach, or is there a better pattern?",
    practices: [
      "the answer recommends applying an auth/admin check as a hook (e.g. onRequest/preHandler) registered once for the plugin/encapsulation context, rather than repeating the same check in every handler",
      "the answer explains the risk of the per-handler approach: a new 7th route added later could forget the check",
    ],
    threshold: 0.6,
    maxTurns: 6,
  },
];
