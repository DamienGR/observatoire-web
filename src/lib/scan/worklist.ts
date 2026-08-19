import type { MeasurementStatus, ScanRunStatus } from '../../db/schema.js';
import { DEFAULT_SCAN_POLICY, backoffMs, isLeaseExpired, type ScanPolicy } from './policy.js';

/**
 * What is left to do in a run, decided from the rows the run has already
 * written.
 *
 * This is the module CLAUDE.md §8 is about — *a scan is idempotent and
 * resumable per commune* — and §5 lists it third by value among the things to
 * test. Both properties come from the same place: the work list is a pure
 * function of the target set, the measurement rows and the clock. There is no
 * cursor, no queue and no state of its own, so "resume" is not a code path
 * distinct from "start". A fresh run is simply the case where no row exists
 * yet, and re-planning mid-flight converges instead of duplicating.
 *
 * The four kinds of task exist because the writer has to do four different
 * things, and because the log has to say which happened. `create` and
 * `dispatch` are the same measurement to PSI; `reclaim` says a worker died;
 * `retry` says a third party failed us. Collapsing them would leave nobody able
 * to tell the last two apart, and they call for opposite reactions.
 */

/** The part of a `measurement` row the planner reads. */
export interface MeasurementState {
  readonly siteId: number;
  readonly statut: MeasurementStatus;
  /** Attempts already spent, `measurement.attempts` in the schema. */
  readonly attempts: number;
  /** When the row last changed: the lease clock, and the backoff clock. */
  readonly updatedAt: Date;
}

export const SCAN_TASK_KINDS = ['create', 'dispatch', 'reclaim', 'retry'] as const;
export type ScanTaskKind = (typeof SCAN_TASK_KINDS)[number];

export interface ScanTask {
  readonly siteId: number;
  readonly kind: ScanTaskKind;
  /** Attempts spent before this one. Zero for a target nobody has tried. */
  readonly attempts: number;
}

/**
 * Where every target of the run stands, in six mutually exclusive buckets that
 * sum to `targets`.
 *
 * The sum is asserted by a test rather than promised in this comment, because
 * a bucket that stops adding up is exactly how a run appears finished while a
 * site is still owed a measurement.
 */
export interface ScanProgress {
  readonly targets: number;
  /**
   * Targets whose next step is a request. The same number as `tasks.length`,
   * except on a run that is no longer `running`: there the work remains and
   * nothing will dispatch it, which is exactly what an operator wants to read
   * after cancelling a run half way.
   */
  readonly ready: number;
  readonly succeeded: number;
  readonly skipped: number;
  /** `running`, inside its lease: somebody else's request is in the air. */
  readonly inFlight: number;
  /** `failed`, attempts left, backoff not elapsed. */
  readonly waiting: number;
  /** `failed`, attempts spent. The holes an operator has to look at. */
  readonly exhausted: number;
  /**
   * Rows of this run whose site is no longer a target — a site invalidated
   * between two passes, or a sample narrowed by the operator. Counted and
   * ignored: deleting the row would destroy a measurement that was legitimately
   * taken, and acting on it would measure a site the run no longer targets.
   */
  readonly orphaned: number;
}

export interface ScanWorklist {
  readonly tasks: readonly ScanTask[];
  readonly progress: ScanProgress;
}

export interface WorklistInput {
  /** Site ids, in the order `selectScanTargets` produced them. */
  readonly targets: readonly number[];
  readonly measurements: readonly MeasurementState[];
  readonly now: Date;
  /** Defaults to `running`; anything else plans no work. */
  readonly runStatus?: ScanRunStatus;
  readonly policy?: ScanPolicy;
}

type Disposition =
  | { readonly bucket: 'ready'; readonly kind: ScanTaskKind }
  | { readonly bucket: 'succeeded' | 'skipped' | 'inFlight' | 'waiting' | 'exhausted' };

function dispose(state: MeasurementState | undefined, now: Date, policy: ScanPolicy): Disposition {
  if (state === undefined) return { bucket: 'ready', kind: 'create' };

  switch (state.statut) {
    case 'succeeded':
      return { bucket: 'succeeded' };
    case 'skipped':
      return { bucket: 'skipped' };
    case 'pending':
      return { bucket: 'ready', kind: 'dispatch' };
    case 'running':
      // Reclaimed regardless of the attempt budget, and that is not an
      // oversight: a stalled row is the one state no later pass can resolve on
      // its own, so it has to come back even when its retries are spent. The
      // attempt it consumed is still counted, so it comes back once.
      return isLeaseExpired(state.updatedAt, now, policy)
        ? { bucket: 'ready', kind: 'reclaim' }
        : { bucket: 'inFlight' };
    case 'failed':
      if (state.attempts >= policy.maxAttempts) return { bucket: 'exhausted' };
      return state.updatedAt.getTime() + backoffMs(state.attempts, policy) <= now.getTime()
        ? { bucket: 'ready', kind: 'retry' }
        : { bucket: 'waiting' };
  }
}

/**
 * The work one pass of the scan has to do, and where the run stands.
 *
 * Tasks come out ordered by attempts spent, then by the order the targets were
 * given. A resumed run therefore finishes the sites nobody has touched before
 * grinding on the ones that already failed twice — which matters when the run
 * is cut short again: what survives is breadth, not a deeper hole in the same
 * three communes.
 */
export function planWorklist(input: WorklistInput): ScanWorklist {
  const policy = input.policy ?? DEFAULT_SCAN_POLICY;
  const bySite = new Map(input.measurements.map((state) => [state.siteId, state]));
  const targets = new Set(input.targets);

  const counts = {
    ready: 0,
    succeeded: 0,
    skipped: 0,
    inFlight: 0,
    waiting: 0,
    exhausted: 0,
  };

  const ready: ScanTask[] = [];

  for (const siteId of input.targets) {
    const state = bySite.get(siteId);
    const disposition = dispose(state, input.now, policy);
    counts[disposition.bucket] += 1;

    if (disposition.bucket === 'ready') {
      ready.push({ siteId, kind: disposition.kind, attempts: state?.attempts ?? 0 });
    }
  }

  // A run that is not running plans nothing. The counts are still computed and
  // still sum to `targets`, so the ops surface can say "cancelled with eleven
  // sites left" rather than showing a run that looks finished.
  const tasks =
    (input.runStatus ?? 'running') === 'running'
      ? // Sorted on attempts alone: `ready` is built by walking `targets`, and
        // `Array.prototype.sort` has been required to be stable since ES2019, so
        // equal attempt counts keep the order the sample gave them. An explicit
        // tie-break here would be a second implementation of that guarantee, and
        // the mutation run showed it to be unreachable — no test could tell it
        // from its own mutants, because it never decided anything.
        [...ready].sort((left, right) => left.attempts - right.attempts)
      : [];

  return {
    tasks,
    progress: {
      targets: input.targets.length,
      ready: counts.ready,
      succeeded: counts.succeeded,
      skipped: counts.skipped,
      inFlight: counts.inFlight,
      waiting: counts.waiting,
      exhausted: counts.exhausted,
      orphaned: input.measurements.filter((state) => !targets.has(state.siteId)).length,
    },
  };
}
