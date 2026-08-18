import { defineConfig } from 'vitest/config';
import { unitProject } from './vitest.shared.js';

/**
 * The config Stryker runs against, and the reason it exists at all.
 *
 * `@stryker-mutator/vitest-runner` takes `dir`, `related` and `configFile` —
 * there is no option naming a project. Pointed at `vitest.config.ts` it would
 * therefore load all three, and the third is `contract`, which calls
 * `geo.api.gouv.fr` and the DILA directory for real. Once per mutant, that is
 * roughly two thousand requests to two government APIs, from a job nobody is
 * watching. CLAUDE.md §5 forbids far less than that.
 *
 * So the mutation run gets a config holding the unit project and nothing else,
 * flattened to the root because there is only one. It is the same object the
 * ordinary suite uses, imported rather than copied, so the anti-I/O guard and
 * the `~` alias cannot drift out of it unnoticed.
 * `tests/unit/mutation-config.test.ts` asserts that in both directions.
 */
export default defineConfig({
  resolve: unitProject.resolve,
  test: unitProject.test,
});
