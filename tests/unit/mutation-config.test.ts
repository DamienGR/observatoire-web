import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import mutationConfig from '../../vitest.mutation.config.js';
import rootConfig from '../../vitest.config.js';
import { unitProject } from '../../vitest.shared.js';

/**
 * The mutation run must see the unit project, and only the unit project.
 *
 * This file exists because of what the alternative costs. Stryker's vitest
 * runner has no option to select a project (`dir`, `related`, `configFile` and
 * nothing else — read in its own generated options type, after a config that
 * had invented a `project` key failed on the first real run). Pointed at the
 * ordinary config it loads all three projects, and the third one calls
 * `geo.api.gouv.fr` and the DILA directory for real — once per mutant, so
 * roughly two thousand requests to two government APIs from a scheduled job
 * nobody is watching.
 *
 * Nothing in a mutation report would say that had happened. So it is asserted
 * here rather than left to whoever next edits a Vitest config.
 */
const asRecord = (value: unknown): Record<string, unknown> => value as Record<string, unknown>;

describe('vitest.mutation.config.ts', () => {
  it('runs the unit suite and declares no other project', () => {
    const test = asRecord(asRecord(mutationConfig).test);

    expect(test.name).toBe('unit');
    expect(test.projects).toBeUndefined();
  });

  it('keeps the anti-I/O guard, which is the whole safety argument', () => {
    // CLAUDE.md §5: no I/O in the unit project, enforced by code rather than
    // by good will. A mutation run without this guard is a mutation run that
    // can reach the network.
    const test = asRecord(asRecord(mutationConfig).test);

    expect(test.setupFiles).toContain('tests/setup/no-io.ts');
  });

  it('is the very same project object the ordinary suite runs', () => {
    // Imported, not copied. A duplicate would drift, and both things that
    // would drift — the guard above and the `~` alias — fail silently.
    expect(asRecord(mutationConfig).test).toBe(unitProject.test);
    expect(asRecord(mutationConfig).resolve).toBe(unitProject.resolve);

    const projects = asRecord(asRecord(rootConfig).test).projects as unknown[];
    expect(projects).toContain(unitProject);
  });

  it('is the config Stryker is actually pointed at', () => {
    // A config nothing references is a config that stops being maintained,
    // and this one carries the reason the contract suite stays out.
    const stryker = JSON.parse(readFileSync('stryker.config.json', 'utf8')) as {
      vitest?: { configFile?: string };
      mutate?: string[];
    };

    expect(stryker.vitest?.configFile).toBe('vitest.mutation.config.ts');
    // §5 restricts mutation to src/lib/ — the pure logic, and nothing else.
    expect(stryker.mutate).toContain('src/lib/**/*.ts');
  });
});
