import { describe, expect, it } from 'vitest';
import { MEASUREMENT_STATUSES, type MeasurementStatus } from '../../db/schema.js';
import { scanPolicy } from './policy.js';
import { planWorklist, type MeasurementState } from './worklist.js';

const at = (iso: string): Date => new Date(iso);
const NOW = at('2026-08-18T12:00:00Z');

const row = (
  siteId: number,
  statut: MeasurementStatus,
  overrides: { attempts?: number; updatedAt?: Date } = {},
): MeasurementState => ({
  siteId,
  statut,
  attempts: overrides.attempts ?? 0,
  updatedAt: overrides.updatedAt ?? at('2026-08-18T11:00:00Z'),
});

describe('planWorklist', () => {
  it('creates a measurement for every target of a run that has none', () => {
    const { tasks } = planWorklist({ targets: [3, 1, 2], measurements: [], now: NOW });

    expect(tasks).toEqual([
      { siteId: 3, kind: 'create', attempts: 0 },
      { siteId: 1, kind: 'create', attempts: 0 },
      { siteId: 2, kind: 'create', attempts: 0 },
    ]);
  });

  it('dispatches a row that exists and has never been attempted', () => {
    const { tasks } = planWorklist({
      targets: [1],
      measurements: [row(1, 'pending')],
      now: NOW,
    });

    expect(tasks).toEqual([{ siteId: 1, kind: 'dispatch', attempts: 0 }]);
  });

  it('never touches a succeeded measurement — that is what makes a replay idempotent', () => {
    const { tasks, progress } = planWorklist({
      targets: [1],
      measurements: [row(1, 'succeeded', { attempts: 1 })],
      now: NOW,
    });

    expect(tasks).toEqual([]);
    expect(progress.succeeded).toBe(1);
  });

  it('never touches a skipped measurement either', () => {
    const { tasks, progress } = planWorklist({
      targets: [1],
      measurements: [row(1, 'skipped')],
      now: NOW,
    });

    expect(tasks).toEqual([]);
    expect(progress.skipped).toBe(1);
  });

  it('leaves a running measurement alone while its lease holds', () => {
    const { tasks, progress } = planWorklist({
      targets: [1],
      measurements: [row(1, 'running', { attempts: 1, updatedAt: at('2026-08-18T11:50:00Z') })],
      now: NOW,
    });

    expect(tasks).toEqual([]);
    expect(progress.inFlight).toBe(1);
  });

  it('reclaims a running measurement whose worker is gone', () => {
    const { tasks, progress } = planWorklist({
      targets: [1],
      measurements: [row(1, 'running', { attempts: 1, updatedAt: at('2026-08-18T11:40:00Z') })],
      now: NOW,
    });

    expect(tasks).toEqual([{ siteId: 1, kind: 'reclaim', attempts: 1 }]);
    expect(progress.inFlight).toBe(0);
  });

  it('holds a failed measurement back until its backoff has elapsed', () => {
    const { tasks, progress } = planWorklist({
      targets: [1],
      // One attempt spent → 60 s of backoff, and only 30 s have passed.
      measurements: [row(1, 'failed', { attempts: 1, updatedAt: at('2026-08-18T11:59:30Z') })],
      now: NOW,
    });

    expect(tasks).toEqual([]);
    expect(progress.waiting).toBe(1);
  });

  it('retries a failed measurement once its backoff has elapsed', () => {
    const { tasks } = planWorklist({
      targets: [1],
      measurements: [row(1, 'failed', { attempts: 1, updatedAt: at('2026-08-18T11:58:00Z') })],
      now: NOW,
    });

    expect(tasks).toEqual([{ siteId: 1, kind: 'retry', attempts: 1 }]);
  });

  it('retries on the exact instant the backoff expires, not one tick later', () => {
    const { tasks } = planWorklist({
      targets: [1],
      // One attempt spent → 60 s of backoff, and exactly 60 s have passed.
      measurements: [row(1, 'failed', { attempts: 1, updatedAt: at('2026-08-18T11:59:00Z') })],
      now: NOW,
    });

    expect(tasks).toEqual([{ siteId: 1, kind: 'retry', attempts: 1 }]);
  });

  it('stops retrying a measurement that has spent its attempts', () => {
    const { tasks, progress } = planWorklist({
      targets: [1],
      measurements: [row(1, 'failed', { attempts: 4, updatedAt: at('2026-08-18T10:00:00Z') })],
      now: NOW,
    });

    expect(tasks).toEqual([]);
    expect(progress.exhausted).toBe(1);
  });

  it('checks the attempt budget before the backoff, so an exhausted row never waits', () => {
    const { progress } = planWorklist({
      targets: [1],
      measurements: [row(1, 'failed', { attempts: 9, updatedAt: NOW })],
      now: NOW,
    });

    expect(progress.exhausted).toBe(1);
    expect(progress.waiting).toBe(0);
  });

  it('reclaims a stalled row even when its attempts are spent — it is not a retry', () => {
    // The attempt was consumed and the worker died before writing an outcome.
    // Refusing to reclaim would leave the row `running` for ever, which is the
    // one state no later pass can resolve.
    const { tasks } = planWorklist({
      targets: [1],
      measurements: [row(1, 'running', { attempts: 4, updatedAt: at('2026-08-18T10:00:00Z') })],
      now: NOW,
    });

    expect(tasks).toEqual([{ siteId: 1, kind: 'reclaim', attempts: 4 }]);
  });

  it('does the untouched work before grinding on the retries', () => {
    const { tasks } = planWorklist({
      targets: [1, 2, 3],
      measurements: [
        row(1, 'failed', { attempts: 2, updatedAt: at('2026-08-18T11:00:00Z') }),
        row(2, 'pending'),
      ],
      now: NOW,
    });

    expect(tasks).toEqual([
      { siteId: 2, kind: 'dispatch', attempts: 0 },
      { siteId: 3, kind: 'create', attempts: 0 },
      { siteId: 1, kind: 'retry', attempts: 2 },
    ]);
  });

  it('orders equal attempt counts by the order the targets came in', () => {
    const { tasks } = planWorklist({
      targets: [30, 10, 20],
      measurements: [
        row(10, 'failed', { attempts: 1, updatedAt: at('2026-08-18T11:00:00Z') }),
        row(20, 'failed', { attempts: 1, updatedAt: at('2026-08-18T11:00:00Z') }),
        row(30, 'failed', { attempts: 1, updatedAt: at('2026-08-18T11:00:00Z') }),
      ],
      now: NOW,
    });

    expect(tasks.map((task) => task.siteId)).toEqual([30, 10, 20]);
  });

  it('ignores a measurement whose site is no longer a target, and counts it', () => {
    // Two targets and one stray, so that counting the strays and counting the
    // targets cannot give the same answer.
    const { tasks, progress } = planWorklist({
      targets: [1, 2],
      measurements: [row(1, 'pending'), row(2, 'pending'), row(99, 'pending')],
      now: NOW,
    });

    expect(tasks).toEqual([
      { siteId: 1, kind: 'dispatch', attempts: 0 },
      { siteId: 2, kind: 'dispatch', attempts: 0 },
    ]);
    expect(progress.orphaned).toBe(1);
  });

  it('plans nothing for a run that is no longer running, but still counts the work left', () => {
    const { tasks, progress } = planWorklist({
      targets: [1, 2],
      measurements: [row(1, 'pending')],
      now: NOW,
      runStatus: 'cancelled',
    });

    expect(tasks).toEqual([]);
    // Not zero: the two sites are still owed a measurement, and a cancelled run
    // that reported none would be indistinguishable from a finished one.
    expect(progress.ready).toBe(2);
    expect(progress.targets).toBe(2);
  });

  it.each(['succeeded', 'failed', 'cancelled'] as const)(
    'plans nothing for a %s run',
    (runStatus) => {
      const { tasks } = planWorklist({
        targets: [1],
        measurements: [],
        now: NOW,
        runStatus,
      });

      expect(tasks).toEqual([]);
    },
  );

  it('counts a target with no row at all as pending work, not as a hole', () => {
    const { progress } = planWorklist({ targets: [1, 2], measurements: [], now: NOW });

    expect(progress).toEqual({
      targets: 2,
      ready: 2,
      succeeded: 0,
      skipped: 0,
      inFlight: 0,
      waiting: 0,
      exhausted: 0,
      orphaned: 0,
    });
  });

  it('accounts for every target exactly once', () => {
    const { progress } = planWorklist({
      targets: [1, 2, 3, 4, 5, 6],
      measurements: [
        row(1, 'succeeded'),
        row(2, 'skipped'),
        row(3, 'running', { attempts: 1, updatedAt: at('2026-08-18T11:55:00Z') }),
        row(4, 'failed', { attempts: 1, updatedAt: at('2026-08-18T11:59:59Z') }),
        row(5, 'failed', { attempts: 4, updatedAt: at('2026-08-18T10:00:00Z') }),
        row(6, 'pending'),
      ],
      now: NOW,
    });

    const accounted =
      progress.ready +
      progress.succeeded +
      progress.skipped +
      progress.inFlight +
      progress.waiting +
      progress.exhausted;

    expect(accounted).toBe(progress.targets);
  });

  it('honours the attempt budget of the policy it is given', () => {
    const { progress } = planWorklist({
      targets: [1],
      measurements: [row(1, 'failed', { attempts: 1, updatedAt: at('2026-08-18T10:00:00Z') })],
      now: NOW,
      policy: scanPolicy({ maxAttempts: 1 }),
    });

    expect(progress.exhausted).toBe(1);
  });

  it('has an opinion about every status the column can hold', () => {
    for (const statut of MEASUREMENT_STATUSES) {
      const { progress } = planWorklist({
        targets: [1],
        measurements: [row(1, statut, { updatedAt: at('2026-08-18T10:00:00Z') })],
        now: NOW,
      });

      const accounted =
        progress.ready +
        progress.succeeded +
        progress.skipped +
        progress.inFlight +
        progress.waiting +
        progress.exhausted;

      expect(accounted, `status ${statut} is unaccounted for`).toBe(1);
    }
  });
});
