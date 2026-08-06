import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  isMairie,
  mairiesRequestUrl,
  parseAnnuairePage,
  parseAnnuaireRecords,
  type AnnuaireRecord,
} from './annuaire.js';
import { SourceParseError } from './errors.js';

/**
 * The fixture is a verbatim capture of ten records from the DILA directory
 * (see tests/fixtures/README.md), each picked for a case measured across the
 * 35 803 town-hall records rather than imagined.
 */
const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../../../tests/fixtures/annuaire/${name}`, import.meta.url)),
      'utf8',
    ),
  );

/** `/records`, envelope included. */
const payload = fixture('mairies.json');
/** `/exports/json`, the same ten records as a bare array. */
const exported = fixture('mairies-export.json');

const page = parseAnnuairePage(payload);
const byName = new Map(page.records.map((record) => [record.nom, record]));

function get(nom: string): AnnuaireRecord {
  const record = byName.get(nom);
  if (record === undefined) throw new Error(`fixture no longer contains "${nom}"`);
  return record;
}

describe('parseAnnuairePage, against the frozen capture', () => {
  it('reads the envelope /records answers with', () => {
    expect(page.totalCount).toBe(10);
    expect(page.records).toHaveLength(10);
  });

  it('extracts the website out of the JSON hidden in a string', () => {
    expect(get('Mairie - Curgy').urls).toEqual(['https://www.curgy.fr/']);
  });

  it('reports a commune with no website as having none', () => {
    // 13 656 records are in this case, and the field is a plain `null`.
    expect(get('Mairie - Courcelles-sur-Aire').urls).toEqual([]);
  });

  it('keeps every candidate when a record proposes several', () => {
    // Three spellings of the same site. Choosing between them is the
    // resolution state machine's job (J1-06), not the parser's.
    expect(get('Mairie - Saint-Malo - annexe Saint-Servan').urls).toEqual([
      'https://www.ville-saint-malo.fr',
      'https://saint-malo.fr',
      'https://www.saint-malo.fr',
    ]);
  });

  it('hands over an http URL without upgrading or dropping it', () => {
    // 4 957 of them. §7 decides what to do with http; the parser only reports.
    expect(get('Mairie - Baignes-Sainte-Radegonde').urls).toEqual([
      'http://www.baignes-sainte-radegonde.fr',
    ]);
  });

  it('hands over a value with no scheme rather than guessing one', () => {
    // Five values in the whole set have no scheme, and one of them is an email
    // address. Prefixing `https://` here would manufacture a URL the source
    // never gave, and hide a data-quality signal J1-06 needs.
    expect(get('Mairie - Bajus').urls).toEqual(['www.bajus.fr']);
  });

  it('hands over an email address sitting in the website field', () => {
    // Observed in the real data, and deliberately not committed as a fixture:
    // it was a personal address, which CLAUDE.md §7 keeps out of this
    // repository. The value below is synthetic, the case is not.
    const [record] = parseAnnuaireRecords([
      {
        id: '00000000-0000-4000-8000-000000000000',
        nom: 'Mairie - Test',
        code_insee_commune: '01004',
        site_internet: '[{"libelle": "", "valeur": "mairie@example.invalid"}]',
        pivot: '[{"type_service_local": "mairie", "code_insee_commune": ["01004"]}]',
        statut_de_diffusion: 'true',
        date_modification_datetime: '2026-08-06T10:00:00+00:00',
      },
    ]);

    // Not a parse error: the source is entitled to be wrong, and the state
    // machine of J1-06 needs to see that it was in order to say so.
    expect(record?.urls).toEqual(['mairie@example.invalid']);
  });

  it('reports the codes of a town hall serving several communes', () => {
    const record = get('Mairie déléguée - Coudreceau');

    expect(record.pivots).toHaveLength(1);
    expect(record.pivots[0]?.codesInsee.length).toBeGreaterThan(1);
  });

  it('keeps a top-level code that disagrees with the pivot instead of picking a winner', () => {
    // 13 records disagree with themselves this way, the top-level code naming
    // the merged-away commune. Neither field is authoritative on its own.
    const record = get('Mairie déléguée - Magny-le-Freule');

    expect(record.codeInsee).toBe('14387');
    expect(record.pivots[0]?.codesInsee).toEqual(['14431']);
  });

  it('dates the record', () => {
    expect(get('Mairie - Curgy').modifiedAt).toBeInstanceOf(Date);
  });

  it('reports a published record as published', () => {
    expect(page.records.every((record) => record.published)).toBe(true);
  });
});

