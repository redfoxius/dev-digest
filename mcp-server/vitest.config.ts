import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Vitest doesn't read tsconfig.json's `paths` on its own — mirror the same
// narrow aliases by hand (same set as tsconfig.json + docs/cli-working-review-plan.md).
export default defineConfig({
  resolve: {
    alias: {
      '@devdigest/shared': path.resolve(__dirname, '../server/src/vendor/shared'),
      '@devdigest/reviewer-core': path.resolve(__dirname, '../reviewer-core/src/index.ts'),
      '@devdigest/server/diff-parser': path.resolve(
        __dirname,
        '../server/src/adapters/git/diff-parser.ts',
      ),
      '@devdigest/server/review-defaults': path.resolve(__dirname, '../server/src/db/seed-prompts.ts'),
      '@devdigest/server/review-constants': path.resolve(
        __dirname,
        '../server/src/modules/reviews/constants.ts',
      ),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
