import { parseIpAddress as viaAlias } from '~/lib/fetch/index.js';
import { parseIpAddress as viaRelative } from '../../src/lib/fetch/index.js';

/**
 * The `~/` alias has to be declared in three places that cannot see each other:
 * `tsconfig.json` teaches `tsc`, `astro.config.mjs` teaches the build, and this
 * config teaches the tests. Nothing links them, so any one of the three can be
 * forgotten and the other two will keep working — a `~/` import would typecheck,
 * build, and then fail only under test.
 *
 * Identity is the assertion that matters, not resolution. A test that merely
 * imported through the alias would pass on a misconfiguration that resolves it
 * to a *second copy* of the module: module-level state would silently split in
 * two. Comparing the two bindings rules out both failures at once.
 */
describe('the ~ path alias', () => {
  it('resolves to the same module as the relative path', () => {
    expect(viaAlias).toBe(viaRelative);
  });
});
