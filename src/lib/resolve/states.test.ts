import { describe, expect, it } from 'vitest';
import { STATUTS_RESOLUTION } from '../../db/schema.js';
import {
  IllegalTransitionError,
  allowedTransitions,
  applyTransition,
  canTransition,
  type ResolutionState,
} from './states.js';

/**
 * Written before `states.ts` (CLAUDE.md §5, TDD strict on `src/lib/`). What is
 * specified here is not "the code works" but *what the machine is allowed to
 * do* — and above all what it is not allowed to do without a human.
 */

const AT = new Date('2026-08-09T10:00:00.000Z');
const LATER = new Date('2026-08-16T10:00:00.000Z');

function state(statut: ResolutionState['statut'], verifiedAt: Date | null = null): ResolutionState {
  return { statut, verifiedAt };
}

describe('the transition table', () => {
  it('knows every state the schema declares', () => {
    // The states are the schema's (docs/brief.md §4) and the machine imports
    // them rather than restating them. This is what fails if a sixth state is
    // ever added to the column without teaching the machine about it.
    for (const statut of STATUTS_RESOLUTION) {
      expect(() => allowedTransitions(statut, 'operator')).not.toThrow();
    }
  });

  it('only ever proposes states the schema accepts', () => {
    for (const statut of STATUTS_RESOLUTION) {
      for (const target of allowedTransitions(statut, 'operator')) {
        expect(STATUTS_RESOLUTION).toContain(target);
      }
    }
  });
});

describe('what a scan may decide on its own', () => {
  it('verifies, invalidates or queues a candidate for review', () => {
    expect(allowedTransitions('candidat', 'scan').toSorted()).toEqual([
      'a_revoir',
      'invalide',
      'verifie',
    ]);
  });

  it('invalidates or queues a site that used to answer', () => {
    // A verified site that dies is an ordinary observation; a verified site
    // that starts redirecting elsewhere is a question for a human.
    expect(allowedTransitions('verifie', 'scan').toSorted()).toEqual(['a_revoir', 'invalide']);
  });

  it('never resurrects an invalidated URL', () => {
    // Otherwise re-ingesting the directory each week undoes every rejection the
    // week before, and the state column becomes a very expensive cache of the
    // last fetch. Rehabilitation is an operator decision.
    expect(canTransition('invalide', 'candidat', 'scan')).toBe(false);
    expect(canTransition('invalide', 'candidat', 'operator')).toBe(true);
  });

  it('never empties the review queue by itself', () => {
    // `a_revoir` means "a human has to look at this". A machine allowed out of
    // it would clear the queue before anyone read it, and the state would stop
    // meaning anything. This is the rule that makes the fourth state useful.
    expect(allowedTransitions('a_revoir', 'scan')).toEqual([]);
  });
});

describe('what only an operator may decide', () => {
  it('lets a human take a site out of review, in any direction', () => {
    expect(allowedTransitions('a_revoir', 'operator').toSorted()).toEqual([
      'candidat',
      'invalide',
      'verifie',
    ]);
  });

  it('lets a human put a verified site back in the queue', () => {
    expect(canTransition('verifie', 'candidat', 'scan')).toBe(false);
    expect(canTransition('verifie', 'candidat', 'operator')).toBe(true);
  });

  it('refuses to promote an invalidated URL straight to verified', () => {
    // Not even for an operator: `verifie` asserts that the URL answered, and
    // the only thing that can assert it is a measurement. A human who knows
    // better puts the URL back in the queue, and the scan confirms it.
    expect(canTransition('invalide', 'verifie', 'operator')).toBe(false);
  });
});

describe('applyTransition', () => {
  it('records the date the URL was verified', () => {
    expect(
      applyTransition(state('candidat'), {
        to: 'verifie',
        reason: 'reachable',
        actor: 'scan',
        at: AT,
      }),
    ).toEqual({ statut: 'verifie', verifiedAt: AT });
  });

  it('keeps the verification date when the site stops answering', () => {
    // `verified_at` records something that happened; the status records what is
    // true now. Clearing the date on invalidation would erase the only trace of
    // when the URL last worked, which is what an operator reads before deciding
    // whether the site moved or died.
    expect(
      applyTransition(state('verifie', AT), {
        to: 'invalide',
        reason: 'not-found',
        actor: 'scan',
        at: LATER,
      }),
    ).toEqual({ statut: 'invalide', verifiedAt: AT });
  });

  it('refreshes the verification date when a verified site is measured again', () => {
    expect(
      applyTransition(state('verifie', AT), {
        to: 'verifie',
        reason: 'reachable',
        actor: 'scan',
        at: LATER,
      }),
    ).toEqual({ statut: 'verifie', verifiedAt: LATER });
  });

  it('accepts a transition to the state already held, and changes nothing else', () => {
    // Idempotence (CLAUDE.md §8): replaying a run must not corrupt anything.
    // A scan that re-decides `invalide` on an already invalid URL is a replay,
    // not an illegal move.
    const before = state('invalide', AT);

    expect(
      applyTransition(before, {
        to: 'invalide',
        reason: 'not-found',
        actor: 'scan',
        at: LATER,
      }),
    ).toEqual(before);
  });

  it('refuses a transition the table does not carry', () => {
    expect(() =>
      applyTransition(state('invalide'), {
        to: 'verifie',
        reason: 'operator-decision',
        actor: 'operator',
        at: AT,
      }),
    ).toThrow(IllegalTransitionError);
  });

  it('refuses a transition the actor has no authority for', () => {
    expect(() =>
      applyTransition(state('a_revoir'), {
        to: 'verifie',
        reason: 'operator-decision',
        actor: 'scan',
        at: AT,
      }),
    ).toThrow(IllegalTransitionError);
  });

  it('names both states and the actor when it refuses', () => {
    // The message is read in a job log. It carries no URL on purpose: this
    // module never sees one, and a state machine is not where a URL should
    // leak into a message someone will paste somewhere.
    const refuse = (): unknown =>
      applyTransition(state('a_revoir'), {
        to: 'invalide',
        reason: 'operator-decision',
        actor: 'scan',
        at: AT,
      });

    expect(refuse).toThrow(/a_revoir/);
    expect(refuse).toThrow(/invalide/);
    expect(refuse).toThrow(/scan/);
  });

  it('leaves the state it was given untouched', () => {
    const before = state('candidat');
    applyTransition(before, { to: 'verifie', reason: 'reachable', actor: 'scan', at: AT });

    expect(before).toEqual({ statut: 'candidat', verifiedAt: null });
  });
});
