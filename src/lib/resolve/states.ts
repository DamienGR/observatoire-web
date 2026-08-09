import { STATUTS_RESOLUTION, type StatutResolution } from '../../db/schema.js';

/**
 * The URL resolution state machine (docs/brief.md §4, CLAUDE.md §8).
 *
 * The brief models resolution as a process — `candidat → verifie → invalide →
 * a_revoir` — rather than as a column, for a reason it also measures: 138
 * communes of the perimeter carry several candidate URLs, and a rejection has
 * to leave a trace. A column would hold the last answer; a process holds *how*
 * a URL got there, and who is allowed to move it.
 *
 * Everything here is pure. The states come from the schema rather than being
 * restated, so a state added to the column without teaching the machine about
 * it fails a test instead of quietly becoming unreachable.
 */

export type { StatutResolution };

/**
 * Who is moving the URL.
 *
 * The distinction is the load-bearing part of this module. A scan sees one
 * fetch; an operator sees the site. Two rules follow, and both exist because
 * the alternative was tried in other projects and rots: a scan can never
 * resurrect a URL somebody invalidated, and a scan can never take a URL out of
 * `a_revoir`. Without them the weekly re-ingestion silently undoes every human
 * decision, and the review queue empties itself before anyone reads it.
 */
export type ResolutionActor = 'scan' | 'operator';

/**
 * Why a URL moved. Stable codes, never prose: they are grouped on in the ops
 * surface (milestone 2) the same way `measurement.error_code` is, and a message
 * that reads well is a message someone will rewrite.
 */
export const RESOLUTION_REASONS = [
  // Decided before any packet moves — src/lib/resolve/attempt.ts.
  'missing-scheme',
  'malformed-url',
  'forbidden-scheme',
  'embedded-credentials',
  'blocked-address',
  'unsafe-url',
  // Decided from one observation — src/lib/resolve/verdict.ts.
  'reachable',
  'not-found',
  'forbidden-by-site',
  'unexpected-status',
  'redirect-without-location',
  'redirect-loop',
  'response-too-large',
  'rate-limited',
  'server-error',
  'timeout',
  'network-error',
  'attempts-exhausted',
  // Decided across the candidates of one commune — src/lib/resolve/arbitrate.ts.
  'same-site-as-elected',
  'several-verified',
  // Decided by a human, through the ops surface.
  'operator-decision',
] as const;

export type ResolutionReason = (typeof RESOLUTION_REASONS)[number];

/** The part of a `site` row this machine reads and writes. */
export interface ResolutionState {
  readonly statut: StatutResolution;
  readonly verifiedAt: Date | null;
}

export interface Transition {
  readonly to: StatutResolution;
  readonly reason: ResolutionReason;
  readonly actor: ResolutionActor;
  /** When the decision was taken, in UTC (CLAUDE.md §4). */
  readonly at: Date;
}

export class IllegalTransitionError extends Error {
  override readonly name = 'IllegalTransitionError';
  readonly from: StatutResolution;
  readonly to: StatutResolution;
  readonly actor: ResolutionActor;

  constructor(from: StatutResolution, to: StatutResolution, actor: ResolutionActor) {
    super(`A ${actor} may not move a site from ${from} to ${to}.`);
    this.from = from;
    this.to = to;
    this.actor = actor;
  }
}

/**
 * The edges of the machine, each declaring the **minimum authority** it needs.
 *
 * Read it as a specification rather than as configuration: the empty row is the
 * point of the table. `a_revoir` has no automatic exit, so the only way out of
 * the review queue is a human — which is what makes the state mean "somebody
 * has to look at this" rather than "the last fetch was odd".
 *
 * `invalide → verifie` is absent on purpose, for the operator too: `verifie`
 * asserts that the URL answered, and only a measurement can assert that. An
 * operator who knows better puts the URL back in the queue and lets the scan
 * confirm it.
 */
const TRANSITIONS: Readonly<
  Record<StatutResolution, Partial<Record<StatutResolution, ResolutionActor>>>
> = {
  candidat: {
    verifie: 'scan',
    invalide: 'scan',
    a_revoir: 'scan',
  },
  verifie: {
    invalide: 'scan',
    a_revoir: 'scan',
    // Back to the queue: an operator can ask for a re-verification, a scan
    // cannot demote a site it just measured.
    candidat: 'operator',
  },
  invalide: {
    candidat: 'operator',
    a_revoir: 'operator',
  },
  a_revoir: {
    candidat: 'operator',
    verifie: 'operator',
    invalide: 'operator',
  },
};

/** An operator may take any edge; a scan only the ones marked as its own. */
function hasAuthority(required: ResolutionActor, actor: ResolutionActor): boolean {
  return required === 'scan' || actor === 'operator';
}

/**
 * The states `actor` can move a site to from `from`, in table order.
 *
 * The state already held is deliberately absent: staying put is not a move, and
 * listing it would make every state look reachable from every state.
 */
export function allowedTransitions(
  from: StatutResolution,
  actor: ResolutionActor,
): StatutResolution[] {
  const edges = TRANSITIONS[from];

  return STATUTS_RESOLUTION.filter((to) => {
    const required = edges[to];
    return required !== undefined && hasAuthority(required, actor);
  });
}

/**
 * Whether the move is legal. A move to the state already held always is: a
 * replayed run must not fail (CLAUDE.md §8).
 */
export function canTransition(
  from: StatutResolution,
  to: StatutResolution,
  actor: ResolutionActor,
): boolean {
  if (from === to) return true;

  const required = TRANSITIONS[from][to];

  return required !== undefined && hasAuthority(required, actor);
}

/**
 * Applies a transition, or refuses it.
 *
 * Throws rather than returning a verdict: an illegal move is a bug in the
 * caller — it computed a target the machine never offered — and a job that
 * swallows it would write a state nobody can explain. The message names the two
 * states and the actor, and carries no URL: this module never sees one.
 *
 * `verifiedAt` follows one rule: it is the date the URL last answered. Entering
 * (or staying in) `verifie` sets it; leaving `verifie` keeps it. An invalidated
 * row therefore still says when it last worked, which is the first thing an
 * operator needs in order to tell a site that moved from a site that died.
 */
export function applyTransition(state: ResolutionState, transition: Transition): ResolutionState {
  if (!canTransition(state.statut, transition.to, transition.actor)) {
    throw new IllegalTransitionError(state.statut, transition.to, transition.actor);
  }

  if (transition.to === 'verifie') {
    return { statut: 'verifie', verifiedAt: transition.at };
  }

  return { statut: transition.to, verifiedAt: state.verifiedAt };
}
