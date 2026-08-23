import { describe, expect, it } from 'vitest';
import {
  ANDREZIEUX,
  DOCUMENT_INDISPONIBLE,
  HOTE_INJOIGNABLE,
  PAGE_ABSENTE,
  PARIS,
  readPsiFixture,
} from '../../../tests/unit/helpers/psi-fixtures.js';
import { PsiPayloadError, parsePsiResponse } from './payload.js';

/**
 * Against the frozen capture of 23 August 2026, and nothing else. Every number
 * asserted below was observed; none was chosen.
 */
describe('parsePsiResponse, against the frozen capture', () => {
  it.each([PARIS, ANDREZIEUX, PAGE_ABSENTE])('reads the report of %s', (name) => {
    const parsed = parsePsiResponse(readPsiFixture(name));

    expect(parsed.kind).toBe('report');
  });

  it.each([DOCUMENT_INDISPONIBLE, HOTE_INJOIGNABLE])('reads the error envelope of %s', (name) => {
    const parsed = parsePsiResponse(readPsiFixture(name));

    expect(parsed.kind).toBe('error');
  });

  it('keeps the fields the measurement is built from', () => {
    const parsed = parsePsiResponse(readPsiFixture(PARIS));
    if (parsed.kind !== 'report') throw new Error('expected a report');

    expect(parsed.report.requestedUrl).toBe('https://www.paris.fr/');
    expect(parsed.report.mainDocumentUrl).toBe('https://www.paris.fr/');
    expect(parsed.report.lighthouseVersion).toBe('13.4.1');
    expect(parsed.report.fetchTime).toBe('2026-08-23T13:56:58.703Z');
    expect(parsed.report.environment?.credits?.['axe-core']).toBe('4.12.1');
  });

  it('echoes the four categories that were asked for, and only those', () => {
    const parsed = parsePsiResponse(readPsiFixture(PARIS));
    if (parsed.kind !== 'report') throw new Error('expected a report');

    expect(Object.keys(parsed.report.categories).sort()).toEqual([
      'accessibility',
      'best-practices',
      'performance',
      'seo',
    ]);
    expect(parsed.report.configSettings?.onlyCategories).toEqual([
      'performance',
      'accessibility',
      'best-practices',
      'seo',
    ]);
  });

  it('keeps the form factor the request asked for', () => {
    const parsed = parsePsiResponse(readPsiFixture(PARIS));
    if (parsed.kind !== 'report') throw new Error('expected a report');

    expect(parsed.report.configSettings?.formFactor).toBe('mobile');
  });

  it('reads the two error payloads as the same code under different prose', () => {
    const unavailable = parsePsiResponse(readPsiFixture(DOCUMENT_INDISPONIBLE));
    const unreachable = parsePsiResponse(readPsiFixture(HOTE_INJOIGNABLE));
    if (unavailable.kind !== 'error' || unreachable.kind !== 'error') {
      throw new Error('expected two errors');
    }

    expect(unavailable.error.code).toBe(400);
    expect(unreachable.error.code).toBe(400);
    expect(unavailable.error.errors?.[0]?.reason).toBe('lighthouseUserError');
    expect(unreachable.error.errors?.[0]?.reason).toBe('lighthouseUserError');
    // The whole difference between "the site is down" and "the host is gone".
    expect(unavailable.error.message).toContain('net::ERR_FAILED');
    expect(unreachable.error.message).toContain('net::ERR_CONNECTION_FAILED');
  });

  it('discards what it does not name, starting with the screenshot', () => {
    const parsed = parsePsiResponse(readPsiFixture(PARIS));
    if (parsed.kind !== 'report') throw new Error('expected a report');

    expect(parsed.report).not.toHaveProperty('fullPageScreenshot');
    expect(parsed.report).not.toHaveProperty('timing');
    expect(parsed.report).not.toHaveProperty('i18n');
  });
});

describe('parsePsiResponse, on what the API should never send', () => {
  it.each([
    ['a string', '"nope"'],
    ['a number', '42'],
    ['null', 'null'],
    ['an array', '[]'],
  ])('refuses %s', (_case, raw) => {
    const body: unknown = JSON.parse(raw);

    if (Array.isArray(body)) {
      // An array is an object; it simply has neither envelope.
      expect(() => parsePsiResponse(body)).toThrow(PsiPayloadError);
      return;
    }
    expect(() => parsePsiResponse(body)).toThrow(PsiPayloadError);
  });

  it('refuses an envelope carrying neither a report nor an error', () => {
    expect(() => parsePsiResponse({ kind: 'pagespeedonline#result' })).toThrow(PsiPayloadError);
  });

  it('refuses an error envelope that is not shaped like one', () => {
    expect(() => parsePsiResponse({ error: 'something went wrong' })).toThrow(PsiPayloadError);
  });

  it('refuses an error envelope with no status code to classify it by', () => {
    expect(() => parsePsiResponse({ error: { message: 'no code' } })).toThrow(PsiPayloadError);
  });

  it('names the fields it choked on, rather than saying the payload is wrong', () => {
    let message = '';
    try {
      parsePsiResponse({ lighthouseResult: { finalDisplayedUrl: 'https://ville.fr/' } });
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }

    expect(message).toContain('lighthouseResult.lighthouseVersion');
    expect(message).toContain('lighthouseResult.categories');
  });

  it('refuses a report whose fetchTime is not a timestamp', () => {
    const payload = readPsiFixture(PARIS) as { lighthouseResult: { fetchTime: string } };
    payload.lighthouseResult.fetchTime = 'the twenty-third';

    expect(() => parsePsiResponse(payload)).toThrow(PsiPayloadError);
  });

  it('refuses a category score outside 0–1, which would silently become 3 700 %', () => {
    const payload = readPsiFixture(PARIS) as {
      lighthouseResult: { categories: Record<string, { score: number }> };
    };
    const performance = payload.lighthouseResult.categories.performance;
    if (performance === undefined) throw new Error('expected a performance category');
    performance.score = 37;

    expect(() => parsePsiResponse(payload)).toThrow(PsiPayloadError);
  });

  it('accepts a category score of null, which is how a category that failed arrives', () => {
    const payload = readPsiFixture(PARIS) as {
      lighthouseResult: { categories: Record<string, { score: number | null }> };
    };
    const performance = payload.lighthouseResult.categories.performance;
    if (performance === undefined) throw new Error('expected a performance category');
    performance.score = null;

    expect(parsePsiResponse(payload).kind).toBe('report');
  });

  it('accepts a scoreDisplayMode it has never seen, because Lighthouse adds them', () => {
    const payload = readPsiFixture(PARIS) as {
      lighthouseResult: { audits: Record<string, { scoreDisplayMode: string }> };
    };
    const audit = payload.lighthouseResult.audits['link-name'];
    if (audit === undefined) throw new Error('expected the link-name audit');
    audit.scoreDisplayMode = 'somethingNewInV14';

    expect(parsePsiResponse(payload).kind).toBe('report');
  });
});
