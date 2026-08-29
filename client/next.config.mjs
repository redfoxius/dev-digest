import { fileURLToPath } from "node:url";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001",
  },
  // Root `package.json` (added for `pnpm verify:l06`, see root AGENTS.md) gives this
  // repo a second pnpm lockfile above `client/`. Without this, Next infers the repo
  // root as the workspace root from that lockfile instead of `client/` itself.
  outputFileTracingRoot: fileURLToPath(new URL(".", import.meta.url)),
  webpack(config) {
    // `src/vendor/shared`'s barrels re-export sibling contract files with explicit
    // `.js` specifiers (`export * from './contracts/findings.js'`) matching the
    // server's NodeNext-style ESM convention this vendor copy is hand-copied from —
    // required so both vendor copies stay byte-identical (root AGENTS.md's
    // hand-copied-twin convention). TypeScript resolves this fine (moduleResolution:
    // "bundler"), but webpack's default resolver doesn't try `.ts`/`.tsx` for a `.js`
    // specifier unless told to. This was never exercised before — every prior
    // client file only imported *types* from `@devdigest/shared` (fully elided by
    // the TS compiler before webpack ever sees them); the eval-pipeline feature is
    // the first to import a real runtime value (`EvalCaseExpectedOutput`, a zod
    // schema) through this barrel, which is what surfaces it.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
};

export default withNextIntl(nextConfig);
