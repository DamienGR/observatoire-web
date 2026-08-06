import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SourceParseError } from './errors.js';
import { communesRequestUrl, parseCommunes } from './geo.js';

/**
 * The fixture is a verbatim capture of `geo.api.gouv.fr` (see
 * tests/fixtures/README.md). Reading it is filesystem access, which the unit
 * project allows — the anti-I/O guard covers the network (tests/setup/no-io.ts).
 *
 * Each record in it was chosen for a case that was *measured* across the full
 * referential, not imagined. The comments say which.
 */
const FIXTURE = fileURLToPath(
  new URL('../../../tests/fixtures/geo/communes.json', import.meta.url),
);

const payload: unknown = JSON.parse(readFileSync(FIXTURE, 'utf8'));

const byCode = new Map(parseCommunes(payload).map((commune) => [commune.codeInsee, commune]));

describe('parseCommunes, against the frozen capture', () => {
  it('parses every record of the fixture', () => {
    expect(byCode.size).toBe(8);
  });

  it('maps a plain commune onto the vocabulary of the schema', () => {
    expect(byCode.get('01004')).toEqual({
      codeInsee: '01004',
      nom: 'Ambérieu-en-Bugey',
      population: 15934,
      departement: '01',
      region: '84',
      epci: '240100883',
    });
  });

  it('keeps the leading zero of an INSEE code', () => {
    // The reason the column is `text`: `01004` read as a number is `1004`,
    // which is a different commune's problem entirely.
    expect(byCode.get('01004')?.codeInsee).toBe('01004');
  });

  it('accepts the Corsican codes, whose second character is a letter', () => {
    expect(byCode.get('2A004')?.nom).toBe('Ajaccio');
    expect(byCode.get('2A004')?.departement).toBe('2A');
  });

  it('accepts a three-character overseas département code', () => {
    expect(byCode.get('97101')?.departement).toBe('971');
  });

  it('reports a commune belonging to no EPCI as null, not as a missing key', () => {
    // 98 of them, mostly islands. Île-de-Bréhat is one.
    expect(byCode.get('22016')?.epci).toBeNull();
  });

  it('accepts a population of zero', () => {
    // Beaumont-en-Verdunois was destroyed in 1916 and never rebuilt. It is
    // still a commune, and it still reports 0 inhabitants. A schema demanding
    // a positive population rejects it — and, being a batch, all the others
    // with it.
    expect(byCode.get('55039')?.population).toBe(0);
  });

  it('reports a commune with no population at all as null', () => {
    // The Terres australes: a commune on paper, uninhabited in fact.
    expect(byCode.get('98411')?.population).toBeNull();
    expect(byCode.get('98411')?.epci).toBeNull();
  });
});

describe('parseCommunes, on payloads it must refuse', () => {
  it('refuses a record whose INSEE code is not five characters', () => {
    const bad = [{ code: '1004', nom: 'x', codeDepartement: '01', codeRegion: '84' }];

    expect(() => parseCommunes(bad)).toThrow(SourceParseError);
  });

  it('refuses a population that arrived as a string', () => {
    const bad = [
      { code: '01004', nom: 'x', population: '15934', codeDepartement: '01', codeRegion: '84' },
    ];

    expect(() => parseCommunes(bad)).toThrow(/population/);
  });

  it('refuses a negative population', () => {
    const bad = [
      { code: '01004', nom: 'x', population: -1, codeDepartement: '01', codeRegion: '84' },
    ];

    expect(() => parseCommunes(bad)).toThrow(SourceParseError);
  });

  it('names the source and every offending record, not just the first', () => {
    const bad = [
      { code: 'nope', nom: 'x', codeDepartement: '01', codeRegion: '84' },
      { code: '01004', nom: '', codeDepartement: '01', codeRegion: '84' },
    ];

    try {
      parseCommunes(bad);
      expect.unreachable('parseCommunes should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(SourceParseError);
      expect((error as SourceParseError).source).toBe('geo.api.gouv.fr');
      expect((error as SourceParseError).issues).toHaveLength(2);
      expect((error as SourceParseError).issues.join('\n')).toMatch(/0\.code[\s\S]*1\.nom/);
    }
  });

  it('refuses a payload that is not an array', () => {
    expect(() => parseCommunes({ communes: [] })).toThrow(SourceParseError);
  });
});

describe('communesRequestUrl', () => {
  it('asks for exactly the fields the schema declares', () => {
    // A field nobody requests is a field nobody can store by accident.
    expect(communesRequestUrl()).toBe(
      'https://geo.api.gouv.fr/communes?fields=code%2Cnom%2Cpopulation%2CcodeDepartement%2CcodeRegion%2CcodeEpci',
    );
  });
});
