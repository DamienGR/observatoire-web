import { defineConfig } from 'vitest/config';

/**
 * Two strictly separated projects (CLAUDE.md §5).
 *
 * - `unit`   — zero I/O, enforced by a setup guard, budget < 30 s.
 * - `integration` — ephemeral Neon branch, needs DATABASE_URL, budget < 4 min.
 *
 * The budgets are enforced by `scripts/budget.mjs`, wired into the npm scripts.
 */
export default defineConfig({
  test: {
    globals: true,
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          globals: true,
          include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
          setupFiles: ['tests/setup/no-io.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          globals: true,
          include: ['tests/integration/**/*.test.ts'],
          setupFiles: ['tests/setup/integration-env.ts'],
          testTimeout: 30_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      reportsDirectory: 'coverage',
      // Only src/lib/ is measured. src/pages/ and src/components/ are covered by
      // E2E, where line coverage means nothing (CLAUDE.md §5).
      include: ['src/lib/**/*.ts'],
      exclude: ['src/lib/**/*.test.ts'],
      thresholds: {
        branches: 90,
      },
    },
  },
});
