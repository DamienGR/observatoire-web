import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseAnnuairePage, type AnnuaireRecord } from '../sources/annuaire.js';
import { candidatesFor, indexMairiesByCommune } from './candidates.js';

/**
 * Written before `candidates.ts`. The cases come from the frozen capture of the
 * DILA directory (tests/fixtures/README.md) rather than from imagination: each
 * fixture record is there because something was *measured* about it across the
 * 35 803 town-hall records.
 */
const FIXTURE = fileURLToPath(
  new URL('../../../tests/fixtures/annuaire/mairies.json', import.meta.url),
);

const records = parseAnnuairePage(JSON.parse(readFileSync(FIXTURE, 'utf8'))).records;
const index = indexMairiesByCommune(records);

function record(overrides: Partial<AnnuaireRecord> & { id: string }): AnnuaireRecord {
  return {
    nom: 'Mairie - Test',
    codeInsee: '01004',
    pivots: [{ typeServiceLocal: 'mairie', codesInsee: ['01004'] }],
    urls: ['https://example.gouv.fr/'],
    published: true,
    modifiedAt: null,
    ...overrides,
  };
}

describe('indexMairiesByCommune, on the frozen capture', () => {
  it('indexes an ordinary town hall under its commune', () => {
    expect(index.get('71162')?.map((entry) => entry.nom)).toEqual(['Mairie - Curgy']);
  });

  it('indexes a town hall under every commune its pivot serves', () => {
    // `Mairie déléguée - Coudreceau` serves 28112 and 28236. Indexing it under
    // the first code only would leave the second commune with no candidate at
    // all, and nothing would ever say why.
    expect(index.get('28112')?.map((entry) => entry.nom)).toEqual(['Mairie déléguée - Coudreceau']);
    expect(index.get('28236')?.map((entry) => entry.nom)).toEqual(['Mairie déléguée - Coudreceau']);
  });

  it('indexes a record under both codes when they disagree', () => {
    // `Mairie déléguée - Magny-le-Freule` carries 14387 at top level and 14431
    // in its pivot. 13 records are in this case, and neither code is
    // authoritative: cross-checked against the referential, the pivot wins 733
    // times and the top level 3. Indexing both is what refuses to pick a winner
    // here — the resolution state machine (J1-06) decides, not the indexer.
    expect(index.get('14387')?.map((entry) => entry.nom)).toEqual([
      'Mairie déléguée - Magny-le-Freule',
    ]);
    expect(index.get('14431')?.map((entry) => entry.nom)).toEqual([
      'Mairie déléguée - Magny-le-Freule',
    ]);
  });

  it('indexes a record declaring several roles, as long as one of them is mairie', () => {
    // The Conseil territorial de Saint-Barthélemy is a `cg` *and* a `mairie`,
    // in that order. One record out of 35 803, and reading only the first pivot
    // drops the commune from the perimeter silently.
    expect(index.get('97701')?.map((entry) => entry.nom)).toEqual([
      'Conseil territorial de Saint-Barthélemy',
    ]);
  });

  it('ignores a record that is not a town hall', () => {
    const other = indexMairiesByCommune([
      record({ id: 'a', pivots: [{ typeServiceLocal: 'cg', codesInsee: ['01004'] }] }),
    ]);

    expect(other.size).toBe(0);
  });

  it('ignores a record the directory marks as not published', () => {
    // `statut_de_diffusion` is `"true"` on all 35 803 records seen, so this
    // costs nothing today. It exists because the field is there to mark an
    // exception, and republishing what the source withdrew is the kind of
    // mistake that is only noticed by the commune it concerns.
    expect(indexMairiesByCommune([record({ id: 'a', published: false })]).size).toBe(0);
  });

  it('ignores the codes of a non-mairie pivot on a record that also has one', () => {
    // A record serving as `cg` for one commune and as `mairie` for another
    // belongs to the second only. Otherwise a commune inherits the website of
    // an administration that is not its town hall.
    const mixed = indexMairiesByCommune([
      record({
        id: 'a',
        codeInsee: null,
        pivots: [
          { typeServiceLocal: 'cg', codesInsee: ['97101'] },
          { typeServiceLocal: 'mairie', codesInsee: ['97701'] },
        ],
      }),
    ]);

    expect([...mixed.keys()]).toEqual(['97701']);
  });

  it('keeps a record carrying no INSEE code out of the index rather than under a blank key', () => {
    const orphan = indexMairiesByCommune([
      record({
        id: 'a',
        codeInsee: null,
        pivots: [{ typeServiceLocal: 'mairie', codesInsee: [] }],
      }),
    ]);

    expect(orphan.size).toBe(0);
  });

  it('groups several town halls under the same commune, in source order', () => {
    const several = indexMairiesByCommune([
      record({ id: 'a', nom: 'Mairie - X' }),
      record({ id: 'b', nom: 'Mairie annexe - X' }),
    ]);

    expect(several.get('01004')?.map((entry) => entry.nom)).toEqual([
      'Mairie - X',
      'Mairie annexe - X',
    ]);
  });
});

