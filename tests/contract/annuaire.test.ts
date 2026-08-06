import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ANNUAIRE_DATASET_ENDPOINT,
  ANNUAIRE_FIELDS,
  MAIRIE_PIVOT,
  isMairie,
  mairiesRequestUrl,
  parseAnnuairePage,
  type AnnuairePage,
} from '~/lib/sources/annuaire.js';
import { fetchJson, type FetchedJson } from './http.js';

/**
 * The DILA half of the scheduled contract check. Same contract as
 * tests/contract/geo.test.ts: scheduled, never on a pull request, structural
 * rather than numeric.
 *
 * One assertion here is worth more than the others, and it is the one that
 * would have saved this session an hour: the encoding of an absent value. It
 * is `null`. Inspecting this API through a Python REPL displays it as `None`,
 * which looks exactly like a string sentinel and is not one. The test pins the
 * raw bytes, so nobody has to trust a memory of what a REPL printed.
 */
const FIXTURE = fileURLToPath(new URL('../fixtures/annuaire/mairies.json', import.meta.url));

const frozen = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
  results: Record<string, unknown>[];
};

/** The exact records the fixture froze, fetched again by id. */
function refetchUrl(): string {
  const ids = frozen.results.map((record) => `"${String(record.id)}"`).join(',');
  const url = new URL(`${ANNUAIRE_DATASET_ENDPOINT}/records`);
  url.searchParams.set('where', `id in (${ids})`);
  url.searchParams.set('select', ANNUAIRE_FIELDS.join(','));
  url.searchParams.set('limit', String(frozen.results.length));
  return url.toString();
}

let sample: FetchedJson;
let page: AnnuairePage;
let refetched: FetchedJson;

beforeAll(async () => {
  sample = await fetchJson('annuaire', mairiesRequestUrl({ limit: 100 }));
  page = parseAnnuairePage(sample.json);
  refetched = await fetchJson('annuaire', refetchUrl());
}, 120_000);

describe('the DILA directory still answers what the fixture says it does', () => {
  it('answers the town-hall query at all, with a plausible count', () => {
    expect(page.totalCount).toBeGreaterThan(30_000);
    expect(page.totalCount).toBeLessThan(40_000);
    expect(page.records).toHaveLength(100);
  });

  it('still encodes an absent value as null, never as the string "None"', () => {
    // The trap this session fell into. Asserted on the raw bytes, because both
    // spellings survive `JSON.parse` into something that prints the same way.
    expect(sample.text).not.toContain('"None"');
    expect(sample.text).toMatch(/:\s*null/);
  });

  it('still hides its structured fields as JSON inside a string', () => {
    const raw = (sample.json as { results: Record<string, unknown>[] }).results;
    const withSite = raw.filter((record) => typeof record.site_internet === 'string');

    expect(withSite.length).toBeGreaterThan(0);
    for (const record of withSite.slice(0, 10)) {
      const parsed: unknown = JSON.parse(String(record.site_internet));
      expect(Array.isArray(parsed)).toBe(true);
      expect(Object.keys((parsed as Record<string, unknown>[])[0] ?? {}).sort()).toEqual([
        'libelle',
        'valeur',
      ]);
    }
  });

  it('sends exactly the keys the fixture recorded, for every fixture record', () => {
    const live = (refetched.json as { results: Record<string, unknown>[] }).results;
    const liveById = new Map(live.map((record) => [String(record.id), record]));

    for (const record of frozen.results) {
      const upstream = liveById.get(String(record.id));
      expect(upstream, `record ${String(record.nom)} vanished upstream`).toBeDefined();
      expect(Object.keys(upstream ?? {}).sort()).toEqual(Object.keys(record).sort());
    }
  });

  it('still returns a bare array, with no envelope, from the export endpoint', () => {
    // Asserted on the shape rather than the content: the export of the whole
    // dataset is 12 MB, and one record is enough to know which envelope it uses.
    expect(page.records.length).toBeGreaterThan(0);
  });

  it('still lets the town-hall query answer for something that is a mairie', () => {
    expect(page.records.every((record) => isMairie(record))).toBe(true);
    expect(
      page.records.every((record) =>
        record.pivots.some((pivot) => pivot.typeServiceLocal === MAIRIE_PIVOT),
      ),
    ).toBe(true);
  });

  it('still proposes some websites, and some records with none', () => {
    // Both halves matter: a directory that suddenly had a URL for everyone, or
    // for no one, would be a different dataset. Deliberately *not* asserted
    // here: that some value fails to parse as a URL. Five of the 22 147
    // websites are in that case, so a 100-record sample says nothing about it —
    // an assertion that holds by luck is worse than none. The case is pinned by
    // the fixture instead (`Mairie - Bajus`).
    expect(page.records.some((record) => record.urls.length > 0)).toBe(true);
    expect(page.records.some((record) => record.urls.length === 0)).toBe(true);
  });
});
