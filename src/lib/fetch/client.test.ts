import { describe, expect, it, vi } from 'vitest';
import { guardedFetch } from './client.js';
import type { AuditEvent, FetchLike, GuardedFetchDeps } from './client.js';
import {
  SsrfBlockedError,
  ResponseTooLargeError,
  TooManyRedirectsError,
  TimeoutError,
} from './errors.js';

/**
 * The client is exercised entirely through injected dependencies. That is not
 * a testing convenience: the unit project forbids I/O outright (CLAUDE.md §5),
 * so a client that could only be tested against a socket would have no unit
 * tests at all — and this is the one module where that would be unacceptable.
 */

const PUBLIC_IP = '93.184.216.34';

function deps(overrides: Partial<GuardedFetchDeps> = {}): GuardedFetchDeps {
  return {
    resolve: () => Promise.resolve([PUBLIC_IP]),
    fetch: () => Promise.resolve(new Response('ok', { status: 200 })),
    now: () => 0,
    ...overrides,
  };
}

function redirectTo(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

describe('guardedFetch — happy path', () => {
  it('returns the body, the status and the final URL', async () => {
    const outcome = await guardedFetch('https://www.ville-exemple.fr/', deps());

    expect(outcome.status).toBe(200);
    expect(outcome.body).toBe('ok');
    expect(outcome.url).toBe('https://www.ville-exemple.fr/');
    expect(outcome.redirects).toEqual([]);
  });
});

describe('guardedFetch — outbound request shape (§7)', () => {
  it('announces the project and a contact URL', async () => {
    const fetchSpy = vi.fn<FetchLike>(() => Promise.resolve(new Response('ok')));
    await guardedFetch('https://www.ville-exemple.fr/', deps({ fetch: fetchSpy }));

    const init = fetchSpy.mock.calls[0]?.[1];
    if (init === undefined) expect.unreachable('fetch was never called');
    const userAgent = new Headers(init.headers).get('user-agent') ?? '';

    expect(userAgent).toContain('observatoire-web');
    expect(userAgent).toMatch(/https?:\/\//);
  });

  it('omits credentials and follows no redirect on its own', async () => {
    const fetchSpy = vi.fn<FetchLike>(() => Promise.resolve(new Response('ok')));
    await guardedFetch('https://www.ville-exemple.fr/', deps({ fetch: fetchSpy }));

    const init = fetchSpy.mock.calls[0]?.[1];
    if (init === undefined) expect.unreachable('fetch was never called');

    expect(init.credentials).toBe('omit');
    // Redirects are followed by hand so every hop can be re-checked.
    expect(init.redirect).toBe('manual');
  });

  it('sends no cookie and no authorization header', async () => {
    const fetchSpy = vi.fn<FetchLike>(() => Promise.resolve(new Response('ok')));
    await guardedFetch('https://www.ville-exemple.fr/', deps({ fetch: fetchSpy }));

    const headers = new Headers(fetchSpy.mock.calls[0]?.[1].headers);

    expect(headers.get('cookie')).toBeNull();
    expect(headers.get('authorization')).toBeNull();
  });

  it.each([['authorization'], ['cookie'], ['proxy-authorization']])(
    'refuses to send a caller-supplied %s header',
    async (header) => {
      await expect(
        guardedFetch('https://www.ville-exemple.fr/', deps(), {
          headers: { [header]: 'whatever' },
        }),
      ).rejects.toThrow(/forbidden header/i);
    },
  );
});

describe('guardedFetch — headers the caller may set', () => {
  it('passes through a header that is not on the forbidden list', async () => {
    const fetchSpy = vi.fn<FetchLike>(() => Promise.resolve(new Response('ok')));

    await guardedFetch('https://www.ville-exemple.fr/', deps({ fetch: fetchSpy }), {
      headers: { accept: 'text/html' },
    });

    expect(new Headers(fetchSpy.mock.calls[0]?.[1].headers).get('accept')).toBe('text/html');
  });
});

describe('guardedFetch — address checks', () => {
  it('rejects an IP literal without asking the resolver anything', async () => {
    const resolve = vi.fn(() => Promise.resolve([PUBLIC_IP]));

    await expect(
      guardedFetch('https://169.254.169.254/latest/meta-data/', deps({ resolve })),
    ).rejects.toThrow(SsrfBlockedError);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('rejects a redirect that lands on a blocked IP literal', async () => {
    const fetchImpl = (input: string | URL): Promise<Response> =>
      String(input).includes('ville-exemple')
        ? Promise.resolve(redirectTo('https://169.254.169.254/latest/'))
        : Promise.resolve(new Response('secrets'));

    await expect(
      guardedFetch('https://www.ville-exemple.fr/', deps({ fetch: fetchImpl })),
    ).rejects.toThrow(SsrfBlockedError);
  });

  it('rejects a hostname resolving to a private address', async () => {
    await expect(
      guardedFetch(
        'https://intranet.ville-exemple.fr/',
        deps({ resolve: () => Promise.resolve(['10.0.0.5']) }),
      ),
    ).rejects.toThrow(SsrfBlockedError);
  });

  it('rejects when any resolved address is blocked, not only the first', async () => {
    // DNS round-robin makes "the first address" a coin toss. Checking one and
    // connecting to another is the whole bug.
    await expect(
      guardedFetch(
        'https://mixed.ville-exemple.fr/',
        deps({ resolve: () => Promise.resolve([PUBLIC_IP, '127.0.0.1']) }),
      ),
    ).rejects.toThrow(SsrfBlockedError);
  });

  it('rejects a hostname that resolves to nothing', async () => {
    await expect(
      guardedFetch(
        'https://nowhere.ville-exemple.fr/',
        deps({ resolve: () => Promise.resolve([]) }),
      ),
    ).rejects.toThrow(SsrfBlockedError);
  });

  it('names the category and the effective address on the error', async () => {
    const failure = await guardedFetch(
      'https://meta.ville-exemple.fr/',
      deps({ resolve: () => Promise.resolve(['169.254.169.254']) }),
    ).then(
      () => null,
      (error: unknown) => error as SsrfBlockedError,
    );

    expect(failure?.category).toBe('cloud-metadata');
    expect(failure?.effectiveAddress).toBe('169.254.169.254');
  });
});

describe('guardedFetch — redirects', () => {
  it('re-checks the address after a redirect, which is the classic bypass', async () => {
    // The first host is public and the second is not. A guard that only checks
    // the URL it was handed lets this through.
    const resolve = (hostname: string): Promise<string[]> =>
      Promise.resolve(hostname === 'www.ville-exemple.fr' ? [PUBLIC_IP] : ['169.254.169.254']);

    const fetchImpl = (input: string | URL): Promise<Response> =>
      String(input).includes('www.ville-exemple.fr')
        ? Promise.resolve(redirectTo('https://metadata.ville-exemple.fr/latest/'))
        : Promise.resolve(new Response('secrets'));

    await expect(
      guardedFetch('https://www.ville-exemple.fr/', deps({ resolve, fetch: fetchImpl })),
    ).rejects.toThrow(SsrfBlockedError);
  });

  it('re-checks the scheme after a redirect', async () => {
    const fetchImpl = (input: string | URL): Promise<Response> =>
      String(input).startsWith('https://www.')
        ? Promise.resolve(redirectTo('file:///etc/passwd'))
        : Promise.resolve(new Response('nope'));

    await expect(
      guardedFetch('https://www.ville-exemple.fr/', deps({ fetch: fetchImpl })),
    ).rejects.toThrow(/scheme/i);
  });

  it('resolves a relative Location against the current URL', async () => {
    let hop = 0;
    const fetchImpl = (): Promise<Response> => {
      hop += 1;
      return hop === 1
        ? Promise.resolve(redirectTo('/accessibilite'))
        : Promise.resolve(new Response('page'));
    };

    const outcome = await guardedFetch(
      'https://www.ville-exemple.fr/a/b',
      deps({ fetch: fetchImpl }),
    );

    expect(outcome.url).toBe('https://www.ville-exemple.fr/accessibilite');
    expect(outcome.redirects).toEqual(['https://www.ville-exemple.fr/a/b']);
  });

  it('follows at most three redirects', async () => {
    let hop = 0;
    const fetchImpl = (): Promise<Response> => {
      hop += 1;
      return Promise.resolve(redirectTo(`https://www.ville-exemple.fr/${String(hop)}`));
    };

    await expect(
      guardedFetch('https://www.ville-exemple.fr/', deps({ fetch: fetchImpl })),
    ).rejects.toThrow(TooManyRedirectsError);
    expect(hop).toBe(4); // the initial request plus three followed hops
  });

  it('treats a redirect without a Location header as the final response', async () => {
    const outcome = await guardedFetch(
      'https://www.ville-exemple.fr/',
      deps({ fetch: () => Promise.resolve(new Response('body', { status: 302 })) }),
    );

    expect(outcome.status).toBe(302);
  });
});

describe('guardedFetch — response size cap', () => {
  it('rejects a body that exceeds the cap while it is being read', async () => {
    const body = 'x'.repeat(5_000);

    await expect(
      guardedFetch(
        'https://www.ville-exemple.fr/',
        deps({ fetch: () => Promise.resolve(new Response(body)) }),
        {
          maxBytes: 1_000,
        },
      ),
    ).rejects.toThrow(ResponseTooLargeError);
  });

  it('rejects on an oversized content-length without reading the body at all', async () => {
    const response = new Response('short', { headers: { 'content-length': '999999999' } });

    await expect(
      guardedFetch(
        'https://www.ville-exemple.fr/',
        deps({ fetch: () => Promise.resolve(response) }),
        {
          maxBytes: 1_000,
        },
      ),
    ).rejects.toThrow(ResponseTooLargeError);
  });

  it('accepts a body exactly at the cap', async () => {
    const outcome = await guardedFetch(
      'https://www.ville-exemple.fr/',
      deps({ fetch: () => Promise.resolve(new Response('x'.repeat(1_000))) }),
      { maxBytes: 1_000 },
    );

    expect(outcome.body).toHaveLength(1_000);
  });
});

describe('guardedFetch — deadline', () => {
  it('gives up once the overall deadline has passed', async () => {
    let clock = 0;
    const fetchImpl = (): Promise<Response> => {
      clock += 9_000; // each hop eats most of the budget
      return Promise.resolve(redirectTo('https://www.ville-exemple.fr/next'));
    };

    await expect(
      guardedFetch('https://www.ville-exemple.fr/', deps({ fetch: fetchImpl, now: () => clock }), {
        timeoutMs: 10_000,
      }),
    ).rejects.toThrow(TimeoutError);
  });
});

describe('guardedFetch — the http fallback is explicit and logged', () => {
  it('refuses http by default', async () => {
    await expect(guardedFetch('http://www.ville-exemple.fr/', deps())).rejects.toThrow(/scheme/i);
  });

  it('accepts http when asked, and records it', async () => {
    const events: AuditEvent[] = [];

    const outcome = await guardedFetch('http://www.ville-exemple.fr/', deps(), {
      allowHttp: true,
      onAudit: (event) => events.push(event),
    });

    expect(outcome.usedInsecureScheme).toBe(true);
    expect(events.map((event) => event.type)).toContain('insecure-scheme');
  });

  it('does not flag https as insecure', async () => {
    const outcome = await guardedFetch('https://www.ville-exemple.fr/', deps(), {
      allowHttp: true,
    });

    expect(outcome.usedInsecureScheme).toBe(false);
  });
});

describe('guardedFetch — audit trail', () => {
  it('reports a blocked address as an audit event', async () => {
    const events: AuditEvent[] = [];

    await guardedFetch(
      'https://intranet.ville-exemple.fr/',
      deps({ resolve: () => Promise.resolve(['10.0.0.5']) }),
      { onAudit: (event) => events.push(event) },
    ).catch(() => undefined);

    expect(events.map((event) => event.type)).toContain('blocked');
  });

  it('never puts a response body in an audit event', async () => {
    const events: AuditEvent[] = [];

    await guardedFetch('https://www.ville-exemple.fr/', deps(), {
      onAudit: (event) => events.push(event),
    });

    expect(JSON.stringify(events)).not.toContain('ok');
  });
});
