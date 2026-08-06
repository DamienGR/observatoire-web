import { defineConfig } from 'vitest/config';

/**
 * Two strictly separated projects (CLAUDE.md §5).
 *
 * - `unit`   — zero I/O, enforced by a setup guard, budget < 30 s.
 * - `integration` — ephemeral Neon branch, needs DATABASE_URL, budget < 4 min.
 * - `contract` — the real third-party APIs. Scheduled, never on a PR.
 *
 * The budgets are enforced by `scripts/budget.mjs`, wired into the npm scripts.
 * `contract` has none: §5 lists it as unbounded, and a wall-clock kill on a job
 * whose whole purpose is to observe a third party would report our impatience
 * as their drift.
 */

/**
 * Mirrors the `~/*` paths entry in tsconfig.json and the Vite alias in
 * astro.config.mjs. It is declared per project on purpose: a `resolve.alias` at
 * the root of this file is NOT inherited by `projects` entries — each project is
 * its own Vite config — so the root-level version resolves nothing while looking
 * exactly like a working declaration. tests/unit/path-alias.test.ts is what
 * keeps that from being rediscovered the hard way.
 */
const resolve = {
  alias: {
    '~': new URL('./src/', import.meta.url).pathname,
  },
};

export default defineConfig({
  test: {
    globals: true,
    projects: [
      {
        resolve,
        test: {
          name: 'unit',
          environment: 'node',
          globals: true,
          include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
          setupFiles: ['tests/setup/no-io.ts'],
        },
      },
      {
        resolve,
        test: {
          name: 'integration',
          environment: 'node',
          globals: true,
          include: ['tests/integration/**/*.test.ts'],
          setupFiles: ['tests/setup/integration-env.ts'],
          testTimeout: 30_000,
        },
      },
      {
        resolve,
        test: {
          name: 'contract',
          environment: 'node',
          globals: true,
          include: ['tests/contract/**/*.test.ts'],
          // The only project with no anti-I/O guard: reaching the real APIs is
          // the entire point. It runs on a schedule (.github/workflows/
          // contracts.yml) and never on the path of a pull request — CLAUDE.md
          // §5 makes that inviolable, because a CI that fails for reasons
          // foreign to the diff is a CI everyone learns to ignore.
          testTimeout: 60_000,
          retry: 1,
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
