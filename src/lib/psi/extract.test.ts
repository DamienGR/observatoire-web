import { describe, expect, it } from 'vitest';
import {
  ANDREZIEUX,
  PAGE_ABSENTE,
  PARIS,
  readPsiFixture,
} from '../../../tests/unit/helpers/psi-fixtures.js';
import { extractMeasurement } from './extract.js';
import { PsiPayloadError, parsePsiResponse, type PsiReport } from './payload.js';

function report(name: string): PsiReport {
  const parsed = parsePsiResponse(readPsiFixture(name));
  if (parsed.kind !== 'report') throw new Error(`${name} is not a report`);
  return parsed.report;
}

describe('extractMeasurement, against the frozen capture', () => {
  const paris = extractMeasurement(report(PARIS));

  it('turns the four category scores into the integers the columns hold', () => {
    expect(paris.performanceScore).toBe(46);
    expect(paris.accessibilityScore).toBe(90);
    expect(paris.bestPracticesScore).toBe(96);
    expect(paris.seoScore).toBe(92);
  });

  it('reads the six metrics, in the units the columns are named after', () => {
    expect(paris.lcpMs).toBe(22963);
    expect(paris.fcpMs).toBe(3751);
    expect(paris.speedIndexMs).toBe(6578);
    expect(paris.tbtMs).toBe(553);
    expect(paris.ttiMs).toBe(23725);
    expect(paris.cls).toBeCloseTo(0.0876, 4);
  });

  it('takes the fetch time from Lighthouse rather than from our own clock', () => {
    expect(paris.fetchedAt.toISOString()).toBe('2026-08-23T13:56:58.703Z');
  });

  it('reports the status of the main document', () => {
    expect(paris.httpStatus).toBe(200);
    expect(paris.finalUrl).toBe('https://www.paris.fr/');
  });

  it('records the provenance of the findings, for the log and not for a column', () => {
    expect(paris.lighthouseVersion).toBe('13.4.1');
    expect(paris.axeCoreVersion).toBe('4.12.1');
    expect(paris.runWarnings).toEqual([]);
  });

  it('carries the findings, already extracted', () => {
    expect(paris.findings.map((finding) => finding.ruleId)).toEqual([
      'aria-hidden-focus',
      'link-name',
      'list',
    ]);
    expect(paris.unratedRules).toEqual([]);
  });

  /**
   * The trap this module exists to catch. A directory URL that has moved gives
   * a report like any other — 95 on accessibility, 66 on performance — and it
   * describes a 404 page. Only the status says so.
   */
  it('reports a 404 on a page that scores perfectly respectably', () => {
    const absent = extractMeasurement(report(PAGE_ABSENTE));

    expect(absent.httpStatus).toBe(404);
    expect(absent.accessibilityScore).toBe(95);
  });

  it('reads the smallest site of the capture too', () => {
    const andrezieux = extractMeasurement(report(ANDREZIEUX));

    expect(andrezieux.accessibilityScore).toBe(78);
    expect(andrezieux.httpStatus).toBe(200);
    expect(andrezieux.findings).toHaveLength(7);
  });
});