describe('isMairie', () => {
  it('accepts a town hall', () => {
    expect(isMairie(get('Mairie - Curgy'))).toBe(true);
  });

  it('accepts an annexe, which is still a mairie pivot', () => {
    expect(isMairie(get('Mairie annexe - Sainte-Croix-Grand-Tonne'))).toBe(true);
  });

  it('looks past the first pivot when a record declares two roles', () => {
    // The one record out of 35 803 that does. Saint-Barthélemy's territorial
    // council is a `cg` first and a `mairie` second: reading `pivots[0]` alone
    // drops the commune from the perimeter, and only that one.
    const both = get('Conseil territorial de Saint-Barthélemy');

    expect(both.pivots.map((pivot) => pivot.typeServiceLocal)).toEqual(['cg', 'mairie']);
    expect(isMairie(both)).toBe(true);
  });

  it('rejects a record that declares no mairie role at all', () => {
    expect(
      isMairie({
        id: '00000000-0000-4000-8000-000000000000',
        nom: 'Conseil départemental',
        codeInsee: null,
        pivots: [{ typeServiceLocal: 'cg', codesInsee: [] }],
        urls: [],
        published: true,
        modifiedAt: null,
      }),
    ).toBe(false);
  });
});

describe('parseAnnuaireRecords, on the bare array /exports/json returns', () => {
  it('reads the second endpoint, which ships no envelope at all', () => {
    expect(parseAnnuaireRecords(exported)).toHaveLength(10);
  });

  it('yields the same records as /records for the same ids', () => {
    // The two endpoints are separate code paths upstream. Pinning them against
    // each other is what would catch one of them drifting alone.
    expect(parseAnnuaireRecords(exported)).toEqual([...page.records]);
  });
});

describe('payloads the parsers must refuse', () => {
  const valid = {
    id: '00000000-0000-4000-8000-000000000000',
    nom: 'Mairie - Test',
    code_insee_commune: '01004',
    site_internet: null,
    pivot: '[{"type_service_local": "mairie", "code_insee_commune": ["01004"]}]',
    statut_de_diffusion: 'true',
    date_modification_datetime: '2026-08-06T10:00:00+00:00',
  };

  it('accepts the reference record, so the refusals below mean something', () => {
    expect(parseAnnuaireRecords([valid])).toHaveLength(1);
  });

  it('refuses a structured field whose string is not JSON', () => {
    // The failure this catches is upstream changing the encoding — the day
    // `site_internet` becomes a plain URL, this test says so.
    expect(() => parseAnnuaireRecords([{ ...valid, pivot: 'mairie' }])).toThrow(
      /JSON encoded inside a string/,
    );
  });

  it('never echoes the offending value into the error message', () => {
    // Third-party content, and this message reaches the logs (CLAUDE.md §7).
    try {
      parseAnnuaireRecords([{ ...valid, site_internet: 'secret-looking-garbage' }]);
      expect.unreachable('the parser should have thrown');
    } catch (error) {
      expect((error as Error).message).not.toContain('secret-looking-garbage');
    }
  });

  it('refuses a JSON array whose entries have the wrong shape', () => {
    expect(() =>
      parseAnnuaireRecords([{ ...valid, site_internet: '[{"url": "https://x.fr"}]' }]),
    ).toThrow(SourceParseError);
  });

  it('refuses an id that is not a UUID', () => {
    expect(() => parseAnnuaireRecords([{ ...valid, id: '42' }])).toThrow(SourceParseError);
  });

  it('refuses an INSEE code the referential could never contain', () => {
    expect(() => parseAnnuaireRecords([{ ...valid, code_insee_commune: '1004' }])).toThrow(
      SourceParseError,
    );
  });

  it('treats a missing top-level code as null rather than failing the batch', () => {
    const [record] = parseAnnuaireRecords([{ ...valid, code_insee_commune: null }]);

    expect(record?.codeInsee).toBeNull();
    expect(record?.pivots[0]?.codesInsee).toEqual(['01004']);
  });

  it('refuses an envelope missing its count', () => {
    expect(() => parseAnnuairePage({ results: [] })).toThrow(SourceParseError);
  });
});

describe('mairiesRequestUrl', () => {
  it('requests only the fields the schema declares', () => {
    const url = new URL(mairiesRequestUrl({ limit: 100, offset: 200 }));

    expect(url.searchParams.get('select')).toBe(
      'id,nom,code_insee_commune,site_internet,pivot,statut_de_diffusion,date_modification_datetime',
    );
    expect(url.searchParams.get('where')).toBe('pivot like "mairie"');
    expect(url.searchParams.get('limit')).toBe('100');
    expect(url.searchParams.get('offset')).toBe('200');
  });

  it('asks for no field that carries personal data', () => {
    // CLAUDE.md §7: no agent name, no contact email. The records hold
    // `adresse_courriel`, `telephone` and `affectation_personne`; the surest
    // way not to store them is never to ask for them.
    const select = new URL(mairiesRequestUrl({ limit: 1 })).searchParams.get('select') ?? '';

    for (const forbidden of ['courriel', 'telephone', 'affectation', 'adresse']) {
      expect(select).not.toContain(forbidden);
    }
  });

  it('omits the offset when there is none', () => {
    expect(new URL(mairiesRequestUrl({ limit: 1 })).searchParams.has('offset')).toBe(false);
  });
});
