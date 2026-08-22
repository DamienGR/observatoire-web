import { describe, expect, it } from 'vitest';
import {
  NAVIGATION_PLAN,
  WARMUP_PLAN,
  classifyProbe,
  delayBeforeAttempt,
  isTransientTransportError,
  totalWaitMs,
  unavailableMessage,
  wrongAnswerMessage,
  type Probe,
} from './readiness.js';

/**
 * Written before `readiness.ts` (CLAUDE.md §5: test-first for pure logic).
 *
 * What is decided here is the one thing the E2E layer could not say on 18/8:
 * whether a red verdict means "the site is broken" or "the function is waking
 * up" (docs/journal.md 028, issue #46). Playwright announced axe-core
 * violations in the dark palette; the detail said `Expected: 200, Received:
 * 500` — the test named the wrong failure, and a hurried reader concluded there
 * was a contrast regression.
 *
 * The rule therefore lives where a unit test can reach it, rather than inside
 * the retry loop of a job nobody can run from a session: no cloud session can
 * reach a public URL at all (docs/journal.md 020), so the transport is
 * untestable here and the judgement must not be.
 */

function probe(overrides: Partial<Probe> = {}): Probe {
  return { status: 200, ...overrides };
}

describe('classifyProbe', () => {
  it('accepts the status the route is supposed to answer, not merely 200', () => {
    // `/404` answers 404 at its own address, and asserting 200 everywhere would
    // make the not-found page the one page whose check proved nothing
    // (tests/e2e/routes.ts).
    expect(classifyProbe(probe({ status: 200 }), 200).kind).toBe('ready');
    expect(classifyProbe(probe({ status: 404 }), 404).kind).toBe('ready');
  });

  it('reads a 5xx as unavailable, because that is what a cold function answers', () => {
    const verdict = classifyProbe(probe({ status: 500 }), 200);

    expect(verdict.kind).toBe('unavailable');
    expect(verdict.reason).toBe('HTTP 500');
  });

  it.each([502, 503, 504, 408, 429])('reads HTTP %i as unavailable too', (status) => {
    // 408 and 429 join the 5xx for the same reason: the request never reached a
    // rendering, so nothing about the page was observed. A rate limit is the
    // platform saying "not now", not the site saying "here is my answer".
    expect(classifyProbe(probe({ status }), 200).kind).toBe('unavailable');
  });

  it('reads a wrong but definite status as a real failure, to be reported at once', () => {
    // The whole point of the split: a 404 where the site promises a page is a
    // defect, and retrying it four times would only make the report slower.
    const verdict = classifyProbe(probe({ status: 404 }), 200);

    expect(verdict.kind).toBe('wrong');
    expect(verdict.reason).toBe('HTTP 404, expected 200');
  });

  it('reads a 200 where a 404 was promised as a real failure as well', () => {
    // The not-found page answering 200 is the regression that makes every
    // unknown address look like a valid one to a crawler.
    expect(classifyProbe(probe({ status: 200 }), 404).kind).toBe('wrong');
  });

  it('reads a transient transport failure as unavailable', () => {
    const verdict = classifyProbe(probe({ status: 0, error: 'net::ERR_ABORTED' }), 200);

    expect(verdict.kind).toBe('unavailable');
    expect(verdict.reason).toBe('net::ERR_ABORTED');
  });

  it('reads a transport failure that will never fix itself as a real failure', () => {
    // A misspelt host does not become right on the fourth attempt. Retrying it
    // spends the whole budget and then reports a timeout instead of the cause.
    const verdict = classifyProbe(probe({ status: 0, error: 'net::ERR_NAME_NOT_RESOLVED' }), 200);

    expect(verdict.kind).toBe('wrong');
    expect(verdict.reason).toBe('net::ERR_NAME_NOT_RESOLVED');
  });

  it('reports nothing at all as unavailable rather than crashing on the absent reason', () => {
    const verdict = classifyProbe(probe({ status: 0 }), 200);

    expect(verdict.kind).toBe('unavailable');
    expect(verdict.reason).toBe('no response');
  });
});

describe('isTransientTransportError', () => {
  it.each([
    'net::ERR_ABORTED',
    'net::ERR_CONNECTION_RESET',
    'net::ERR_EMPTY_RESPONSE',
    'net::ERR_TIMED_OUT',
    'Timeout 30000ms exceeded',
    'TypeError: fetch failed ← Error: socket hang up',
    'Error: ECONNRESET',
    'Error: ETIMEDOUT',
    'Error: EAI_AGAIN',
    'The operation was aborted due to timeout',
  ])('treats %s as a bad moment', (message) => {
    expect(isTransientTransportError(message)).toBe(true);
  });

  it.each([
    'net::ERR_NAME_NOT_RESOLVED',
    'net::ERR_CERT_AUTHORITY_INVALID',
    'TypeError: fetch failed ← Error: getaddrinfo ENOTFOUND observatoire-web.invalid',
    'Error: unable to verify the first certificate',
    'TypeError: Invalid URL',
  ])('treats %s as a fault that will not fix itself', (message) => {
    expect(isTransientTransportError(message)).toBe(false);
  });

  it('recognises nothing in an empty message rather than retrying blindly', () => {
    // An allowlist and not a denylist, deliberately: an unknown failure is
    // reported now. Guessing that it is transient is how a real outage becomes
    // a slow red build with a timeout for a diagnosis.
    expect(isTransientTransportError('')).toBe(false);
  });

  it('matches whatever the case the platform chose', () => {
    expect(isTransientTransportError('net::err_connection_closed')).toBe(true);
  });
});

