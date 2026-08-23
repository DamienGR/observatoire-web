import { describe, expect, it } from 'vitest';
import { readSecurityHeaders } from './headers.js';

const headers = (entries: Record<string, string>): Headers => new Headers(entries);

/**
 * Values below are verbatim from the 41 responses measured on 23 August 2026
 * (docs/journal.md 031): 20 declared HSTS, 15 a CSP, 26 `nosniff`.
 */

describe('readSecurityHeaders — HSTS', () => {
  it.each([
    ['max-age=31536000'],
    ['max-age=31536000; includeSubDomains; preload'],
    ['max-age=31536000; includeSubdomains; preload;'],
    ['max-age=63072000; includeSubdomains;'],
    ['max-age=16000000'],
    ['max-age=31536000;preload'],
    ['MAX-AGE=31536000'],
    ['max-age="31536000"'],
  ])('reads %s as a declared policy', (value) => {
    expect(readSecurityHeaders(headers({ 'strict-transport-security': value })).hasHsts).toBe(true);
  });

  it.each([
    ['max-age=0'],
    ['max-age=0; includeSubDomains'],
    ['includeSubDomains'],
    [''],
    ['max-age=nonsense'],
  ])('reads %s as no policy at all', (value) => {
    // `max-age=0` is how a site *withdraws* HSTS. Counting it as a declaration
    // would credit a commune for the header that turns the protection off.
    expect(readSecurityHeaders(headers({ 'strict-transport-security': value })).hasHsts).toBe(
      false,
    );
  });

  it('reads an absent header as absent, not as unknown', () => {
    expect(readSecurityHeaders(headers({})).hasHsts).toBe(false);
  });
});

describe('readSecurityHeaders — CSP', () => {
  it.each([
    ["frame-ancestors 'self';"],
    ["default-src * 'unsafe-inline' 'unsafe-eval'; frame-ancestors 'self' https://*;"],
    ['upgrade-insecure-requests; block-all-mixed-content;'],
  ])('reads %s as a declared policy, whatever it actually restricts', (value) => {
    // Six of the fifteen measured policies only set `frame-ancestors`. The
    // column is a boolean (docs/brief.md §6) and this signal says "declares
    // one", not "declares a good one" — the methodology page says so too.
    expect(readSecurityHeaders(headers({ 'content-security-policy': value })).hasCsp).toBe(true);
  });

  it('does not count a report-only policy, which enforces nothing', () => {
    const found = readSecurityHeaders(
      headers({ 'content-security-policy-report-only': "default-src 'self'" }),
    );

    expect(found.hasCsp).toBe(false);
  });

  it('does not count an empty policy', () => {
    expect(readSecurityHeaders(headers({ 'content-security-policy': '   ' })).hasCsp).toBe(false);
  });
});

describe('readSecurityHeaders — X-Content-Type-Options', () => {
  it.each([['nosniff'], ['NOSNIFF'], [' nosniff '], ['nosniff, nosniff']])(
    'reads %s as nosniff',
    (value) => {
      // `nosniff, nosniff` is measured: two layers set the same header and
      // `Headers.get` joins them. A strict equality test would have read the
      // commune that protects itself twice as protecting itself not at all.
      expect(
        readSecurityHeaders(headers({ 'x-content-type-options': value })).hasXContentTypeOptions,
      ).toBe(true);
    },
  );

  it.each([['sniff'], [''], ['nosniffing']])('reads %s as not nosniff', (value) => {
    expect(
      readSecurityHeaders(headers({ 'x-content-type-options': value })).hasXContentTypeOptions,
    ).toBe(false);
  });
});

describe('readSecurityHeaders', () => {
  it('reads the three signals of one response together', () => {
    const found = readSecurityHeaders(
      headers({
        'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
        'content-security-policy': "frame-ancestors 'self';",
        'x-content-type-options': 'nosniff',
      }),
    );

    expect(found).toEqual({ hasHsts: true, hasCsp: true, hasXContentTypeOptions: true });
  });

  it('reads a bare response as declaring nothing', () => {
    expect(readSecurityHeaders(headers({}))).toEqual({
      hasHsts: false,
      hasCsp: false,
      hasXContentTypeOptions: false,
    });
  });
});
