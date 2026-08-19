import { describe, expect, it } from 'vitest';
import {
  concludeRun,
  planWorklist,
  scanPolicy,
  selectScanTargets,
  settleAttempt,
  type AttemptOutcome,
  type MeasurementState,
  type ScanCandidate,
  type ScanTask,
} from './index.js';

/**
 * The four modules composed into a run, started, interrupted and resumed.
 *
 * The unit files above specify each rule alone; this one specifies the property
 * CLAUDE.md §8 makes non-negotiable and §5 ranks third by value — *a scan is
 * idempotent and resumable per commune, and no commune is ever duplicated or
 * lost*. That property is not visible in any single module: it emerges from the
 * work list refusing to re-plan a `succeeded` row, from the lease bringing a
 * dead worker's row back, and from the attempt budget stopping the loop.
 *
 * The world below is the smallest thing that can hold it: a map of rows, and a
 * `runPass` that does what `src/jobs/` will do — plan, dispatch, settle, write.
 * Nothing is mocked, because there is nothing to mock: no clock is read and no
 * I/O exists in this directory.
 */

const POLICY = scanPolicy({ maxAttempts: 3, backoffBaseMs: 60_000 });

const SAMPLE: readonly ScanCandidate[] = [
  {
    siteId: 11,
    communeId: '35238',
    url: 'https://rennes.example/',
    statutResolution: 'verifie',
    population: 225_000,
  },
  {
    siteId: 12,
    communeId: '29019',
    url: 'https://brest.example/',
    statutResolution: 'verifie',
    population: 140_000,
  },
  {
    siteId: 13,
    communeId: '56121',
    url: 'https://lorient.example/',
    statutResolution: 'verifie',
    population: 57_000,
  },
  // Not measured: nobody confirmed this URL belongs to the commune.
  {
    siteId: 14,
    communeId: '22278',
    url: 'https://saint-brieuc.example/',
    statutResolution: 'candidat',
    population: 44_000,
  },
];

class World {
  private readonly rows = new Map<number, MeasurementState>();
  /** Every PSI request the run has made, in order. Duplicates would show here. */
  readonly dispatched: number[] = [];

  get measurements(): MeasurementState[] {
    return [...this.rows.values()];
  }

  /**
   * The plan as it stands, dispatching nothing — what the ops surface reads,
   * and what a run has to be concluded from. Concluding from the plan that
   * produced a pass would describe the run as it was *before* that pass wrote
   * anything, so it would call a finished run open, every time.
   */
  inspect(targets: readonly number[], now: Date): ReturnType<typeof planWorklist> {
    return planWorklist({ targets, measurements: this.measurements, now, policy: POLICY });
  }

  /** One pass of the job: plan, then settle each task with the given outcome. */
  runPass(
    targets: readonly number[],
    now: Date,
    outcomeOf: (task: ScanTask) => AttemptOutcome | 'interrupted',
  ): ReturnType<typeof planWorklist> {
    const planned = planWorklist({
      targets,
      measurements: this.measurements,
      now,
      policy: POLICY,
    });

    for (const task of planned.tasks) {
      this.dispatched.push(task.siteId);
      const outcome = outcomeOf(task);

      if (outcome === 'interrupted') {
        // The worker took the row and never came back: exactly what a killed
        // runner leaves behind, and the only state a later pass must repair.
        this.rows.set(task.siteId, {
          siteId: task.siteId,
          statut: 'running',
          attempts: task.attempts + 1,
          updatedAt: now,
        });
        continue;
      }

      const settled = settleAttempt(outcome, task.attempts, POLICY);
      this.rows.set(task.siteId, {
        siteId: task.siteId,
        statut: settled.statut,
        attempts: settled.attempts,
        updatedAt: now,
      });
    }

    return planned;
  }
}

describe('a run over three verified communes', () => {
  const { selected, skipped } = selectScanTargets(SAMPLE, { limit: 20 });
  const targets = selected.map((site) => site.siteId);

  it('targets the verified sites, most populous first, and says why it left one out', () => {
    expect(targets).toEqual([11, 12, 13]);
    expect(skipped).toEqual([{ siteId: 14, communeId: '22278', reason: 'unverified-url' }]);
  });

  it('measures each commune once and closes the run', () => {
    const world = new World();
    const first = world.runPass(targets, new Date('2026-08-18T10:00:00Z'), () => 'measured');

    expect(first.tasks.map((task) => task.kind)).toEqual(['create', 'create', 'create']);
    expect(world.dispatched).toEqual([11, 12, 13]);

    const second = world.runPass(targets, new Date('2026-08-18T10:05:00Z'), () => 'measured');

    // The second pass is the idempotence assertion: replaying a finished run
    // sends nothing, so no commune is measured twice.
    expect(second.tasks).toEqual([]);
    expect(world.dispatched).toEqual([11, 12, 13]);
    expect(concludeRun(second.progress)).toEqual({ finished: true, statut: 'succeeded' });
  });
});

