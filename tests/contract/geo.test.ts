import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GEO_COMMUNES_ENDPOINT, GEO_COMMUNE_FIELDS, parseCommunes } from '~/lib/sources/geo.js';
import { fetchJson } from './http.js';

/**
 * Asks the real `geo.api.gouv.fr` the questions the frozen fixture answers, and
 * fails when the two stop agreeing.
 *
 * This is the other half of a frozen fixture, and without it the fixture rots:
 * a capture pins the shape the code was written against, and nothing inside a
 * fixture can notice the day upstream stops sending it. CLAUDE.md §5, fourth
 * test priority — "un test de contrat planifié qui interroge les vraies API en
 * cron et échoue bruyamment quand la forme dérive en amont".
 *
 * Scheduled, never on a pull request. §5 forbids a real request on the PR path
 * outright, for a reason worth repeating: a check that fails for causes foreign
 * to the diff teaches everyone to ignore a red CI, which in a project where CI
 * is the only judge is the worst failure available.
 *
 * It re-fetches **the eight fixture records and nothing else**. The first
 * version of this file pulled the whole referential — 35 000 records, 12 MB —
 * to assert that it had a plausible size, and got a 503 for it. Volume is not
 * a contract; the shape of a record is.
 *
 * What it asserts is deliberately structural. A commune's population changes
 * every year, and pinning the number would turn an INSEE update into a red
 * build.
 */
const FIXTURE = fileURLToPath(new URL('../fixtures/geo/communes.json', import.meta.url));

const frozen = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>[];

const live = new Map<string, Record<string, unknown>>();

function communeUrl(code: string): string {
  const url = new URL(`${GEO_COMMUNES_ENDPOINT}/${code}`);
  url.searchParams.set('fields', GEO_COMMUNE_FIELDS.join(','));
  return url.toString();
}

beforeAll(async () => {
  for (const record of frozen) {
    const code = String(record.code);
    const { json } = await fetchJson('geo.api.gouv.fr', communeUrl(code));
    live.set(code, json as Record<string, unknown>);
  }
}, 120_000);

describe('geo.api.gouv.fr still answers what the fixture says it does', () => {
  it('still knows every commune the fixture froze', () => {
    expect([...live.keys()].sort()).toEqual(frozen.map((record) => String(record.code)).sort());
  });

  it.each(frozen.map((record) => String(record.code)))(
    'sends exactly the keys the fixture recorded for %s',
    (code) => {
      // The assertion that catches a renamed or dropped field — the drift a
      // frozen fixture is otherwise blind to.
      const record = frozen.find((entry) => entry.code === code) ?? {};

      expect(Object.keys(live.get(code) ?? {}).sort()).toEqual(Object.keys(record).sort());
    },
  );

  it('still parses through the production schema', () => {
    expect(parseCommunes([...live.values()])).toHaveLength(frozen.length);
  });

  it('still reports a population of zero for Beaumont-en-Verdunois', () => {
    // Destroyed in 1916, never rebuilt, still a commune. The day this changes,
    // `commune_population_not_negative` and its migration were paid for
    // nothing — which is also worth knowing.
    expect(live.get('55039')?.population).toBe(0);
  });

  it('still omits population entirely on an uninhabited commune', () => {
    expect(Object.keys(live.get('98411') ?? {})).not.toContain('population');
  });

  it('still omits codeEpci on a commune belonging to no EPCI', () => {
    expect(Object.keys(live.get('22016') ?? {})).not.toContain('codeEpci');
  });

  it('still uses a letter in the Corsican INSEE codes', () => {
    expect(live.get('2A004')?.codeDepartement).toBe('2A');
  });

  it('still uses three characters for an overseas département code', () => {
    expect(live.get('97101')?.codeDepartement).toBe('971');
  });

  it('keeps every INSEE code five characters long', () => {
    // The premise of `commune_code_insee_length` in src/db/schema.ts.
    for (const record of live.values()) {
      expect(String(record.code)).toHaveLength(5);
    }
  });
});
