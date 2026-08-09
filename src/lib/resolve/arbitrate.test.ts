import { describe, expect, it } from 'vitest';
import { arbitrateCommune, type CandidateState } from './arbitrate.js';
import { canTransition } from './states.js';

/**
 * Written before `arbitrate.ts`. This is the file the brief points at: 138
 * communes of the perimeter carry several candidate URLs, and *that* queue —
 * not the dead links — is what justifies modelling resolution as a process
 * (docs/brief.md §4).
 */

function candidate(overrides: Partial<CandidateState> & { url: string }): CandidateState {
  return { statut: 'candidat', resolvedUrl: null, ...overrides };
}

function verified(url: string, resolvedUrl: string = url): CandidateState {
  return { url, statut: 'verifie', resolvedUrl };
}

describe('arbitrateCommune', () => {
  it('elects the only URL that answered', () => {
    expect(arbitrateCommune([verified('https://www.curgy.fr/')])).toEqual({
      elected: 'https://www.curgy.fr/',
      dispositions: [],
    });
  });

  it('elects nothing, and moves nothing, while no URL has answered', () => {
    // The commune is simply not resolved yet. Inventing an election here would
    // let the scanner measure a URL nobody has seen answer.
    expect(
      arbitrateCommune([
        candidate({ url: 'https://a.fr/' }),
        candidate({ url: 'https://b.fr/', statut: 'a_revoir' }),
      ]),
    ).toEqual({ elected: null, dispositions: [] });
  });

  it('closes a deep link into the elected site instead of measuring it too', () => {
    // Conlie's pair, verbatim from the directory. The booking page is not a
    // second site; measuring it would publish a second score for one commune,
    // and dropping it silently at ingestion time would leave no trace of why.
    expect(
      arbitrateCommune([
        verified('https://www.conlie.fr/'),
        candidate({ url: 'https://www.conlie.fr/vie-pratique/mes-demarches/rdv-en-ligne/' }),
      ]),
    ).toEqual({
      elected: 'https://www.conlie.fr/',
      dispositions: [
        {
          url: 'https://www.conlie.fr/vie-pratique/mes-demarches/rdv-en-ligne/',
          to: 'invalide',
          reason: 'same-site-as-elected',
        },
      ],
    });
  });

  it('closes the aliases that landed on the elected site', () => {
    // Saint-Malo's three, as the directory gives them. Their hosts differ; what
    // they resolve to does not. Comparing the requested URLs would have called
    // this a three-way conflict and sent a human three identical sites.
    expect(
      arbitrateCommune([
        verified('https://www.ville-saint-malo.fr', 'https://www.saint-malo.fr/'),
        verified('https://saint-malo.fr', 'https://www.saint-malo.fr/'),
        verified('https://www.saint-malo.fr', 'https://www.saint-malo.fr/'),
      ]),
    ).toEqual({
      elected: 'https://www.ville-saint-malo.fr',
      dispositions: [
        {
          url: 'https://saint-malo.fr',
          to: 'invalide',
          reason: 'same-site-as-elected',
        },
        {
          url: 'https://www.saint-malo.fr',
          to: 'invalide',
          reason: 'same-site-as-elected',
        },
      ],
    });
  });

  it('asks a human when a commune really has two sites that both answer', () => {
    // Two distinct hosts, both alive: which one is *the* municipal site is not
    // a question a status code can settle, and picking by ranking would publish
    // a guess. This is what `a_revoir` is for.
    expect(
      arbitrateCommune([verified('https://www.ville-x.fr/'), verified('https://www.mairie-x.fr/')]),
    ).toEqual({
      elected: 'https://www.ville-x.fr/',
      dispositions: [
        {
          url: 'https://www.mairie-x.fr/',
          to: 'a_revoir',
          reason: 'several-verified',
        },
      ],
    });
  });

  it('elects the homepage over a deep link that answered first', () => {
    // Order of arrival is not evidence: both answered, and the homepage is what
    // the observatory measures.
    expect(
      arbitrateCommune([
        verified('https://www.x.fr/vie-pratique/demarches/'),
        verified('https://www.x.fr/'),
      ]).elected,
    ).toBe('https://www.x.fr/');
  });

  it('leaves a candidate on another host to be attempted', () => {
    // It may turn out to be an alias, a dead link, or a second site — nothing
    // is known yet, and closing it now would decide by ranking what only a
    // fetch can decide.
    expect(
      arbitrateCommune([verified('https://www.x.fr/'), candidate({ url: 'https://www.y.fr/' })]),
    ).toEqual({ elected: 'https://www.x.fr/', dispositions: [] });
  });

  it('never reopens what has already been settled', () => {
    // An invalidated URL stays invalidated and a URL in review stays in review:
    // arbitration is a scan, and a scan does not undo decisions (states.ts).
    expect(
      arbitrateCommune([
        verified('https://www.x.fr/'),
        candidate({ url: 'https://www.x.fr/demarches', statut: 'invalide' }),
        candidate({ url: 'https://www.x.fr/actualites', statut: 'a_revoir' }),
      ]).dispositions,
    ).toEqual([]);
  });

  it('only ever proposes moves a scan is allowed to make', () => {
    // The guard against the two modules drifting apart: arbitration writes
    // through `applyTransition`, so a disposition the table refuses would
    // throw in production and be found by nobody until then.
    const { dispositions } = arbitrateCommune([
      verified('https://www.x.fr/'),
      verified('https://www.y.fr/'),
      candidate({ url: 'https://www.x.fr/demarches' }),
    ]);

    expect(dispositions).not.toEqual([]);
    for (const disposition of dispositions) {
      expect(canTransition('candidat', disposition.to, 'scan')).toBe(true);
      expect(canTransition('verifie', disposition.to, 'scan')).toBe(true);
    }
  });

  it('arbitrates a commune with no candidate at all', () => {
    // 15 communes of the perimeter are in this case, and they go through the
    // same code path as the others rather than being special-cased upstream.
    expect(arbitrateCommune([])).toEqual({ elected: null, dispositions: [] });
  });

  it('reports its dispositions in the order the candidates were given', () => {
    // The writer downstream applies them in that order; two runs on the same
    // data then produce the same statements, which is what makes an interrupted
    // run comparable with a complete one (same reasoning as selectPerimeter).
    expect(
      arbitrateCommune([
        candidate({ url: 'https://www.x.fr/b' }),
        verified('https://www.x.fr/'),
        candidate({ url: 'https://www.x.fr/a' }),
      ]).dispositions.map((disposition) => disposition.url),
    ).toEqual(['https://www.x.fr/b', 'https://www.x.fr/a']);
  });
});
