import { describe, expect, it } from 'vitest';
import {
  FetchGuardError,
  SsrfBlockedError,
  TooManyRedirectsError,
  type GuardedFetchDeps,
} from '../fetch/index.js';
import {
  collectSignals,
  type SignalsFailure,
  type SignalsCollection,
  type SignalsSuccess,
} from './collect.js';

const PAGE = `<html lang="fr"><body>
  <a href="/mentions-legales">Mentions légales</a>
  <a href="/accessibilite">Accessibilité : non conforme</a>
</body></html>`;

/** A public address, so the SSRF guard lets the fake transport through. */
const deps = (fetch: GuardedFetchDeps['fetch']): GuardedFetchDeps => ({
  resolve: () => Promise.resolve(['93.184.216.34']),
  fetch,
});

const respondWith =
  (
    body: string,
    init: ResponseInit = { headers: { 'content-type': 'text/html; charset=utf-8' } },
  ): GuardedFetchDeps['fetch'] =>
  () =>
    Promise.resolve(new Response(body, init));

function success(collection: SignalsCollection): SignalsSuccess {
  if (!collection.ok) throw new Error(`expected a measurement, got ${collection.errorCode}`);
  return collection;
}

function failure(collection: SignalsCollection): SignalsFailure {
  if (collection.ok) throw new Error('expected a failure, got a measurement');
  return collection;
}

