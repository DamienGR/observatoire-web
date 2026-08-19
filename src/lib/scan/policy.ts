/**
 * The numbers a scan obeys, and why each of them is that number.
 *
 * They live in their own module for two reasons. The ops surface (CLAUDE.md §8)
 * has to be able to override them per run — a replay of one commune has no use
 * for a fifteen-minute lease — so they must be a value, not a constant read at
 * the call site. And a scan is a loop whose whole behaviour under a capricious
 * third party *is* these five numbers: written here, they are reviewable and
 * mutation-tested; written inline, they are folklore.
 *
 * Everything below is pure arithmetic on a clock passed in. No `Date.now()`
 * anywhere in this directory: a scheduler that reads the wall clock itself
 * cannot be tested against the case that matters, which is a run resumed hours
 * later.
 */

export interface ScanPolicy {
  /**
   * How many attempts one site gets inside one run, all causes together.
   *
   * Four rather than the three of `src/lib/resolve/verdict.ts`, and the
   * difference is deliberate: resolution asks *does this URL exist*, a question
   * a fourth try does not answer better. A measurement asks PSI, whose failure
   * mode the brief measured (§4) — 500s for several minutes under load. Here a
   * fourth attempt lands well after the outage, because the backoff below has
   * pushed it eight minutes out.
   */
  readonly maxAttempts: number;
  /**
   * How long a `running` measurement is believed before another pass may take
   * it back.
   *
   * This is the only defence against a job the runner killed mid-request: the
   * row would otherwise stay `running` for ever, and no later pass could tell
   * it apart from a request in flight. Fifteen minutes is comfortably above the
   * worst PSI round trip (tens of seconds) and comfortably below the interval
   * between two scans.
   */
  readonly leaseMs: number;
  /**
   * The floor between two outgoing PSI requests.
   *
   * One second, which is the *measured* throughput of the API and not its
   * advertised quota — 25 000 requests a day would allow 17 a minute times ten,
   * and the brief (§4) records what actually happens above roughly one per
   * second: 500s for minutes. The scan is slow on purpose.
   */
  readonly minIntervalMs: number;
  /** The wait after the first failed attempt; it doubles from there. */
  readonly backoffBaseMs: number;
  /** The wait never exceeds this, however many attempts were spent. */
  readonly backoffCeilingMs: number;
}

export const DEFAULT_SCAN_POLICY: ScanPolicy = {
  maxAttempts: 4,
  leaseMs: 15 * 60_000,
  minIntervalMs: 1_000,
  backoffBaseMs: 60_000,
  backoffCeilingMs: 15 * 60_000,
};

export class InvalidScanPolicyError extends Error {
  override readonly name = 'InvalidScanPolicyError';

  constructor(field: keyof ScanPolicy | 'backoffCeilingMs', detail: string) {
    super(
      `Invalid scan policy: ${field} ${detail}. ` +
        'The ops surface can override these per run, so they are validated ' +
        'here rather than trusted — a zero interval would empty the PSI quota ' +
        'in a minute, and a zero attempt budget would make every run a no-op.',
    );
  }
}

function requirePositiveInteger(field: keyof ScanPolicy, value: number, floor: number): void {
  if (!Number.isInteger(value)) throw new InvalidScanPolicyError(field, 'must be an integer');
  if (value < floor) throw new InvalidScanPolicyError(field, `must be at least ${String(floor)}`);
}

/**
 * What an operator may override, per run.
 *
 * Explicitly `| undefined` rather than `Partial<ScanPolicy>`: the repository
 * compiles under `exactOptionalPropertyTypes`, where an absent key and a key
 * holding `undefined` are different types. The ops surface will build these
 * from a parsed JSON body, where a missing field *is* `undefined`, so the type
 * that matches reality is this one — and the alternative is every caller
 * assembling the object key by key behind conditionals.
 */
export type ScanPolicyOverrides = {
  readonly [K in keyof ScanPolicy]?: ScanPolicy[K] | undefined;
};

/**
 * The policy of a run: the defaults, with whatever the operator overrode.
 *
 * An explicit `undefined` is treated as absent rather than as a value, for the
 * reason above.
 */
export function scanPolicy(overrides: ScanPolicyOverrides = {}): ScanPolicy {
  const policy: ScanPolicy = {
    maxAttempts: overrides.maxAttempts ?? DEFAULT_SCAN_POLICY.maxAttempts,
    leaseMs: overrides.leaseMs ?? DEFAULT_SCAN_POLICY.leaseMs,
    minIntervalMs: overrides.minIntervalMs ?? DEFAULT_SCAN_POLICY.minIntervalMs,
    backoffBaseMs: overrides.backoffBaseMs ?? DEFAULT_SCAN_POLICY.backoffBaseMs,
    backoffCeilingMs: overrides.backoffCeilingMs ?? DEFAULT_SCAN_POLICY.backoffCeilingMs,
  };

  requirePositiveInteger('maxAttempts', policy.maxAttempts, 1);
  requirePositiveInteger('leaseMs', policy.leaseMs, 1);
  // Zero is legal here and nowhere else: it is how an operator replaying a
  // single commune says "do not pace me", and one request needs no pacing.
  requirePositiveInteger('minIntervalMs', policy.minIntervalMs, 0);
  requirePositiveInteger('backoffBaseMs', policy.backoffBaseMs, 1);
  requirePositiveInteger('backoffCeilingMs', policy.backoffCeilingMs, 1);

  if (policy.backoffCeilingMs < policy.backoffBaseMs) {
    throw new InvalidScanPolicyError('backoffCeilingMs', 'must not be below backoffBaseMs');
  }

  return policy;
}

/**
 * How long to wait after `attempts` failed attempts, before the next one.
 *
 * Exponential, and deliberately **without jitter**. Jitter exists to stop a
 * fleet of workers from retrying in unison; this scan is one sequential job
 * against one API, so jitter would buy nothing and cost the property that makes
 * a resumed run reproducible in a test — which, in a project where CI is the
 * only judge, is the more valuable of the two.
 */
export function backoffMs(attempts: number, policy: ScanPolicy = DEFAULT_SCAN_POLICY): number {
  if (attempts <= 0) return 0;

  return Math.min(policy.backoffBaseMs * 2 ** (attempts - 1), policy.backoffCeilingMs);
}

/**
 * The earliest moment the next request may leave, given when the last one did.
 *
 * Never earlier than `now`, and never earlier than one interval after the
 * previous dispatch — including when the two disagree, which is what a clock
 * stepping backwards looks like from inside a job.
 */
export function nextDispatchAt(
  lastDispatchedAt: Date | null,
  now: Date,
  policy: ScanPolicy = DEFAULT_SCAN_POLICY,
): Date {
  if (lastDispatchedAt === null) return now;

  // `Math.max` rather than a comparison: on the boundary the two branches
  // produce the same instant, so a comparison there is a branch no test can
  // tell apart — which is exactly what the mutation run reported.
  return new Date(Math.max(lastDispatchedAt.getTime() + policy.minIntervalMs, now.getTime()));
}

/**
 * Whether a `running` measurement has been silent long enough to be taken back.
 *
 * Strictly greater than the lease, and a row stamped in the future is never
 * reclaimed: both choices resolve the same tie in favour of the worker that may
 * be writing at this instant. Reclaiming too early costs a duplicate PSI
 * request; reclaiming too late costs a delay. The quota is the scarcer of the
 * two.
 */
export function isLeaseExpired(
  startedAt: Date,
  now: Date,
  policy: ScanPolicy = DEFAULT_SCAN_POLICY,
): boolean {
  return now.getTime() - startedAt.getTime() > policy.leaseMs;
}
