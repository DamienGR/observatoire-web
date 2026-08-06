import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROUTE_POLICIES, routePatternFromPageFile } from '~/lib/http/routes.js';

/**
 * "Les en-têtes de cache : énumérer les routes, échouer si l'une ne déclare pas
 * sa politique" — CLAUDE.md §5, fifth test priority.
 *
 * The registry in src/lib/http/routes.ts is pure data, so it can drift from the
 * pages it describes without any test noticing. This one walks src/pages/ and
 * compares the two sets in both directions: a page nobody declared, and a
 * declaration whose page is gone.
 *
 * It reads the filesystem, which the unit project allows — the anti-I/O guard
 * covers the network (tests/setup/no-io.ts). No page is rendered and no route
 * is requested.
 */
const PAGES_DIR = fileURLToPath(new URL('../../src/pages/', import.meta.url));

function pageFiles(directory: string, prefix = ''): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = `${prefix}${entry.name}`;
    return entry.isDirectory()
      ? pageFiles(`${directory}${entry.name}/`, `${relative}/`)
      : [relative];
  });
}

const discovered = pageFiles(PAGES_DIR);
const routes = discovered
  .map((file) => ({ file, pattern: routePatternFromPageFile(file) }))
  .filter((entry): entry is { file: string; pattern: string } => entry.pattern !== null);

describe('route cache policies', () => {
  it('finds the pages on disk at all', () => {
    // Without this, a broken walk would turn the two checks below into two
    // assertions about an empty set — green, and meaningless.
    expect(routes.length).toBeGreaterThan(0);
  });

  it.each(routes)('declares a cache policy for $pattern (src/pages/$file)', ({ pattern }) => {
    expect(Object.keys(ROUTE_POLICIES)).toContain(pattern);
  });

  it('declares no policy for a route that no longer exists', () => {
    const live = new Set(routes.map((route) => route.pattern));

    expect(Object.keys(ROUTE_POLICIES).filter((pattern) => !live.has(pattern))).toEqual([]);
  });
});
