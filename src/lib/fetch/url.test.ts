import { describe, expect, it } from 'vitest';
import { checkUrl, type UrlAccepted, type UrlCheck, type UrlRejected } from './url.js';

/**
 * `UrlCheck` is a discriminated union, so a test that reads `reason` has to say
 * first that it expected a refusal. These two helpers make that assertion
 * rather than reach past it with `?.` — which is the whole point of the change:
 * the shape used to let a caller read `reason` off an acceptance and get
 * `undefined` without anything complaining.
 */
function rejection(check: UrlCheck): UrlRejected {
  if (check.ok) throw new Error('expected the guard to refuse this URL, and it accepted');
  return check;
}

function acceptance(check: UrlCheck): UrlAccepted {
  if (!check.ok) throw new Error(`expected the guard to accept this URL: ${check.detail}`);
  return check;
}

describe('checkUrl — scheme', () => {
  it('accepts https', () => {
    expect(checkUrl('https://www.ville-exemple.fr/').ok).toBe(true);
  });

  it('rejects http unless the fallback is explicitly asked for', () => {
    const rejected = rejection(checkUrl('http://www.ville-exemple.fr/'));

    expect(rejected.ok).toBe(false);
    expect(rejected.reason).toBe('forbidden-scheme');
  });

  it('accepts http only through the explicit fallback', () => {
    expect(checkUrl('http://www.ville-exemple.fr/', { allowHttp: true }).ok).toBe(true);
  });

  it.each([
    ['file:///etc/passwd'],
    ['gopher://example.org/'],
    ['ftp://example.org/'],
    ['data:text/html,hello'],
    ['javascript:alert(1)'],
    ['blob:https://example.org/uuid'],
  ])('rejects %s whatever the options say', (raw) => {
    expect(rejection(checkUrl(raw, { allowHttp: true })).reason).toBe('forbidden-scheme');
  });
});

describe('checkUrl — credentials in the URL', () => {
  // §7: no credential is ever transmitted. A URL carrying userinfo is refused
  // rather than stripped: stripping silently changes what was asked for.
  it.each([
    ['https://user@example.org/'],
    ['https://user:secret@example.org/'],
    ['https://:secret@example.org/'],
  ])('rejects %s', (raw) => {
    expect(rejection(checkUrl(raw)).reason).toBe('embedded-credentials');
  });

  it('never repeats the credential in the rejection detail', () => {
    const rejected = checkUrl('https://user:hunter2@example.org/');

    expect(JSON.stringify(rejected)).not.toContain('hunter2');
  });
});

describe('checkUrl — malformed input', () => {
  it.each([[''], ['not a url'], ['https://'], ['://example.org'], ['   ']])('rejects %s', (raw) => {
    expect(checkUrl(raw).ok).toBe(false);
  });
});

describe('checkUrl — IP literals are judged without asking DNS', () => {
  it.each([
    ['https://127.0.0.1/', 'loopback'],
    ['https://169.254.169.254/latest/meta-data/', 'cloud-metadata'],
    ['https://192.168.1.1/', 'private'],
    ['https://[::1]/', 'loopback'],
    ['https://[::ffff:169.254.169.254]/', 'cloud-metadata'],
  ])('rejects %s as %s', (raw, category) => {
    const rejected = rejection(checkUrl(raw));

    expect(rejected.reason).toBe('blocked-address');
    expect(rejected.address?.category).toBe(category);
  });

  it('normalises an IPv4 address written as a single integer', () => {
    // The WHATWG parser turns http://2130706433/ into 127.0.0.1. Pinned by a
    // test because the guard depends on that normalisation happening.
    const rejected = rejection(checkUrl('https://2130706433/'));

    expect(rejected.reason).toBe('blocked-address');
    expect(rejected.address?.effectiveAddress).toBe('127.0.0.1');
  });

  it('normalises an IPv4 address written in hex', () => {
    expect(rejection(checkUrl('https://0x7f000001/')).address?.effectiveAddress).toBe('127.0.0.1');
  });

  it('allows a public IP literal', () => {
    expect(checkUrl('https://1.1.1.1/').ok).toBe(true);
  });
});

describe('checkUrl — reserved hostnames', () => {
  // These never resolve publicly. Refusing them before DNS costs nothing and
  // removes a whole class of "it only failed in production" surprises.
  it.each([
    ['https://localhost/'],
    ['https://LOCALHOST/'],
    ['https://api.localhost/'],
    ['https://something.local/'],
    ['https://metadata.internal/'],
    ['https://box.home.arpa/'],
  ])('rejects %s', (raw) => {
    expect(rejection(checkUrl(raw)).reason).toBe('reserved-hostname');
  });

  it('does not reject a public hostname that merely contains a reserved word', () => {
    expect(checkUrl('https://localhost.ville-exemple.fr/').ok).toBe(true);
    expect(checkUrl('https://mairie-internal.fr/').ok).toBe(true);
  });
});

describe('checkUrl — output', () => {
  it('returns a parsed URL the caller can use directly', () => {
    const checked = acceptance(checkUrl('https://www.ville-exemple.fr/accessibilite?a=1#b'));

    // No `?.` any more: an accepted check carries a URL, and the type says so.
    expect(checked.url.hostname).toBe('www.ville-exemple.fr');
    expect(checked.url.pathname).toBe('/accessibilite');
    expect(checked.url.search).toBe('?a=1');
  });
});