describe('collectSignals', () => {
  it('measures the page the guarded client brought back', async () => {
    const collected = success(
      await collectSignals('https://www.ville-exemple.fr/', deps(respondWith(PAGE))),
    );

    expect(collected.httpStatus).toBe(200);
    expect(collected.finalUrl).toBe('https://www.ville-exemple.fr/');
    expect(collected.signals.hasLegalNotice).toBe(true);
    expect(collected.signals.hasAccessibilityStatement).toBe(true);
  });

  it('never sends a second request: one page, one measurement', async () => {
    const seen: string[] = [];
    const collected = await collectSignals(
      'https://www.ville-exemple.fr/',
      deps((url) => {
        seen.push(url);
        return Promise.resolve(new Response(PAGE, { headers: { 'content-type': 'text/html' } }));
      }),
    );

    // The statement's own page is *not* fetched to read its conformance level.
    // That would double the crawl for a signal the schema does not hold, and
    // docs/brief.md §4 keeps this measurement to one direct fetch.
    expect(collected.ok).toBe(true);
    expect(seen).toEqual(['https://www.ville-exemple.fr/']);
  });

  it.each([
    [500, 'transient-failure'],
    [503, 'transient-failure'],
    [429, 'transient-failure'],
    [408, 'transient-failure'],
    [404, 'permanent-failure'],
    [403, 'permanent-failure'],
    [410, 'permanent-failure'],
  ] as const)('reads HTTP %i as %s', async (status, outcome) => {
    // Measured on the survey: two 503 from a CDN in front of the site and one
    // 500. Both answered the same way twice, but a status the origin emits
    // under load is the case a retry exists for.
    const collected = failure(
      await collectSignals(
        'https://www.ville-exemple.fr/',
        deps(respondWith('nope', { status, headers: { 'content-type': 'text/plain' } })),
      ),
    );

    expect(collected.errorCode).toBe('http-error');
    expect(collected.httpStatus).toBe(status);
    expect(collected.outcome).toBe(outcome);
  });

  it('refuses a body that is not HTML', async () => {
    const collected = failure(
      await collectSignals(
        'https://www.ville-exemple.fr/',
        deps(respondWith('%PDF-1.7', { headers: { 'content-type': 'application/pdf' } })),
      ),
    );

    expect(collected.errorCode).toBe('not-html');
    expect(collected.outcome).toBe('permanent-failure');
  });

  it('refuses a response that declares no content type at all', async () => {
    const collected = failure(
      await collectSignals(
        'https://www.ville-exemple.fr/',
        deps(() => Promise.resolve(new Response(null, { status: 200 }))),
      ),
    );

    expect(collected.errorCode).toBe('not-html');
  });

  it('accepts an XHTML content type, which some of these sites still serve', async () => {
    const collected = await collectSignals(
      'https://www.ville-exemple.fr/',
      deps(respondWith(PAGE, { headers: { 'content-type': 'application/xhtml+xml' } })),
    );

    expect(collected.ok).toBe(true);
  });

  it('refuses a document with no link at all', async () => {
    // Measured: one commune answers 200 with 216 bytes of JavaScript that sets
    // a cookie and reloads, and `<noscript>JavaScript requis. Accès refusé.`
    // Reading that as "this commune publishes no legal notice" would be the
    // false claim CLAUDE.md §11.5 exists to prevent; it is a page we could not
    // read, and the measurement says so.
    const wall = `<script>document.cookie = 'jscheck=1; path=/';</script>
      <noscript>JavaScript requis. Accès refusé.</noscript>`;

    const collected = failure(
      await collectSignals('https://www.ville-exemple.fr/', deps(respondWith(wall))),
    );

    expect(collected.errorCode).toBe('empty-document');
    expect(collected.outcome).toBe('permanent-failure');
  });

  it.each([
    ['AbortError'],
    // What `AbortSignal.timeout` really throws — a DOMException *named*
    // TimeoutError, never the guard's own class. Mapping only the class would
    // have filed every slow site under `network-error`.
    ['TimeoutError'],
  ])('reads a %s as a timeout worth retrying', async (name) => {
    const aborted = Object.assign(new Error('aborted'), { name });
    const collected = failure(
      await collectSignals(
        'https://www.ville-exemple.fr/',
        deps(() => Promise.reject(aborted)),
      ),
    );

    expect(collected.errorCode).toBe('timeout');
    expect(collected.outcome).toBe('transient-failure');
  });

  it('reads a refusal of the guard it does not know by name as permanent', async () => {
    // The guard can grow a refusal this module has never heard of. Whatever it
    // is, it is a refusal: retrying it three more times measures nothing.
    const collected = failure(
      await collectSignals(
        'https://www.ville-exemple.fr/',
        deps(() => Promise.reject(new FetchGuardError('a refusal from a later version'))),
      ),
    );

    expect(collected.outcome).toBe('permanent-failure');
  });

  it('reads a transport failure as transient', async () => {
    const collected = failure(
      await collectSignals(
        'https://www.ville-exemple.fr/',
        deps(() => Promise.reject(new TypeError('fetch failed'))),
      ),
    );

    expect(collected.errorCode).toBe('network-error');
    expect(collected.outcome).toBe('transient-failure');
  });

  it('reads a refusal of the SSRF guard as permanent', async () => {
    const collected = failure(
      await collectSignals(
        'https://www.ville-exemple.fr/',
        deps(() => Promise.reject(new SsrfBlockedError('https://x.fr/', 'loopback', '127.0.0.1'))),
      ),
    );

    expect(collected.errorCode).toBe('blocked-address');
    expect(collected.outcome).toBe('permanent-failure');
    expect(collected.httpStatus).toBeNull();
  });

  it('reads an unusable URL as permanent, without dialling anything', async () => {
    const collected = failure(
      await collectSignals(
        'http://www.ville-exemple.fr/',
        deps(() => {
          throw new Error('the guard should have refused before this');
        }),
      ),
    );

    expect(collected.errorCode).toBe('unsafe-url');
    expect(collected.outcome).toBe('permanent-failure');
  });

  it('follows the directory’s http URLs only when asked to', async () => {
    const collected = success(
      await collectSignals('http://www.ville-exemple.fr/', deps(respondWith(PAGE)), {
        allowHttp: true,
      }),
    );

    expect(collected.usedInsecureScheme).toBe(true);
  });

  it('reads a redirect loop as permanent', async () => {
    const collected = failure(
      await collectSignals(
        'https://www.ville-exemple.fr/',
        deps(() => Promise.reject(new TooManyRedirectsError(['https://www.ville-exemple.fr/'], 3))),
      ),
    );

    expect(collected.errorCode).toBe('too-many-redirects');
    expect(collected.outcome).toBe('permanent-failure');
  });

  it('reads a body over the cap as permanent — the page is that big every time', async () => {
    // Measured: one commune's home page exceeds the 2 MB cap of the client.
    const collected = failure(
      await collectSignals('https://www.ville-exemple.fr/', deps(respondWith(PAGE)), {
        maxBytes: 10,
      }),
    );

    expect(collected.errorCode).toBe('response-too-large');
    expect(collected.outcome).toBe('permanent-failure');
  });

  it('reports where the redirects landed, not where they started', async () => {
    const collected = success(
      await collectSignals(
        'https://www.ville-exemple.fr/',
        deps((url) =>
          Promise.resolve(
            url === 'https://www.ville-exemple.fr/'
              ? new Response('', {
                  status: 301,
                  headers: { location: 'https://ville-exemple.fr/' },
                })
              : new Response(PAGE, { headers: { 'content-type': 'text/html' } }),
          ),
        ),
      ),
    );

    expect(collected.finalUrl).toBe('https://ville-exemple.fr/');
  });
});
