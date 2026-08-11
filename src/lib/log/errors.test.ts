import { describe, expect, it } from 'vitest';
import { describeErrorChain } from './errors.js';

/**
 * The failure that produced this module, reproduced against a real Postgres on
 * 11 August 2026 and reduced to its shape here: Drizzle wraps the driver's
 * error, so the outer message says the query failed and the reason lives one
 * layer down (docs/journal.md 021).
 *
 * `new Error(msg, { cause })` is exactly what Drizzle does.
 */
const drizzleStyleFailure = new Error('Failed query: select count(*) from "commune"', {
  cause: Object.assign(new Error('relation "commune" does not exist'), {
    name: 'error',
    code: '42P01',
  }),
});

describe('describeErrorChain', () => {
  it('names the cause, which is the only part that says what went wrong', () => {
    const described = describeErrorChain(drizzleStyleFailure);

    expect(described).toContain('Failed query');
    expect(described).toContain('relation "commune" does not exist');
  });

  it('keeps the outermost error first, so the reading order is cause-ward', () => {
    expect(describeErrorChain(drizzleStyleFailure)).toMatch(/Failed query.*relation "commune"/su);
  });

  it('reports a plain error unchanged, without inventing a chain', () => {
    expect(describeErrorChain(new Error('boom'))).toBe('Error: boom');
  });

  it('handles something thrown that is not an Error at all', () => {
    // `throw 'string'` is legal JavaScript and a dependency will do it one day.
    expect(describeErrorChain('just a string')).toBe('just a string');
    expect(describeErrorChain(undefined)).toBe('unknown error');
    expect(describeErrorChain(null)).toBe('unknown error');
  });

  it('stops rather than following a cycle for ever', () => {
    // A self-referencing cause is rare and cheap to survive; an infinite loop
    // inside the code that reports a failure is not.
    const looping = new Error('outer');
    looping.cause = looping;

    expect(() => describeErrorChain(looping)).not.toThrow();
    expect(describeErrorChain(looping).split('←').length).toBeLessThanOrEqual(5);
  });

  it('never reports more than the depth it promises', () => {
    let deepest = new Error('level-9');
    for (let level = 8; level >= 0; level -= 1) {
      deepest = new Error(`level-${String(level)}`, { cause: deepest });
    }

    expect(describeErrorChain(deepest).split('←').length).toBeLessThanOrEqual(5);
  });
});
