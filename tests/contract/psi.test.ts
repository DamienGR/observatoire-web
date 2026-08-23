import { beforeAll, describe, expect, it } from 'vitest';
import { requireEnv } from '~/lib/env/index.js';
import { serverEnv } from '~/lib/env/runtime.js';
import {
  buildPsiRequestUrl,
  classifyApiError,
  extractFindings,
  extractMeasurement,
  parsePsiResponse,
  redactPsiKey,
  type PsiResponse,
} from '~/lib/psi/index.js';

/**
 * Asks the real PageSpeed Insights the questions `tests/fixtures/psi/` answers,
 * and fails when the two stop agreeing.
 *
 * This half matters more here than for the other two sources. The PSI fixtures
 * are **pruned** — a raw report is 600 kB to 1.2 MB and three quarters of it is
 * a screenshot (`scripts/prune-psi-capture.mjs`) — so unlike the geo and DILA
 * captures they are not byte-for-byte what arrived. What keeps a pruned fixture
 * honest is exactly this: the same request, weekly, against the live API.
 *
 * Scheduled, never on a pull request (CLAUDE.md §5). And it distinguishes, like
 * its neighbours, an availability failure — PSI is having a bad minute, which
 * the brief measures at §4 — from a contract failure, where the payload arrived
 * and no longer matches. Only the second justifies touching a schema.
 */

/** The largest commune of the perimeter, and the fixture's own target. */
const MEASURABLE = 'https://www.paris.fr/';

/**
 * A host that cannot resolve, by RFC 2606: `.invalid` is reserved and will
 * never be delegated. The captured failures came from a commune whose CDN was
 * down and a commune whose host had disappeared, and neither is a stable
 * address to test against — one recovers, the other might.
 */
const UNREACHABLE = 'https://observatoire-web.invalid/';

const ATTEMPTS = 3;
const BACKOFF_MS = [5_000, 15_000];

interface Answer {
  readonly status: number;
  readonly parsed: PsiResponse;
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const apiKey = requireEnv(serverEnv(), 'PSI_API_KEY');

/**
 * One request, retried only on the statuses that mean "not now".
 *
 * A 400 is not retried: it is an answer, and for `UNREACHABLE` it is the answer
 * this suite is here to read.
 */
async function askPsi(url: string): Promise<Answer> {
  let lastStatus = 0;
  let lastError = '';

  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    if (attempt > 0) await wait(BACKOFF_MS[attempt - 1] ?? 15_000);

    try {
      const response = await fetch(buildPsiRequestUrl({ url, apiKey }), {
        headers: {
          'user-agent':
            'observatoire-web contract test (+https://github.com/DamienGR/observatoire-web)',
        },
        signal: AbortSignal.timeout(120_000),
      });
      const body = (await response.json()) as unknown;

      if (response.status === 429 || response.status >= 500) {
        lastStatus = response.status;
        continue;
      }

      return { status: response.status, parsed: parsePsiResponse(body) };
    } catch (error) {
      lastError = redactPsiKey(error instanceof Error ? error.message : 'transport error');
    }
  }

  throw new Error(
    `PageSpeed Insights did not answer for ${url} after ${String(ATTEMPTS)} attempts ` +
      `(last status ${String(lastStatus)}${lastError === '' ? '' : `, ${lastError}`}).\n` +
      'This is an availability failure, not a contract failure: the shape of the ' +
      'payload was never observed. Re-run before changing any schema.',
  );
}

describe('PageSpeed Insights still answers the way the fixtures say', () => {
  let measurable: Answer;

  beforeAll(async () => {
    measurable = await askPsi(MEASURABLE);
  }, 400_000);

  it('returns a report our schema still recognises', () => {
    expect(measurable.status).toBe(200);
    expect(measurable.parsed.kind).toBe('report');
  });

  it('still echoes the four categories that were asked for', () => {
    if (measurable.parsed.kind !== 'report') throw new Error('expected a report');

    expect(Object.keys(measurable.parsed.report.categories).sort()).toEqual([
      'accessibility',
      'best-practices',
      'performance',
      'seo',
    ]);
  });

  it('still measures the site rather than an error page', () => {
    if (measurable.parsed.kind !== 'report') throw new Error('expected a report');
    const measurement = extractMeasurement(measurable.parsed.report);

    expect(measurement.httpStatus).toBe(200);
  });

  /**
   * The assertion the unit tests cannot make: a unit test reads a metric out of
   * a file that was captured against these very units. Only the live API can
   * say whether they are still what they were.
   */
  it('still reports the six metrics, in the units the columns are named after', () => {
    if (measurable.parsed.kind !== 'report') throw new Error('expected a report');
    const measurement = extractMeasurement(measurable.parsed.report);

    for (const value of [
      measurement.lcpMs,
      measurement.fcpMs,
      measurement.speedIndexMs,
      measurement.tbtMs,
      measurement.ttiMs,
    ]) {
      expect(value).not.toBeNull();
      expect(value).toBeGreaterThanOrEqual(0);
    }
    expect(measurement.cls).not.toBeNull();
  });

  it('still scores the four categories between 0 and 100', () => {
    if (measurable.parsed.kind !== 'report') throw new Error('expected a report');
    const measurement = extractMeasurement(measurable.parsed.report);

    for (const score of [
      measurement.performanceScore,
      measurement.accessibilityScore,
      measurement.bestPracticesScore,
      measurement.seoScore,
    ]) {
      expect(score).not.toBeNull();
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  /**
   * The invariant `findings.ts` rests on: a failing accessibility audit
   * declares an axe impact this project knows. Fourteen out of fourteen did on
   * 23 August 2026. A non-empty list here means Lighthouse moved the field, and
   * that findings are being set aside rather than published.
   */
  it('still declares an impact on every accessibility rule it fails', () => {
    if (measurable.parsed.kind !== 'report') throw new Error('expected a report');

    expect(extractFindings(measurable.parsed.report).unratedRules).toEqual([]);
  });

  it('still names the axe-core version that produced the findings', () => {
    if (measurable.parsed.kind !== 'report') throw new Error('expected a report');

    expect(measurable.parsed.report.environment?.credits?.['axe-core']).toMatch(/^\d+\.\d+/);
  });
});

describe('PageSpeed Insights still refuses an unreachable page the same way', () => {
  let unreachable: Answer;

  beforeAll(async () => {
    unreachable = await askPsi(UNREACHABLE);
  }, 400_000);

  it('answers 400 with an error envelope our schema recognises', () => {
    expect(unreachable.status).toBe(400);
    expect(unreachable.parsed.kind).toBe('error');
  });

  /**
   * The whole of `outcome.ts` rests on this one classification. If PSI ever
   * starts telling a down site apart from a vanished host, this is where we
   * find out — and the taxonomy can stop spending four attempts to say so.
   */
  it('still reads as a transient document failure', () => {
    if (unreachable.parsed.kind !== 'error') throw new Error('expected an error');

    expect(classifyApiError(unreachable.status, unreachable.parsed.error)).toEqual({
      errorCode: 'psi-document-unavailable',
      outcome: 'transient-failure',
      fatalForRun: false,
    });
  });
});
