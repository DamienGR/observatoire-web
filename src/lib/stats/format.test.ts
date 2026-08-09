import { describe, expect, it } from 'vitest';
import { formatCount, formatDateTime, formatShare, toDateTimeAttribute } from './format.js';

/**
 * Formatting is French and Paris-local (CLAUDE.md §4: dates are stored in UTC
 * and formatted in `Europe/Paris` only for display).
 *
 * The assertions avoid pinning the exact separator characters ICU produces —
 * a narrow no-break space today, possibly something else after a Node upgrade.
 * What is asserted is what the rule actually says: digits are grouped, the
 * decimal mark is a comma, and the displayed instant is the Paris one.
 */

describe('formatCount', () => {
  it('groups thousands', () => {
    expect(formatCount(1_067)).toMatch(/^1\D067$/u);
  });

  it('leaves a number below a thousand alone', () => {
    expect(formatCount(15)).toBe('15');
  });

  it('formats zero as zero rather than as an empty string', () => {
    // The page shows counts that are legitimately zero on day one — no
    // measurement, no run. A formatter that renders those as nothing turns an
    // honest zero into a missing figure.
    expect(formatCount(0)).toBe('0');
  });
});

describe('formatShare', () => {
  it('renders a proportion as a percentage with one decimal', () => {
    expect(formatShare(0.1234)).toMatch(/^12,3\s*%$/u);
  });

  it('renders zero without a decimal accident', () => {
    expect(formatShare(0)).toMatch(/^0\s*%$/u);
  });

  it('renders a whole proportion as 100 %', () => {
    expect(formatShare(1)).toMatch(/^100\s*%$/u);
  });
});

describe('formatDateTime', () => {
  it('displays an instant in Europe/Paris, not in UTC', () => {
    // 22:30 UTC on 9 August is 00:30 on 10 August in Paris (UTC+2 in summer).
    // A formatter left in UTC would print "9 août", which is the kind of
    // one-day error nobody notices on a page nobody reads twice.
    expect(formatDateTime(new Date('2026-08-09T22:30:00Z'))).toMatch(/10 août 2026/u);
  });

  it('applies the winter offset too', () => {
    // Same instant of day in January: Paris is UTC+1, so 23:30 UTC is 00:30 on
    // the next day. A fixed `+2` would pass the test above and fail here.
    expect(formatDateTime(new Date('2027-01-09T23:30:00Z'))).toMatch(/10 janvier 2027/u);
  });

  it('includes the time', () => {
    expect(formatDateTime(new Date('2026-08-09T09:05:00Z'))).toMatch(/11\D05/u);
  });
});

describe('toDateTimeAttribute', () => {
  it('keeps the machine-readable form in UTC', () => {
    // `<time datetime>` is read by machines, not by a French reader: it stays
    // the stored instant, so the displayed Paris time and the attribute
    // describe the same moment without either pretending to be the other.
    expect(toDateTimeAttribute(new Date('2026-08-09T22:30:00Z'))).toBe('2026-08-09T22:30:00.000Z');
  });
});