describe('the retry plans', () => {
  it('gives the warm-up more patience than a navigation inside the suite', () => {
    // Two different waits for two different things. The warm-up meets a
    // function that has never run and may still be deploying; a navigation
    // meets a function the warm-up already woke, so a long wait there would
    // only delay a real failure.
    expect(WARMUP_PLAN.attempts).toBeGreaterThan(NAVIGATION_PLAN.attempts);
    expect(totalWaitMs(WARMUP_PLAN)).toBeGreaterThan(totalWaitMs(NAVIGATION_PLAN));
  });

  it('keeps both bounded well inside the budgets of §5', () => {
    // The E2E layer has six minutes and the whole pipeline ten (CLAUDE.md §5).
    // A retry that is not bounded is a budget that is not measured.
    expect(totalWaitMs(WARMUP_PLAN)).toBeLessThanOrEqual(20_000);
    expect(totalWaitMs(NAVIGATION_PLAN)).toBeLessThanOrEqual(10_000);
  });

  it('waits before every attempt but the first', () => {
    expect(delayBeforeAttempt(WARMUP_PLAN, 1)).toBe(0);
    expect(delayBeforeAttempt(WARMUP_PLAN, 2)).toBe(WARMUP_PLAN.backoffMs[0]);
  });

  it('backs off further at each attempt, so a bad minute is waited out and not hammered', () => {
    const delays = Array.from({ length: WARMUP_PLAN.attempts }, (_, index) =>
      delayBeforeAttempt(WARMUP_PLAN, index + 1),
    );

    expect(delays.every((delay, index) => index === 0 || delay > (delays[index - 1] ?? 0))).toBe(
      true,
    );
  });

  it('holds the last delay for any attempt beyond the schedule', () => {
    // The schedule is one shorter than the attempt count by construction, and a
    // plan that grew without its schedule must not silently stop waiting.
    expect(delayBeforeAttempt({ attempts: 4, backoffMs: [1_000] }, 4)).toBe(1_000);
  });
});

describe('unavailableMessage', () => {
  const message = unavailableMessage({
    target: '/accessibilite',
    attempts: 5,
    elapsedMs: 16_200,
    lastReason: 'HTTP 500',
  });

  it('names availability as the failure, so no reader has to infer it', () => {
    // This is the acceptance criterion of issue #46 in one assertion: the words
    // a reader meets first must not describe the assertion that never ran.
    expect(message).toContain('did not answer');
    expect(message).toContain('availability failure');
  });

  it('carries what was tried, for how long, and what came back last', () => {
    expect(message).toContain('/accessibilite');
    expect(message).toContain('5 attempts');
    expect(message).toContain('16.2s');
    expect(message).toContain('HTTP 500');
  });

  it('says that nothing was measured, which is the part that misleads', () => {
    // A suite that reports zero violations on a page that never rendered is the
    // reassuring green §5 calls the worst possible failure; the mirror image —
    // a violation reported on a page that never rendered — is this one.
    expect(message).toContain('nothing was rendered');
  });
});

describe('wrongAnswerMessage', () => {
  it('states the defect plainly, with both statuses', () => {
    expect(wrongAnswerMessage('/stats', probe({ status: 404 }), 200)).toBe(
      'GET /stats answered HTTP 404, expected 200. The deployment answered, so this is a ' +
        'failure of the page and not of its availability.',
    );
  });

  it('does not claim the deployment answered when nothing did', () => {
    // Found by rehearsing the job against a stand-in rather than by re-reading
    // it: an unresolvable host produced "answered HTTP 0 … the deployment
    // answered", which is the exact sin issue #46 is about — a failure message
    // naming the wrong failure. The verdict was right and the sentence was not.
    const message = wrongAnswerMessage(
      '/',
      probe({
        status: 0,
        error: 'TypeError: fetch failed ← Error: getaddrinfo ENOTFOUND obs.invalid',
      }),
      200,
    );

    expect(message).toContain('could not be reached');
    expect(message).toContain('ENOTFOUND');
    expect(message).not.toContain('answered HTTP');
  });

  it('says why it is not waiting, since every other failure here is waited out', () => {
    expect(
      wrongAnswerMessage('/', probe({ status: 0, error: 'net::ERR_CERT_DATE_INVALID' }), 200),
    ).toContain('will not answer on a later attempt');
  });
});