describe('a run interrupted mid-flight', () => {
  const targets = selectScanTargets(SAMPLE).selected.map((site) => site.siteId);

  it('loses nothing: the dead worker’s commune comes back, the others are left alone', () => {
    const world = new World();

    world.runPass(targets, new Date('2026-08-18T10:00:00Z'), (task) =>
      task.siteId === 12 ? 'interrupted' : 'measured',
    );

    // Five minutes later, inside the lease: the stalled row is believed, and a
    // pass run now would re-measure nothing at all.
    const early = world.runPass(targets, new Date('2026-08-18T10:05:00Z'), () => 'measured');
    expect(early.tasks).toEqual([]);
    expect(early.progress.inFlight).toBe(1);
    expect(concludeRun(early.progress).finished).toBe(false);

    // Half an hour later the lease is gone and the row is taken back — once,
    // and carrying the attempt the dead worker already spent.
    const late = world.runPass(targets, new Date('2026-08-18T10:30:00Z'), () => 'measured');
    expect(late.tasks).toEqual([{ siteId: 12, kind: 'reclaim', attempts: 1 }]);

    expect(world.dispatched).toEqual([11, 12, 13, 12]);
    expect(late.tasks).toHaveLength(1);
    expect(concludeRun(world.inspect(targets, new Date('2026-08-18T10:30:01Z')).progress)).toEqual({
      finished: true,
      statut: 'succeeded',
    });
  });
});

describe('a commune whose site keeps answering 500', () => {
  const targets = selectScanTargets(SAMPLE).selected.map((site) => site.siteId);

  it('spends its budget, stops, and leaves the run finished with one hole', () => {
    const world = new World();
    const failing = (task: ScanTask): AttemptOutcome =>
      task.siteId === 13 ? 'transient-failure' : 'measured';

    world.runPass(targets, new Date('2026-08-18T10:00:00Z'), failing);
    // Backoff after one attempt is a minute; nothing moves thirty seconds in.
    const tooSoon = world.runPass(targets, new Date('2026-08-18T10:00:30Z'), failing);
    expect(tooSoon.tasks).toEqual([]);
    expect(tooSoon.progress.waiting).toBe(1);

    world.runPass(targets, new Date('2026-08-18T10:02:00Z'), failing);
    world.runPass(targets, new Date('2026-08-18T10:10:00Z'), failing);
    const settled = world.inspect(targets, new Date('2026-08-18T10:10:01Z'));

    expect(concludeRun(settled.progress)).toEqual({ finished: true, statut: 'failed' });
    expect(settled.progress.exhausted).toBe(1);
    expect(settled.progress.succeeded).toBe(2);

    // Three attempts on the failing commune, one each on the others, and no
    // fourth request once the budget is spent.
    expect(world.dispatched).toEqual([11, 12, 13, 13, 13]);

    const later = world.runPass(targets, new Date('2026-08-19T10:00:00Z'), failing);
    expect(later.tasks).toEqual([]);
  });
});

describe('a URL PSI will never accept', () => {
  const targets = [11];

  it('is asked once, not four times — the quota goes to another commune', () => {
    const world = new World();
    world.runPass(targets, new Date('2026-08-18T10:00:00Z'), () => 'permanent-failure');
    const next = world.runPass(targets, new Date('2026-08-18T11:00:00Z'), () => 'measured');

    expect(next.tasks).toEqual([]);
    expect(world.dispatched).toEqual([11]);
    expect(concludeRun(next.progress).statut).toBe('failed');
  });
});

describe('a sample narrowed between two passes', () => {
  it('keeps the measurement it already took, and stops counting it', () => {
    const world = new World();
    world.runPass([11, 12], new Date('2026-08-18T10:00:00Z'), () => 'measured');

    const narrowed = world.runPass([11], new Date('2026-08-18T10:05:00Z'), () => 'measured');

    expect(narrowed.progress.targets).toBe(1);
    expect(narrowed.progress.orphaned).toBe(1);
    expect(world.measurements).toHaveLength(2);
    expect(concludeRun(narrowed.progress)).toEqual({ finished: true, statut: 'succeeded' });
  });
});
