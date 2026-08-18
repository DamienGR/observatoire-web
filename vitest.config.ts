import { defineConfig } from 'vitest/config';
import { contractProject, integrationProject, unitProject } from './vitest.shared.js';

/**
 * Two strictly separated projects (CLAUDE.md §5), plus the scheduled one.
 *
 * - `unit`   — zero I/O, enforced by a setup guard, budget < 30 s.
 * - `integration` — ephemeral Neon branch, needs DATABASE_URL, budget < 4 min.
 * - `contract` — the real third-party APIs. Scheduled, never on a PR.
 *
 * The budgets are enforced by `scripts/budget.mjs`, wired into the npm scripts.
 * `contract` has none: §5 lists it as unbounded, and a wall-clock kill on a job
 * whose whole purpose is to observe a third party would report our impatience
 * as their drift.
 *
 * The projects themselves are defined in `vitest.shared.ts`, because
 * `vitest.mutation.config.ts` needs the unit one on its own — see the comment
 * there for why that is not a matter of taste.
 */
export default defineConfig({
  test: {
    globals: true,
    projects: [unitProject, integrationProject, contractProject],
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
