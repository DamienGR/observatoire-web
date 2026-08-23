import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_INDISPONIBLE,
  PAGE_ABSENTE,
  PARIS,
  readPsiFixture,
} from '../../../tests/unit/helpers/psi-fixtures.js';
import { measureWithPsi, type PsiFetchDeps } from './collect.js';

const KEY = 'AIzaSyExampleKeyNotReal000000000000000000';

/**
 * The transport is a fake, and the unit project would refuse a real one
 * (tests/setup/no-io.ts). What it returns is the frozen capture, so these tests
 * exercise the wiring against payloads nobody invented.
 */
function respondWith(
  body: unknown,
  status = 200,
): PsiFetchDeps & { calls: string[]; inits: (RequestInit | undefined)[] } {
  const calls: string[] = [];
  const inits: (RequestInit | undefined)[] = [];

  return {
    calls,
    inits,
    fetch: (input: string, init?: RequestInit) => {
      calls.push(input);
      inits.push(init);
      return Promise.resolve(
        new Response(typeof body === 'string' ? body : JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      );
    },
  };
}

function throwing(error: unknown): PsiFetchDeps {
  return {
    // Thrown rather than handed to `Promise.reject`, so that a non-Error value
    // travels the same path a real transport failure would.
    fetch: () => {
      throw error;
    },
  };
}

describe('measureWithPsi, on a report', () => {
  it('returns the measurement of the frozen capture', async () => {
    const result = await measureWithPsi(
      'https://www.paris.fr/',
      KEY,
      respondWith(readPsiFixture(PARIS)),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.apiStatus).toBe(200);
    expect(result.measurement.accessibilityScore).toBe(90);
    expect(result.measurement.findings).toHaveLength(3);
  });

  it('asks for the target it was given, with the key it was given', async () => {
    const deps = respondWith(readPsiFixture(PARIS));
    await measureWithPsi('https://www.paris.fr/', KEY, deps);

    const asked = new URL(deps.calls[0] ?? '');
    expect(asked.searchParams.get('url')).toBe('https://www.paris.fr/');
    expect(asked.searchParams.get('key')).toBe(KEY);
    expect(asked.searchParams.get('strategy')).toBe('mobile');
  });

  /**
   * §7: we announce ourselves on every outgoing request, and we do not hide.
   */
  it('names the project in the user agent it sends', async () => {
    const deps = respondWith(readPsiFixture(PARIS));
    await measureWithPsi('https://www.paris.fr/', KEY, deps);

    const headers = deps.inits[0]?.headers as Record<string, string> | undefined;
    expect(headers?.['user-agent']).toContain('observatoire-web');
    expect(headers?.['user-agent']).toContain('github.com/DamienGR/observatoire-web');
  });

  it('passes a chosen strategy through', async () => {
    const deps = respondWith(readPsiFixture(PARIS));
    await measureWithPsi('https://www.paris.fr/', KEY, deps, { strategy: 'desktop' });

    expect(new URL(deps.calls[0] ?? '').searchParams.get('strategy')).toBe('desktop');
  });

  /**
   * The whole point of reading the document status: this payload is a complete,
   * healthy report *of a 404 page*. Publishing its 95 as the commune's would be
   * a false statement about a site nobody measured (CLAUDE.md §11.5).
   */
  it('refuses a report whose document answered 404', async () => {
    const result = await measureWithPsi(
      'https://www.paris.fr/absente',
      KEY,
      respondWith(readPsiFixture(PAGE_ABSENTE)),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe('psi-target-http-error');
    expect(result.outcome).toBe('permanent-failure');
    expect(result.httpStatus).toBe(404);
    expect(result.apiStatus).toBe(200);
    expect(result.detail).toBe('the document answered 404');
    // One commune's URL being wrong says nothing about the next one's.
    expect(result.fatalForRun).toBe(false);
  });

  it.each([201, 204, 299])('accepts a document that answered %i', async (status) => {
    const payload = readPsiFixture(PARIS) as {
      lighthouseResult: { audits: Record<string, { details?: { items?: unknown[] } }> };
    };
    const requests = payload.lighthouseResult.audits['network-requests'];
    if (requests?.details === undefined) throw new Error('expected the network-requests audit');
    requests.details.items = [{ url: 'https://www.paris.fr/', statusCode: status }];

    const result = await measureWithPsi('https://www.paris.fr/', KEY, respondWith(payload));

    expect(result.ok).toBe(true);
  });

  it.each([300, 199])('refuses a document that answered %i', async (status) => {
    const payload = readPsiFixture(PARIS) as {
      lighthouseResult: { audits: Record<string, { details?: { items?: unknown[] } }> };
    };
    const requests = payload.lighthouseResult.audits['network-requests'];
    if (requests?.details === undefined) throw new Error('expected the network-requests audit');
    requests.details.items = [{ url: 'https://www.paris.fr/', statusCode: status }];

    const result = await measureWithPsi('https://www.paris.fr/', KEY, respondWith(payload));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe('psi-target-http-error');
  });

  it('measures a site whose report carries no request list at all', async () => {
    const payload = readPsiFixture(PARIS) as {
      lighthouseResult: { audits: Record<string, unknown> };
    };
    delete payload.lighthouseResult.audits['network-requests'];

    const result = await measureWithPsi('https://www.paris.fr/', KEY, respondWith(payload));

    // Null is *not measured*, and a measurement is not withheld for it: the
    // scores are real, and `http_status` is nullable for exactly this.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.measurement.httpStatus).toBeNull();
  });

  it('refuses a report Lighthouse itself disowns', async () => {
    const payload = readPsiFixture(PARIS) as {
      lighthouseResult: { runtimeError?: { code: string; message: string } };
    };
    payload.lighthouseResult.runtimeError = { code: 'NO_FCP', message: 'nothing painted' };

    const result = await measureWithPsi('https://www.paris.fr/', KEY, respondWith(payload));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe('psi-runtime-error');
    expect(result.outcome).toBe('transient-failure');
    expect(result.detail).toBe('NO_FCP');
    expect(result.apiStatus).toBe(200);
  });

  it('refuses a report whose metric units moved, rather than storing seconds as milliseconds', async () => {
    const payload = readPsiFixture(PARIS) as {
      lighthouseResult: { audits: Record<string, { numericUnit?: string }> };
    };
    const audit = payload.lighthouseResult.audits['largest-contentful-paint'];
    if (audit === undefined) throw new Error('expected the LCP audit');
    audit.numericUnit = 'second';

    const result = await measureWithPsi('https://www.paris.fr/', KEY, respondWith(payload));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe('psi-unreadable-report');
    expect(result.outcome).toBe('permanent-failure');
    expect(result.fatalForRun).toBe(true);
    expect(result.apiStatus).toBe(200);
    expect(result.detail).toContain('PsiPayloadError');
  });
});

describe('measureWithPsi, on an error the API returns', () => {
  it('reads the captured document failure as transient', async () => {
    const result = await measureWithPsi(
      'https://www.ville-lunel.fr/',
      KEY,
      respondWith(readPsiFixture(DOCUMENT_INDISPONIBLE), 400),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe('psi-document-unavailable');
    expect(result.outcome).toBe('transient-failure');
    expect(result.apiStatus).toBe(400);
    expect(result.httpStatus).toBeNull();
    expect(result.detail).toContain('FAILED_DOCUMENT_REQUEST');
  });

  it('never lets the key reach the line an operator will read', async () => {
    const result = await measureWithPsi(
      'https://ville.fr/',
      KEY,
      respondWith({ error: { code: 400, message: `refused key=${KEY}` } }, 400),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).not.toContain(KEY);
    expect(result.detail).toContain('REDACTED');
  });

  it('keeps the operator’s line short, whatever the API had to say', async () => {
    const result = await measureWithPsi(
      'https://ville.fr/',
      KEY,
      respondWith({ error: { code: 400, message: 'x'.repeat(5_000) } }, 400),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toHaveLength(200);
  });

  it('reads a spent quota as a reason to stop the whole run', async () => {
    const result = await measureWithPsi(
      'https://ville.fr/',
      KEY,
      respondWith({ error: { code: 429, message: 'Quota exceeded' } }, 429),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe('psi-quota-exceeded');
    expect(result.fatalForRun).toBe(true);
  });

  it('reports the status when the body is an error page rather than JSON', async () => {
    const result = await measureWithPsi(
      'https://ville.fr/',
      KEY,
      respondWith('<html>502</html>', 502),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe('psi-server-error');
    expect(result.outcome).toBe('transient-failure');
    expect(result.apiStatus).toBe(502);
  });

  it('refuses a report served under a failing status', async () => {
    const result = await measureWithPsi(
      'https://www.paris.fr/',
      KEY,
      respondWith(readPsiFixture(PARIS), 500),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe('psi-server-error');
    expect(result.apiStatus).toBe(500);
  });
});

describe('measureWithPsi, on a payload or a transport that will not cooperate', () => {
  it('reads an unparsable 200 as a permanent, loud failure', async () => {
    const result = await measureWithPsi('https://ville.fr/', KEY, respondWith('not json at all'));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe('psi-unreadable-report');
    expect(result.outcome).toBe('permanent-failure');
    // A syntax error is a bad gateway's doing, not a schema drift: it does not
    // stop the run the way a shape everyone will hit does.
    expect(result.fatalForRun).toBe(false);
    expect(result.apiStatus).toBe(200);
    expect(result.detail).toContain('SyntaxError');
  });

  it('reads a shape no schema recognises as a reason to stop the run', async () => {
    const result = await measureWithPsi('https://ville.fr/', KEY, respondWith({ nothing: true }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe('psi-unreadable-report');
    expect(result.fatalForRun).toBe(true);
    expect(result.detail).toContain('PsiPayloadError');
  });

  it.each([
    ['an abort', Object.assign(new Error('aborted'), { name: 'AbortError' })],
    ['a deadline', Object.assign(new Error('timed out'), { name: 'TimeoutError' })],
  ])('reads %s as a timeout worth retrying', async (_case, error) => {
    const result = await measureWithPsi('https://ville.fr/', KEY, throwing(error));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe('psi-timeout');
    expect(result.outcome).toBe('transient-failure');
    // A deadline on one commune says nothing about the next one.
    expect(result.fatalForRun).toBe(false);
  });

  it('reads any other transport failure as transient', async () => {
    const result = await measureWithPsi(
      'https://ville.fr/',
      KEY,
      throwing(new TypeError('fetch failed')),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe('psi-network-error');
    expect(result.outcome).toBe('transient-failure');
  });

  it('redacts the key out of a transport failure too', async () => {
    const result = await measureWithPsi(
      'https://ville.fr/',
      KEY,
      throwing(new TypeError(`connect ECONNREFUSED for key=${KEY}`)),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).not.toContain(KEY);
  });

  it('never sends a request for a target it refuses to build', async () => {
    const deps = respondWith(readPsiFixture(PARIS));
    const result = await measureWithPsi('javascript:alert(1)', KEY, deps);

    expect(deps.calls).toEqual([]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe('psi-target-refused');
    expect(result.outcome).toBe('permanent-failure');
    expect(result.fatalForRun).toBe(false);
    expect(result.detail).toContain('InvalidPsiTargetError');
  });

  it('keeps a transport failure’s line as short as an API message’s', async () => {
    const result = await measureWithPsi(
      'https://ville.fr/',
      KEY,
      throwing(new TypeError('x'.repeat(5_000))),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toHaveLength(200);
  });

  it('survives a transport that rejects with something that is not an Error', async () => {
    const result = await measureWithPsi('https://ville.fr/', KEY, throwing('just a string'));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe('psi-network-error');
    expect(result.detail).toBe('unknown error');
  });

  it('says nothing rather than an empty line when the API gives no message', async () => {
    const result = await measureWithPsi(
      'https://ville.fr/',
      KEY,
      respondWith({ error: { code: 400 } }, 400),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toBeNull();
  });

  it('lets an error that is not about the target through, rather than mislabelling it', async () => {
    const boom = new Error('something else entirely');

    await expect(
      measureWithPsi('https://ville.fr/', KEY, {
        fetch: () => {
          throw boom;
        },
      }),
    ).resolves.toMatchObject({ errorCode: 'psi-network-error' });
  });
});