describe('candidatesFor', () => {
  it('proposes the single URL of an ordinary town hall', () => {
    expect(candidatesFor('71162', index)).toEqual([
      { communeId: '71162', url: 'https://www.curgy.fr/', source: 'annuaire' },
    ]);
  });

  it('proposes every URL a record carries, in source order', () => {
    // Saint-Malo carries three. Which one is the site is not decided here:
    // ingestion records candidates, the state machine of J1-06 judges them.
    expect(candidatesFor('35288', index).map((candidate) => candidate.url)).toEqual([
      'https://www.ville-saint-malo.fr',
      'https://saint-malo.fr',
      'https://www.saint-malo.fr',
    ]);
  });

  it('proposes a deep link as-is, without deciding it is not a homepage', () => {
    // 138 communes of the perimeter carry more than one candidate, and the
    // second is very often a "mes démarches" page. Dropping it here would be a
    // judgement, and a judgement made in the wrong module: it belongs to the
    // resolution states, where a rejection leaves a trace.
    expect(candidatesFor('72089', index).map((candidate) => candidate.url)).toEqual([
      'https://www.conlie.fr/',
      'https://www.conlie.fr/vie-pratique/mes-demarches/rdv-en-ligne/',
    ]);
  });

  it('proposes a value with no scheme, unjudged', () => {
    // `www.bajus.fr`. Five records are in this case. The parser refuses to
    // repair it and so does this: a URL nobody can fetch is a fact about the
    // directory, and `statut_resolution` is where that fact gets recorded.
    expect(candidatesFor('62077', index).map((candidate) => candidate.url)).toEqual([
      'www.bajus.fr',
    ]);
  });

  it('proposes an http URL without upgrading it', () => {
    // 154 of the 1 224 candidates of the perimeter are http. Rewriting them to
    // https would fabricate a URL the directory never gave.
    expect(candidatesFor('16025', index).map((candidate) => candidate.url)).toEqual([
      'http://www.baignes-sainte-radegonde.fr',
    ]);
  });

  it('proposes nothing for a commune whose town hall declares no website', () => {
    // 13 656 records are in this case, 13 of them inside the v1 perimeter.
    expect(candidatesFor('55128', index)).toEqual([]);
  });

  it('proposes nothing for a commune the directory does not cover', () => {
    // Two communes of the perimeter have no town-hall record at all: 49126
    // (Orée d'Anjou) and 98747 (Taiarapu-Est).
    expect(candidatesFor('49126', index)).toEqual([]);
  });

  it('proposes the same URL once when two records repeat it', () => {
    // 57 exact duplicates across the perimeter, mostly a town hall and its
    // annexe pointing at the same site. The unique index on
    // (commune_id, url) would collapse them at write time anyway; collapsing
    // them here is what makes the planned count match the written count.
    const duplicated = indexMairiesByCommune([
      record({ id: 'a', urls: ['https://x.fr/', 'https://y.fr/'] }),
      record({ id: 'b', urls: ['https://x.fr/'] }),
    ]);

    expect(candidatesFor('01004', duplicated).map((candidate) => candidate.url)).toEqual([
      'https://x.fr/',
      'https://y.fr/',
    ]);
  });

  it('records the directory as the source of every candidate', () => {
    // `annuaire`, never `heuristique` or `manuel`: where a URL came from is
    // what makes a wrong one diagnosable later.
    expect(
      candidatesFor('35288', index).every((candidate) => candidate.source === 'annuaire'),
    ).toBe(true);
  });
});