describe('extractMeasurement, on the cases the capture does not contain', () => {
  const base: PsiReport = {
    finalDisplayedUrl: 'https://ville.fr/',
    lighthouseVersion: '13.4.1',
    fetchTime: '2026-08-23T13:56:58.703Z',
    categories: {},
    audits: {},
  };

  it('leaves every column null when the report measured nothing', () => {
    const measurement = extractMeasurement(base);

    expect(measurement.performanceScore).toBeNull();
    expect(measurement.accessibilityScore).toBeNull();
    expect(measurement.lcpMs).toBeNull();
    expect(measurement.cls).toBeNull();
    expect(measurement.httpStatus).toBeNull();
    expect(measurement.axeCoreVersion).toBeNull();
  });

  it('distinguishes a category that failed from a category that was not asked for', () => {
    const measurement = extractMeasurement({
      ...base,
      categories: { performance: { id: 'performance', score: null, auditRefs: [] } },
    });

    expect(measurement.performanceScore).toBeNull();
  });

  it('falls back to the displayed URL when the report names no main document', () => {
    expect(extractMeasurement(base).finalUrl).toBe('https://ville.fr/');
  });

  it('reports the redirected URL as the final one', () => {
    const measurement = extractMeasurement({
      ...base,
      mainDocumentUrl: 'https://www.ville.fr/accueil',
    });

    expect(measurement.finalUrl).toBe('https://www.ville.fr/accueil');
  });

  /**
   * A redirect puts two document requests in the list. The one that matters is
   * the one the report calls the main document, not the first of the chain.
   */
  it('takes the status of the main document, not of the redirect that led to it', () => {
    const measurement = extractMeasurement({
      ...base,
      mainDocumentUrl: 'https://www.ville.fr/',
      audits: {
        'network-requests': {
          id: 'network-requests',
          score: 1,
          scoreDisplayMode: 'informative',
          details: {
            items: [
              { url: 'https://ville.fr/', statusCode: 301, resourceType: 'Document' },
              { url: 'https://www.ville.fr/', statusCode: 200, resourceType: 'Document' },
            ],
          },
        },
      },
    });

    expect(measurement.httpStatus).toBe(200);
  });

  /**
   * And the other way round: the main document is not always the last of the
   * chain either. Only matching it by URL answers both cases.
   */
  it('takes the main document when it is not the last of the list', () => {
    const measurement = extractMeasurement({
      ...base,
      mainDocumentUrl: 'https://www.ville.fr/',
      audits: {
        'network-requests': {
          id: 'network-requests',
          score: 1,
          scoreDisplayMode: 'informative',
          details: {
            items: [
              { url: 'https://www.ville.fr/', statusCode: 200, resourceType: 'Document' },
              { url: 'https://www.ville.fr/iframe', statusCode: 500, resourceType: 'Document' },
            ],
          },
        },
      },
    });

    expect(measurement.httpStatus).toBe(200);
  });

  it('ignores everything in the request list that is not a document', () => {
    const measurement = extractMeasurement({
      ...base,
      audits: {
        'network-requests': {
          id: 'network-requests',
          score: 1,
          scoreDisplayMode: 'informative',
          details: {
            items: [
              { url: 'https://ville.fr/app.js', statusCode: 500, resourceType: 'Script' },
              { url: 'https://ville.fr/', statusCode: 200, resourceType: 'Document' },
            ],
          },
        },
      },
    });

    expect(measurement.httpStatus).toBe(200);
  });

  it('takes the last document of the chain when the report names no main document', () => {
    const measurement = extractMeasurement({
      ...base,
      audits: {
        'network-requests': {
          id: 'network-requests',
          score: 1,
          scoreDisplayMode: 'informative',
          details: {
            items: [
              { url: 'https://ville.fr/', statusCode: 301, resourceType: 'Document' },
              { url: 'https://www.ville.fr/', statusCode: 410, resourceType: 'Document' },
            ],
          },
        },
      },
    });

    expect(measurement.httpStatus).toBe(410);
  });

  it('reports no status at all when the request list holds no document', () => {
    const measurement = extractMeasurement({
      ...base,
      audits: {
        'network-requests': {
          id: 'network-requests',
          score: 1,
          scoreDisplayMode: 'informative',
          details: {
            items: [{ url: 'https://ville.fr/app.js', statusCode: 200, resourceType: 'Script' }],
          },
        },
      },
    });

    expect(measurement.httpStatus).toBeNull();
  });

  it('reports no status when the request audit carries no detail at all', () => {
    const measurement = extractMeasurement({
      ...base,
      audits: {
        'network-requests': { id: 'network-requests', score: 1, scoreDisplayMode: 'informative' },
      },
    });

    expect(measurement.httpStatus).toBeNull();
  });

  it('says the axe version is unknown rather than guessing, when the report omits it', () => {
    expect(extractMeasurement({ ...base, environment: {} }).axeCoreVersion).toBeNull();
  });

  it('reports no warnings, rather than nothing, when the report carries none', () => {
    expect(extractMeasurement(base).runWarnings).toEqual([]);
  });

  it('rounds a category score rather than truncating it', () => {
    const measurement = extractMeasurement({
      ...base,
      categories: { seo: { id: 'seo', score: 0.99, auditRefs: [] } },
    });

    expect(measurement.seoScore).toBe(99);
  });

  it('ignores an entry of the request list it cannot read', () => {
    const measurement = extractMeasurement({
      ...base,
      audits: {
        'network-requests': {
          id: 'network-requests',
          score: 1,
          scoreDisplayMode: 'informative',
          details: {
            items: ['not a request', { url: 'https://ville.fr/', statusCode: 204 }],
          },
        },
      },
    });

    expect(measurement.httpStatus).toBe(204);
  });

  /**
   * The one place this module refuses to produce a number. A version reporting
   * LCP in seconds would store 23 where it means 23 000, and publish it about a
   * real commune as an excellent result.
   */
  it('refuses a metric whose unit changed under it', () => {
    expect(() =>
      extractMeasurement({
        ...base,
        audits: {
          'largest-contentful-paint': {
            id: 'largest-contentful-paint',
            score: 0,
            scoreDisplayMode: 'numeric',
            numericValue: 23,
            numericUnit: 'second',
          },
        },
      }),
    ).toThrow(PsiPayloadError);
  });

  it('leaves a metric null when the audit ran but produced no value', () => {
    const measurement = extractMeasurement({
      ...base,
      audits: {
        'largest-contentful-paint': {
          id: 'largest-contentful-paint',
          score: null,
          scoreDisplayMode: 'error',
        },
      },
    });

    expect(measurement.lcpMs).toBeNull();
  });

  it('keeps the layout shift unrounded, unlike the milliseconds', () => {
    const measurement = extractMeasurement({
      ...base,
      audits: {
        'cumulative-layout-shift': {
          id: 'cumulative-layout-shift',
          score: 0.9,
          scoreDisplayMode: 'numeric',
          numericValue: 0.08756928870607933,
          numericUnit: 'unitless',
        },
        'total-blocking-time': {
          id: 'total-blocking-time',
          score: 0.5,
          scoreDisplayMode: 'numeric',
          numericValue: 553.4,
          numericUnit: 'millisecond',
        },
      },
    });

    expect(measurement.cls).toBe(0.08756928870607933);
    expect(measurement.tbtMs).toBe(553);
  });
});
