import { describe, expect, it } from 'vitest';
import { scanPolicy } from './policy.js';
import { concludeRun, settleAttempt } from './progress.js';
import type { ScanProgress } from './worklist.js';

const progress = (overrides: Partial<ScanProgress> = {}): ScanProgress => ({
  targets: 20,
  ready: 0,
  succeeded: 20,
  skipped: 0,
  inFlight: 0,
  waiting: 0,
  exhausted: 0,
  orphaned: 0,
  ...overrides,
});

describe('settleAttempt', () => {
  it('records a measured site as succeeded, and counts the attempt', () => {
    expect(settleAttempt('measured', 0)).toEqual({
      statut: 'succeeded',
      attempts: 1,
      willRetry: false,
    });
  });

  it('leaves a transient failure retryable while the budget holds', () => {
    expect(settleAttempt('transient-failure', 0)).toEqual({
      statut: 'failed',
      attempts: 1,
      willRetry: true,
    });
  });

  it('stops retrying on the attempt that spends the budget', () => {
    expect(settleAttempt('transient-failure', 3)).toEqual({
      statut: 'failed',
      attempts: 4,
      willRetry: false,
    });
  });

  it('spends the whole budget on a permanent failure rather than trusting a flag', () => {
    // The resume pass of `worklist` sees a status and a count, nothing else.
    // A permanent failure that left attempts on the clock would be picked up
    // again on the next pass, for ever.
    expect(settleAttempt('permanent-failure', 0)).toEqual({
      statut: 'failed',
      attempts: 4,
      willRetry: false,
    });
  });

  it('does not lower the attempt count of a permanent failure late in the run', () => {
    expect(settleAttempt('permanent-failure', 7).attempts).toBe(7 + 1);
  });

  it('uses the budget of the policy it is given', () => {
    const policy = scanPolicy({ maxAttempts: 2 });

    expect(settleAttempt('transient-failure', 0, policy).willRetry).toBe(true);
    expect(settleAttempt('transient-failure', 1, policy).willRetry).toBe(false);
    expect(settleAttempt('permanent-failure', 0, policy).attempts).toBe(2);
  });
});

describe('concludeRun', () => {
  it('keeps a run open while work is ready to dispatch', () => {
    expect(concludeRun(progress({ ready: 1, succeeded: 19 }))).toEqual({
      finished: false,
      statut: 'running',
    });
  });

  it('keeps a run open while a measurement is in flight', () => {
    expect(concludeRun(progress({ inFlight: 1, succeeded: 19 })).finished).toBe(false);
  });

  it('keeps a run open while a measurement is waiting out its backoff', () => {
    expect(concludeRun(progress({ waiting: 1, succeeded: 19 })).finished).toBe(false);
  });

  it('closes a run that measured everything it targeted', () => {
    expect(concludeRun(progress())).toEqual({ finished: true, statut: 'succeeded' });
  });

  it('closes a run with holes as failed, so the operator sees them', () => {
    expect(concludeRun(progress({ succeeded: 19, exhausted: 1 }))).toEqual({
      finished: true,
      statut: 'failed',
    });
  });

  it('counts a deliberately skipped site as a clean finish, not a hole', () => {
    expect(concludeRun(progress({ succeeded: 18, skipped: 2 })).statut).toBe('succeeded');
  });

  it('closes a run that had nothing to do at all', () => {
    expect(concludeRun(progress({ targets: 0, succeeded: 0 }))).toEqual({
      finished: true,
      statut: 'succeeded',
    });
  });

  it('ignores orphaned measurements, which belong to no target', () => {
    expect(concludeRun(progress({ orphaned: 3 })).statut).toBe('succeeded');
  });
});
