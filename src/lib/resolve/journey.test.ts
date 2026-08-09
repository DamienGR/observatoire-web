import { describe, expect, it } from 'vitest';
import {
  applyTransition,
  arbitrateCommune,
  canTransition,
  judgeObservation,
  planAttempt,
  rankCandidates,
  type ResolutionState,
} from './index.js';

/**
 * The four stages, composed — a candidate URL walked from the directory to a
 * settled state, with nothing fetched.
 *
 * The unit files above specify each rule in isolation; this one specifies that
 * they fit together, which is the part a future session would otherwise have to
 * rediscover by reading four modules. Every URL below comes from the frozen
 * capture of the directory.
 */

const CANDIDATE: ResolutionState = { statut: 'candidat', verifiedAt: null };
const FIRST_ATTEMPT = { attempts: 0 };
const AT = new Date('2026-08-09T10:00:00.000Z');

describe('a commune with a homepage and a booking page', () => {
  const candidates = [
    'https://www.conlie.fr/vie-pratique/mes-demarches/rdv-en-ligne/',
    'https://www.conlie.fr/',
  ];

  it('tries the homepage, verifies it, and closes the other without fetching it', () => {
    const [first] = rankCandidates(candidates);
    expect(first).toBe('https://www.conlie.fr/');

    const plan = planAttempt(first!);
    expect(plan).toMatchObject({ kind: 'attempt', insecure: false });

    const verdict = judgeObservation(
      { kind: 'response', requestedUrl: first!, finalUrl: first!, status: 200 },
      FIRST_ATTEMPT,
    );
    expect(verdict).toMatchObject({ decision: 'transition', to: 'verifie' });

    const settled = applyTransition(CANDIDATE, {
      to: 'verifie',
      reason: 'reachable',
      actor: 'scan',
      at: AT,
    });
    expect(settled).toEqual({ statut: 'verifie', verifiedAt: AT });

    // One fetch was enough for two rows: the second candidate is closed by
    // arbitration, and the trace says why.
    expect(
      arbitrateCommune([
        { url: 'https://www.conlie.fr/', statut: 'verifie', resolvedUrl: 'https://www.conlie.fr/' },
        {
          url: 'https://www.conlie.fr/vie-pratique/mes-demarches/rdv-en-ligne/',
          statut: 'candidat',
          resolvedUrl: null,
        },
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
});

describe('a commune whose directory entry lost its scheme', () => {
  it('reaches a human without ever being fetched, and stays there', () => {
    // `www.bajus.fr`. The value cannot be requested, repairing it would invent
    // a URL, so it goes to the review queue — and no scan can take it back out.
    const plan = planAttempt('www.bajus.fr');
    expect(plan).toEqual({ kind: 'reject', statut: 'a_revoir', reason: 'missing-scheme' });

    const queued = applyTransition(CANDIDATE, {
      to: 'a_revoir',
      reason: 'missing-scheme',
      actor: 'scan',
      at: AT,
    });

    expect(queued.statut).toBe('a_revoir');
    expect(canTransition('a_revoir', 'verifie', 'scan')).toBe(false);
    expect(canTransition('a_revoir', 'verifie', 'operator')).toBe(true);
  });
});

describe('a site that does not answer', () => {
  it('is retried, then queued for review rather than declared non-existent', () => {
    const observation = {
      kind: 'failure',
      requestedUrl: 'https://www.example-commune.fr/',
      failure: 'timeout',
    } as const;

    expect(judgeObservation(observation, { attempts: 0 })).toMatchObject({ decision: 'retry' });
    expect(judgeObservation(observation, { attempts: 1 })).toMatchObject({ decision: 'retry' });
    expect(judgeObservation(observation, { attempts: 2 })).toMatchObject({ decision: 'retry' });
    expect(judgeObservation(observation, { attempts: 3 })).toMatchObject({
      to: 'a_revoir',
      reason: 'attempts-exhausted',
    });
  });
});

describe('a site that used to answer and now returns 404', () => {
  it('is invalidated while keeping the date it last worked', () => {
    const wasVerified: ResolutionState = { statut: 'verifie', verifiedAt: AT };
    const verdict = judgeObservation(
      {
        kind: 'response',
        requestedUrl: 'https://www.example-commune.fr/',
        finalUrl: 'https://www.example-commune.fr/',
        status: 404,
      },
      FIRST_ATTEMPT,
    );

    expect(verdict).toMatchObject({ to: 'invalide', reason: 'not-found' });

    const later = new Date('2026-09-01T10:00:00.000Z');
    expect(
      applyTransition(wasVerified, {
        to: 'invalide',
        reason: 'not-found',
        actor: 'scan',
        at: later,
      }),
    ).toEqual({ statut: 'invalide', verifiedAt: AT });
  });
});

describe('a directory entry pointing inside the network', () => {
  it('is refused before anything is requested', () => {
    // The SSRF guard (§7) runs at two moments for two reasons: here, on a
    // string, so the request is never made; and inside the client, on every
    // redirect hop, so a public URL cannot walk us inwards.
    expect(planAttempt('https://169.254.169.254/latest/meta-data/')).toEqual({
      kind: 'reject',
      statut: 'invalide',
      reason: 'blocked-address',
    });
  });
});
