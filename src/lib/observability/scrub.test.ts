import { describe, expect, it } from 'vitest';
import {
  ALLOWED_REQUEST_HEADERS,
  scrubEvent,
  stripQueryString,
  type ScrubbableEvent,
} from './scrub.js';

describe('stripQueryString', () => {
  it('keeps the path and drops everything after it', () => {
    expect(stripQueryString('https://observatoire-web.fr/ops/scan?token=s3cret')).toBe(
      'https://observatoire-web.fr/ops/scan',
    );
  });

  it('drops the fragment too, which is where a token also ends up', () => {
    expect(stripQueryString('https://example.org/page#token=s3cret')).toBe(
      'https://example.org/page',
    );
  });

  it('leaves a URL without a query alone', () => {
    expect(stripQueryString('https://observatoire-web.fr/methodologie')).toBe(
      'https://observatoire-web.fr/methodologie',
    );
  });

  it('truncates at the first delimiter of a value it cannot parse', () => {
    // Sentry reports relative URLs in breadcrumbs; `new URL` would throw on
    // them, and losing the breadcrumb is worse than keeping a path.
    expect(stripQueryString('/api/communes?code=35238')).toBe('/api/communes');
  });
});

describe('scrubEvent', () => {
  it('removes the Authorization header, whatever its case', () => {
    const event: ScrubbableEvent = {
      request: { headers: { Authorization: 'Bearer s3cret', 'user-agent': 'curl/8' } },
    };

    expect(scrubEvent(event).request?.headers).toEqual({ 'user-agent': 'curl/8' });
  });

  it('removes cookies, both as a header and as a field', () => {
    const event: ScrubbableEvent = {
      request: { headers: { cookie: 'session=abc' }, cookies: { session: 'abc' } },
    };

    scrubEvent(event);

    expect(event.request?.headers).toEqual({});
    expect(event.request?.cookies).toBeUndefined();
  });

  it('keeps only the headers on the allowlist', () => {
    const event: ScrubbableEvent = {
      request: {
        headers: {
          'user-agent': 'curl/8',
          'content-type': 'text/html',
          'x-nf-account-id': 'internal',
          'x-forwarded-for': '203.0.113.4',
        },
      },
    };

    scrubEvent(event);

    expect(Object.keys(event.request?.headers ?? {}).sort()).toEqual([...ALLOWED_REQUEST_HEADERS]);
  });

  it('strips the query string of the request URL and drops the parsed one', () => {
    const event: ScrubbableEvent = {
      request: {
        url: 'https://observatoire-web.fr/ops/scan?token=s3cret',
        query_string: 'token=s3cret',
      },
    };

    scrubEvent(event);

    expect(event.request?.url).toBe('https://observatoire-web.fr/ops/scan');
    expect(event.request?.query_string).toBeUndefined();
  });

  it('strips the query string of every breadcrumb URL', () => {
    const event: ScrubbableEvent = {
      breadcrumbs: [
        { data: { url: 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed?key=s3cret' } },
        { data: { status_code: 500 } },
        {},
      ],
    };

    scrubEvent(event);

    expect(event.breadcrumbs?.[0]?.data?.url).toBe(
      'https://www.googleapis.com/pagespeedonline/v5/runPagespeed',
    );
    expect(event.breadcrumbs?.[1]?.data?.status_code).toBe(500);
  });

  it('leaves an event carrying no request and no breadcrumbs alone', () => {
    expect(scrubEvent({})).toEqual({});
  });

  it('returns the event it was given, as Sentry expects from beforeSend', () => {
    const event = {};

    expect(scrubEvent(event)).toBe(event);
  });
});
