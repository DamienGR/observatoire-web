/**
 * URL resolution as a process (docs/brief.md §4, J1-06).
 *
 * The directory's URL field is incomplete and sometimes stale: 15 communes of
 * the perimeter have no candidate at all, 138 have several, 154 candidates are
 * http and some are deep links into a booking system. Deciding which string is
 * a commune's website is therefore not a parsing problem but a process, and
 * these four modules are its stages:
 *
 *  - `attempt`   — what can be fetched, and in which order (before any packet).
 *  - `verdict`   — what one observation means for one URL.
 *  - `states`    — which moves are legal, and who may make them.
 *  - `arbitrate` — what to do with the other candidates of the same commune.
 *
 * All of it is pure. The fetching belongs to `src/lib/fetch/`, the writing to
 * `src/db/`, and the schedule to the scan job — which is what lets the rules
 * above be specified by unit tests that never touch the network (CLAUDE.md §5).
 */

export { planAttempt, rankCandidates } from './attempt.js';
export type { AttemptPlan } from './attempt.js';

export { DEFAULT_MAX_ATTEMPTS, isSameHost, judgeObservation } from './verdict.js';
export type { FetchFailure, Observation, RetryPolicy, Verdict } from './verdict.js';

export {
  IllegalTransitionError,
  RESOLUTION_REASONS,
  allowedTransitions,
  applyTransition,
  canTransition,
} from './states.js';
export type {
  ResolutionActor,
  ResolutionReason,
  ResolutionState,
  StatutResolution,
  Transition,
} from './states.js';

export { arbitrateCommune } from './arbitrate.js';
export type { Arbitration, CandidateState, Disposition } from './arbitrate.js';
