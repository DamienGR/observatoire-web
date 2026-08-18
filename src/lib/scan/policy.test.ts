import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCAN_POLICY,
  InvalidScanPolicyError,
  backoffMs,
  isLeaseExpired,
  nextDispatchAt,
  scanPolicy,
} from './policy.js';

const at = (iso: string): Date => new Date(iso);

describe('DEFAULT_SCAN_POLICY', () => {
  it('paces at the measured PSI throughput of one request per second', () => {
    expect(DEFAULT_SCAN_POLICY.minIntervalMs).toBe(1_000);
  });

  it('spends four attempts on a site before giving up on it', () => {
    expect(DEFAULT_SCAN_POLICY.maxAttempts).toBe(4);
  });

  it('trusts an in-flight measurement for fifteen minutes', () => {
    expect(DEFAULT_SCAN_POLICY.leaseMs).toBe(15 * 60_000);
  });

  it('waits minutes rather than seconds before retrying, and caps the wait', () => {
    expect(DEFAULT_SCAN_POLICY.backoffBaseMs).toBe(60_000);
    expect(DEFAULT_SCAN_POLICY.backoffCeilingMs).toBe(15 * 60_000);
  });
});

describe('scanPolicy', () => {
  it('returns the default policy when given nothing', () => {
    expect(scanPolicy()).toEqual(DEFAULT_SCAN_POLICY);
  });

  it('overrides only what it is given', () => {
    const policy = scanPolicy({ maxAttempts: 2 });

    expect(policy.maxAttempts).toBe(2);
    expect(policy.leaseMs).toBe(DEFAULT_SCAN_POLICY.leaseMs);
    expect(policy.minIntervalMs).toBe(DEFAULT_SCAN_POLICY.minIntervalMs);
  });

  it('ignores an explicit undefined rather than reading it as a value', () => {
    expect(scanPolicy({ maxAttempts: undefined })).toEqual(DEFAULT_SCAN_POLICY);
  });

  it.each([
    ['maxAttempts', { maxAttempts: 0 }],
    ['maxAttempts', { maxAttempts: 1.5 }],
    ['leaseMs', { leaseMs: 0 }],
    ['minIntervalMs', { minIntervalMs: -1 }],
    ['backoffBaseMs', { backoffBaseMs: 0 }],
    ['backoffCeilingMs', { backoffCeilingMs: 0 }],
  ])('rejects an out-of-range %s', (field, overrides) => {
    expect(() => scanPolicy(overrides)).toThrow(InvalidScanPolicyError);
    expect(() => scanPolicy(overrides)).toThrow(field);
  });

  it('accepts a zero minimum interval, which is the only way to disable pacing', () => {
    expect(scanPolicy({ minIntervalMs: 0 }).minIntervalMs).toBe(0);
  });

  it('accepts a ceiling equal to the base, which is how a constant backoff is written', () => {
    expect(scanPolicy({ backoffBaseMs: 60_000, backoffCeilingMs: 60_000 }).backoffCeilingMs).toBe(
      60_000,
    );
  });

  it('rejects a ceiling below the base, which would make the backoff shrink', () => {
    expect(() => scanPolicy({ backoffBaseMs: 60_000, backoffCeilingMs: 30_000 })).toThrow(
      InvalidScanPolicyError,
    );
  });
});

describe('backoffMs', () => {
  it.each([
    [0, 0],
    [1, 60_000],
    [2, 120_000],
    [3, 240_000],
    [4, 480_000],
    // Doubling would give 960 000 ms here; the ceiling holds.
    [5, 900_000],
    [50, 900_000],
  ])('waits %i attempt(s) in for %i ms', (attempts, expected) => {
    expect(backoffMs(attempts)).toBe(expected);
  });

  it('treats a negative attempt count as no attempt at all', () => {
    expect(backoffMs(-3)).toBe(0);
  });

  it('doubles from the base of the policy it is given', () => {
    const policy = scanPolicy({ backoffBaseMs: 1_000, backoffCeilingMs: 10_000 });

    expect(backoffMs(1, policy)).toBe(1_000);
    expect(backoffMs(2, policy)).toBe(2_000);
    expect(backoffMs(4, policy)).toBe(8_000);
    expect(backoffMs(5, policy)).toBe(10_000);
  });
});

describe('nextDispatchAt', () => {
  it('dispatches immediately when nothing has been dispatched yet', () => {
    expect(nextDispatchAt(null, at('2026-08-18T10:00:00Z'))).toEqual(at('2026-08-18T10:00:00Z'));
  });

  it('holds the request back until one interval has passed', () => {
    expect(nextDispatchAt(at('2026-08-18T10:00:00.000Z'), at('2026-08-18T10:00:00.200Z'))).toEqual(
      at('2026-08-18T10:00:01.000Z'),
    );
  });

  it('does not hold anything back once the interval has passed', () => {
    expect(nextDispatchAt(at('2026-08-18T10:00:00Z'), at('2026-08-18T10:00:05Z'))).toEqual(
      at('2026-08-18T10:00:05Z'),
    );
  });

  it('dispatches exactly on the boundary rather than one tick later', () => {
    expect(nextDispatchAt(at('2026-08-18T10:00:00Z'), at('2026-08-18T10:00:01Z'))).toEqual(
      at('2026-08-18T10:00:01Z'),
    );
  });

  it('never returns a moment in the past, even when the clock jumped backwards', () => {
    expect(nextDispatchAt(at('2026-08-18T10:00:10Z'), at('2026-08-18T10:00:00Z'))).toEqual(
      at('2026-08-18T10:00:11Z'),
    );
  });
});

describe('isLeaseExpired', () => {
  it('trusts a measurement that started inside the lease', () => {
    expect(isLeaseExpired(at('2026-08-18T10:00:00Z'), at('2026-08-18T10:14:59Z'))).toBe(false);
  });

  it('reclaims a measurement whose lease has run out', () => {
    expect(isLeaseExpired(at('2026-08-18T10:00:00Z'), at('2026-08-18T10:15:01Z'))).toBe(true);
  });

  it('does not reclaim on the boundary — the worker may be writing right now', () => {
    expect(isLeaseExpired(at('2026-08-18T10:00:00Z'), at('2026-08-18T10:15:00Z'))).toBe(false);
  });

  it('does not reclaim a measurement whose timestamp is in the future', () => {
    expect(isLeaseExpired(at('2026-08-18T11:00:00Z'), at('2026-08-18T10:00:00Z'))).toBe(false);
  });

  it('uses the lease of the policy it is given', () => {
    const policy = scanPolicy({ leaseMs: 1_000 });

    expect(isLeaseExpired(at('2026-08-18T10:00:00Z'), at('2026-08-18T10:00:02Z'), policy)).toBe(
      true,
    );
  });
});
