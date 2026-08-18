import type { ViteUserConfig } from 'vitest/config';

/**
 * The three test projects of CLAUDE.md §5, defined once.
 *
 * They live here rather than inline in `vitest.config.ts` because a second
 * config file needs the unit project on its own: Stryker's vitest runner
 * accepts `dir`, `related` and `configFile` and **nothing else** — there is no
 * option to select a project — so the only way to mutate against the unit
 * suite alone is to hand it a config that holds nothing else.
 *
 * Copying those few lines into that second file would have been shorter and
 * wrong. What would drift is the anti-I/O guard and the `~` alias, and both
 * fail silently: a mutation run without the guard would let the contract
 * project loose on two government APIs, once per mutant.
 */

/**
 * Mirrors the `~/*` paths entry in tsconfig.json and the Vite alias in
 * astro.config.mjs. It is declared per project on purpose: a `resolve.alias` at
 * the root of a Vitest config is NOT inherited by `projects` entries — each
 * project is its own Vite config — so the root-level version resolves nothing
 * while looking exactly like a working declaration.
 * tests/unit/path-alias.test.ts is what keeps that from being rediscovered the
 * hard way (docs/journal.md 007).
 */
export const resolve = {
  alias: {
    '~': new URL('./src/', import.meta.url).pathname,
  },
};

/** Zero I/O, enforced by a setup guard, budget < 30 s. */
export const unitProject = {
  resolve,
  test: {
    name: 'unit',
    environment: 'node' as const,
    globals: true,
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    setupFiles: ['tests/setup/no-io.ts'],
  },
} satisfies ViteUserConfig;

/** Ephemeral Neon branch, needs DATABASE_URL, budget < 4 min. */
export const integrationProject = {
  resolve,
  test: {
    name: 'integration',
    environment: 'node' as const,
    globals: true,
    include: ['tests/integration/**/*.test.ts'],
    setupFiles: ['tests/setup/integration-env.ts'],
    testTimeout: 30_000,
  },
} satisfies ViteUserConfig;

/**
 * The real third-party APIs. Scheduled, never on a pull request.
 *
 * The only project with no anti-I/O guard: reaching the real APIs is the entire
 * point. It runs on a schedule (.github/workflows/contracts.yml) and never on
 * the path of a pull request — CLAUDE.md §5 makes that inviolable, because a CI
 * that fails for reasons foreign to the diff is a CI everyone learns to ignore.
 */
export const contractProject = {
  resolve,
  test: {
    name: 'contract',
    environment: 'node' as const,
    globals: true,
    include: ['tests/contract/**/*.test.ts'],
    testTimeout: 60_000,
    retry: 1,
  },
} satisfies ViteUserConfig;
