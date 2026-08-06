import { describe, expect, it } from 'vitest';
import {
  contentSecurityPolicy,
  SECURITY_HEADER_NAMES,
  securityHeaders,
  sentryIngestOrigin,
} from './security.js';

/** Every directive of a policy, as a map, so a test can assert on one of them. */
function directives(policy: string): Map<string, string[]> {
  const entries = policy
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part): [string, string[]] => {
      const [name, ...sources] = part.split(/\s+/);
      return [name ?? '', sources];
    });

  return new Map(entries);
}

describe('sentryIngestOrigin', () => {
  it('keeps the origin and drops the public key and the project path', () => {
    // A DSN carries a public key as its username and the project id as its
    // path. Neither belongs in a header the browser reads.
    expect(sentryIngestOrigin('https://abc123@o42.ingest.sentry.io/4507')).toBe(
      'https://o42.ingest.sentry.io',
    );
  });

  it('keeps a non-default port, which self-hosted Sentry uses', () => {
    expect(sentryIngestOrigin('https://abc123@sentry.example.org:9000/1')).toBe(
      'https://sentry.example.org:9000',
    );
  });

  it('returns null for a value that is not a URL', () => {
    // parseEnv already rejects a malformed DSN (CLAUDE.md §9), so this branch
    // only guards against a caller that skipped it. Returning null costs the
    // browser its error reporting; throwing would cost the visitor the page.
    expect(sentryIngestOrigin('not-a-dsn')).toBeNull();
  });

  it('returns null for an empty value', () => {
    expect(sentryIngestOrigin('')).toBeNull();
  });

  it('returns null for a scheme whose origin serializes as "null"', () => {
    // `data:` and `file:` URLs parse fine and have an opaque origin. Emitted as
    // a source, it would read `connect-src 'self' null` — accepted by parsers,
    // meaningless to a reader.
    expect(sentryIngestOrigin('data:text/plain,report')).toBeNull();
  });
});

describe('contentSecurityPolicy', () => {
  it('locks every fetch directive to the site itself by default', () => {
    const found = directives(contentSecurityPolicy({}));

    expect(found.get('default-src')).toEqual(["'self'"]);
    expect(found.get('script-src')).toEqual(["'self'"]);
    expect(found.get('style-src')).toEqual(["'self'"]);
    expect(found.get('connect-src')).toEqual(["'self'"]);
    expect(found.get('font-src')).toEqual(["'self'"]);
    expect(found.get('img-src')).toEqual(["'self'", 'data:']);
  });

  it('forbids the three sinks an injected payload reaches for', () => {
    const found = directives(contentSecurityPolicy({}));

    // object-src: legacy plugin content. base-uri: rewriting every relative
    // URL of the page. frame-ancestors: framing the site for clickjacking.
    expect(found.get('object-src')).toEqual(["'none'"]);
    expect(found.get('base-uri')).toEqual(["'none'"]);
    expect(found.get('frame-ancestors')).toEqual(["'none'"]);
  });

  it('restricts form submissions to the site itself', () => {
    expect(directives(contentSecurityPolicy({})).get('form-action')).toEqual(["'self'"]);
  });

  it.each([
    ["'unsafe-inline'", 'unsafe-inline'],
    ["'unsafe-eval'", 'unsafe-eval'],
    ["'unsafe-hashes'", 'unsafe-hashes'],
    ['a wildcard source', '*'],
  ])('never allows %s (CLAUDE.md §7)', (_label, forbidden) => {
    const policy = contentSecurityPolicy({ sentryDsn: 'https://abc@o42.ingest.sentry.io/1' });

    for (const sources of directives(policy).values()) {
      expect(sources).not.toContain(forbidden);
    }
  });

  it('adds the Sentry ingest origin to connect-src, and nowhere else', () => {
    const policy = contentSecurityPolicy({ sentryDsn: 'https://abc@o42.ingest.sentry.io/1' });
    const found = directives(policy);

    expect(found.get('connect-src')).toEqual(["'self'", 'https://o42.ingest.sentry.io']);
    // The browser SDK sends reports; it never loads code from Sentry.
    expect(found.get('script-src')).toEqual(["'self'"]);
  });

  it('ignores a DSN it cannot parse rather than emitting a broken source', () => {
    expect(directives(contentSecurityPolicy({ sentryDsn: 'nonsense' })).get('connect-src')).toEqual(
      ["'self'"],
    );
  });

  it('upgrades insecure subresource requests', () => {
    expect(directives(contentSecurityPolicy({})).has('upgrade-insecure-requests')).toBe(true);
  });
});

describe('securityHeaders', () => {
  it('returns exactly the headers CLAUDE.md §7 requires', () => {
    expect(Object.keys(securityHeaders({})).sort()).toEqual([...SECURITY_HEADER_NAMES].sort());
  });

  it('names every header in lowercase, as the Headers API stores them', () => {
    for (const name of Object.keys(securityHeaders({}))) {
      expect(name).toBe(name.toLowerCase());
    }
  });

  it('asks browsers for a year of HTTPS, subdomains included', () => {
    // No `preload`: that is a claim about a domain we do not yet control the
    // DNS of, and it is irreversible for months.
    expect(securityHeaders({})['strict-transport-security']).toBe(
      'max-age=31536000; includeSubDomains',
    );
  });

  it('forbids MIME sniffing and trims the referrer', () => {
    const headers = securityHeaders({});

    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  it('denies every browser feature it names', () => {
    const policy = securityHeaders({})['permissions-policy'];
    const features = policy.split(',').map((feature) => feature.trim());

    expect(features.length).toBeGreaterThan(0);
    for (const feature of features) {
      // `feature=()` is the empty allowlist: nobody, not even the site itself.
      expect(feature).toMatch(/^[a-z-]+=\(\)$/);
    }
    expect(features).toContain('geolocation=()');
    expect(features).toContain('camera=()');
    expect(features).toContain('microphone=()');
  });

  it('carries the content security policy it builds', () => {
    const dsn = 'https://abc@o42.ingest.sentry.io/1';

    expect(securityHeaders({ sentryDsn: dsn })['content-security-policy']).toBe(
      contentSecurityPolicy({ sentryDsn: dsn }),
    );
  });
});
