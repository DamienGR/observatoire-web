import { describe, expect, it } from 'vitest';
import type { CommuneRecord } from '../sources/geo.js';
import { V1_POPULATION_THRESHOLD, isInPerimeter, selectPerimeter } from './perimeter.js';

/**
 * Written before `perimeter.ts` (CLAUDE.md §5: test-first is mandatory for pure
 * logic in src/lib/). The threshold is the one sentence of the brief that
 * decides what this project measures, so the cases below are the ones the real
 * referential actually contains.
 */
function commune(overrides: Partial<CommuneRecord> & { codeInsee: string }): CommuneRecord {
  return {
    nom: 'Commune',
    population: 20_000,
    departement: '01',
    region: '84',
    epci: '240100883',
    ...overrides,
  };
}

describe('isInPerimeter', () => {
  it('keeps a commune above the threshold', () => {
    expect(isInPerimeter(commune({ codeInsee: '01004', population: 15_934 }))).toBe(true);
  });

  it('rejects a commune below the threshold', () => {
    expect(isInPerimeter(commune({ codeInsee: '01001', population: 785 }))).toBe(false);
  });

  it('rejects a commune sitting exactly on the threshold', () => {
    // "Plus de 10 000 habitants" (docs/brief.md §3) is a strict comparison, and
    // this test is the only place that says so. Measured on the referential of
    // 6 August 2026: no commune reports exactly 10 000 inhabitants, so `>` and
    // `>=` select the same 1 067 communes today. The day one does, the
    // perimeter must not change size because nobody wrote the rule down.
    expect(
      isInPerimeter(commune({ codeInsee: '99999', population: V1_POPULATION_THRESHOLD })),
    ).toBe(false);
  });

  it('rejects a commune whose population the referential does not give', () => {
    // Six of them — the Terres australes and Clipperton, communes on paper and
    // uninhabited in fact. Unknown is not "above the threshold".
    expect(isInPerimeter(commune({ codeInsee: '98411', population: null }))).toBe(false);
  });

  it('rejects a commune reporting zero inhabitants', () => {
    // Beaumont-en-Verdunois, destroyed in 1916 and never rebuilt.
    expect(isInPerimeter(commune({ codeInsee: '55039', population: 0 }))).toBe(false);
  });
});

describe('selectPerimeter', () => {
  it('keeps only the communes above the threshold', () => {
    const selected = selectPerimeter([
      commune({ codeInsee: '01001', population: 785 }),
      commune({ codeInsee: '01004', population: 15_934 }),
      commune({ codeInsee: '98411', population: null }),
    ]);

    expect(selected.map((entry) => entry.codeInsee)).toEqual(['01004']);
  });

  it('narrows the population to a number, so no caller has to re-check it', () => {
    // `commune.population` is `not null` in the schema while the parser types it
    // as `number | null`. Doing the narrowing here — in the one function that
    // already decides on population — is what keeps a `?? 0` out of the writer,
    // where it would silently store a wrong number.
    const [selected] = selectPerimeter([commune({ codeInsee: '01004', population: 15_934 })]);

    expect(selected?.population).toBe(15_934);
  });

  it('sorts by INSEE code, so two runs on the same data write in the same order', () => {
    const selected = selectPerimeter([
      commune({ codeInsee: '75056', population: 2_133_111 }),
      commune({ codeInsee: '01004', population: 15_934 }),
      commune({ codeInsee: '2A004', population: 71_361 }),
    ]);

    expect(selected.map((entry) => entry.codeInsee)).toEqual(['01004', '2A004', '75056']);
  });

  it('keeps one row per INSEE code, and the last one wins', () => {
    // Not a hypothetical tidiness: a batched upsert with the same key twice
    // fails outright — "ON CONFLICT DO UPDATE command cannot affect row a
    // second time" — and it would fail on the whole batch, at night, in a job
    // nobody is watching. The referential has never sent a duplicate; this is
    // the guard that says what happens if it ever does.
    const selected = selectPerimeter([
      commune({ codeInsee: '01004', nom: 'Ancien', population: 15_000 }),
      commune({ codeInsee: '01004', nom: 'Courant', population: 15_934 }),
    ]);

    expect(selected).toHaveLength(1);
    expect(selected[0]?.nom).toBe('Courant');
  });

  it('accepts a threshold other than the v1 one', () => {
    // The perimeter is extensible by design (docs/brief.md §3): the threshold is
    // a parameter rather than a constant read from three places.
    const selected = selectPerimeter([commune({ codeInsee: '01001', population: 785 })], 500);

    expect(selected.map((entry) => entry.codeInsee)).toEqual(['01001']);
  });
});
