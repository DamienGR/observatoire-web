import type { MeasurementStatus, ScanRunStatus } from '../../db/schema.js';
import { DEFAULT_SCAN_POLICY, type ScanPolicy } from './policy.js';
import type { ScanProgress } from './worklist.js';

/**
 * The other half of `worklist.ts`: what one attempt leaves behind, and when a
 * run is over.
 *
 * `worklist` decides what to do next from the rows; this decides what the rows
 * become. Keeping the pair pure and symmetrical is what makes the loop in the
 * job trivial — dispatch, settle, write — and what lets an interrupted run be
 * exercised in a unit test rather than by killing a real job and hoping.
 *
 * What is deliberately *not* here: which failures are transient. That mapping
 * needs the real payloads, and when this was written the frozen capture did not
 * exist — inventing it would have meant writing down a guess in the one place
 * the project treats as observed fact. So this module takes the verdict as an
 * input and stays honest about who decides it. The two deciders now exist and
 * are the two halves of a measurement: `src/lib/signals/collect.ts` for the
 * page we fetch ourselves, `src/lib/psi/outcome.ts` for the one we buy — and
 * the second says, from the capture, that PageSpeed Insights cannot tell a site
 * that is down from a host that is gone (docs/journal.md 032).
 */

/**
 * What one attempt produced, in the only three shapes the row cares about.
 *
 * `permanent-failure` is not "a bad error", it is *an error a fourth request
 * would answer the same way*: a URL PSI refuses to parse, an address the SSRF
 * guard blocks. The distinction earns its place in the PSI quota — the brief
 * measures the API at roughly one request a second (§4), so four attempts at
 * something hopeless are four seconds another commune does not get.
 */
export type AttemptOutcome = 'measured' | 'transient-failure' | 'permanent-failure';

export interface SettledAttempt {
  readonly statut: MeasurementStatus;
  /** Attempts spent including this one, to be written to the row. */
  readonly attempts: number;
  /** Whether a later pass will pick this row up again. */
  readonly willRetry: boolean;
}

/**
 * The row after the attempt.
 *
 * A permanent failure spends the whole attempt budget rather than setting a
 * flag, and that is the load-bearing detail of this module. `planWorklist` sees
 * a status and a count — nothing else survives in the schema — so a permanent
 * failure that left attempts on the clock would be picked up on the next pass,
 * and on the pass after that, for ever. Burning the budget is how "do not ask
 * again" is written in a vocabulary the resume pass can read.
 */
export function settleAttempt(
  outcome: AttemptOutcome,
  attemptsBefore: number,
  policy: ScanPolicy = DEFAULT_SCAN_POLICY,
): SettledAttempt {
  const attempts = attemptsBefore + 1;

  if (outcome === 'measured') return { statut: 'succeeded', attempts, willRetry: false };

  if (outcome === 'permanent-failure') {
    return {
      statut: 'failed',
      // `Math.max`, because a permanent failure on the last attempt of a long
      // run must not *lower* the count and hand the row a free retry.
      attempts: Math.max(attempts, policy.maxAttempts),
      willRetry: false,
    };
  }

  return { statut: 'failed', attempts, willRetry: attempts < policy.maxAttempts };
}

export interface RunConclusion {
  readonly finished: boolean;
  readonly statut: ScanRunStatus;
}

/**
 * Whether the run is done, and what to write in `scan_run.statut`.
 *
 * `failed` here means *finished with holes*, not *aborted*: a run that measured
 * nineteen of twenty communes is a run whose twentieth needs a human, and the
 * schema has no fourth word for it. The holes are `exhausted` measurements, and
 * they stay resumable — an operator resetting their attempt count through the
 * ops surface (CLAUDE.md §8) puts them straight back into the work list, which
 * is the whole reason the attempt budget lives on the row and not on the run.
 *
 * `skipped` counts as a clean finish. It is the deliberate exclusion — a site
 * the operator took out of the sample — and reporting a run red for obeying an
 * instruction would teach everyone to ignore the colour.
 */
export function concludeRun(progress: ScanProgress): RunConclusion {
  const outstanding = progress.ready + progress.inFlight + progress.waiting;

  if (outstanding > 0) return { finished: false, statut: 'running' };

  return { finished: true, statut: progress.exhausted > 0 ? 'failed' : 'succeeded' };
}
