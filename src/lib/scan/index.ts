/**
 * A scan, as four pure decisions (milestone 2, docs/brief.md §8).
 *
 * The milestone exists to exercise a capricious third party, idempotence, and
 * steering without a shell. All three land here rather than in the job, for the
 * reason CLAUDE.md §5 gives: each session starts from an empty context, so a
 * rule that is not written as a test is a rule that is lost. What remains in
 * `src/jobs/` is a loop with no judgement in it.
 *
 *  - `policy`      — the five numbers a scan obeys, and how they are validated.
 *  - `eligibility` — which sites may be measured, and which twenty this run takes.
 *  - `worklist`    — what is left to do, from the rows already written.
 *  - `progress`    — what one attempt leaves behind, and when the run is over.
 *
 * Nothing here reads a clock, a database or the network: `now` is an argument,
 * the rows are arguments, and the transport belongs to `src/lib/fetch/`.
 */

export {
  DEFAULT_SCAN_POLICY,
  InvalidScanPolicyError,
  backoffMs,
  isLeaseExpired,
  nextDispatchAt,
  scanPolicy,
} from './policy.js';
export type { ScanPolicy, ScanPolicyOverrides } from './policy.js';

export { SCAN_SKIP_REASONS, isScannable, selectScanTargets } from './eligibility.js';
export type {
  ScanCandidate,
  ScanSelection,
  ScanSelectionOptions,
  ScanSelectionReport,
  ScanSkipReason,
  SkippedSite,
} from './eligibility.js';

export { SCAN_TASK_KINDS, planWorklist } from './worklist.js';
export type {
  MeasurementState,
  ScanProgress,
  ScanTask,
  ScanTaskKind,
  ScanWorklist,
  WorklistInput,
} from './worklist.js';

export { concludeRun, settleAttempt } from './progress.js';
export type { AttemptOutcome, RunConclusion, SettledAttempt } from './progress.js';
