import { describe, expect, it, vi, type MockedFunction } from 'vitest';
import { DEFAULT_USER_AGENT } from '../fetch/index.js';
import {
  ReferentialUnavailableError,
  fetchCommunes,
  fetchMairies,
  fetchReferentialJson,
} from './referentials.js';

/**
 * Written before `referentials.ts`. Transport and waiting arrive by injection,
 * as in `src/lib/fetch/client.ts` and for the same reason: the unit project
 * forbids I/O outright (CLAUDE.md §5), and the retry policy is exactly the part
 * that must not be discovered in production.
 */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function deps(fetchImpl: typeof fetch): {
  fetch: typeof fetch;
  wait: (ms: number) => Promise<void>;
  waits: number[];
} {
  const waits: number[] = [];
  return {
    fetch: fetchImpl,
    wait: (ms: number) => {
      waits.push(ms);
      return Promise.resolve();
    },
    waits,
  };
}

/** The URL of the first call, whatever shape `fetch` accepted it in. */
function requestedUrl(fake: MockedFunction<typeof fetch>): string {
  const input = fake.mock.calls[0]?.[0];
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input?.url ?? '';
}

describe('fetchReferentialJson', () => {
  it('returns the decoded payload of a first successful attempt', async () => {
    const fake = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse([{ code: '01004' }])));

    await expect(
      fetchReferentialJson('geo', 'https://geo.api.gouv.fr/communes', deps(fake)),
    ).resolves.toEqual([{ code: '01004' }]);
    expect(fake).toHaveBeenCalledTimes(1);
  });

  it('announces the project, with a contact URL', async () => {
    // CLAUDE.md §7: "on s'annonce, on ne se cache pas". Same identity as the
    // guarded client, so a government API sees one crawler, not two.
    const fake = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse([])));
    await fetchReferentialJson('geo', 'https://geo.api.gouv.fr/communes', deps(fake));

    const init = fake.mock.calls[0]?.[1] ?? {};
    expect(new Headers(init.headers).get('user-agent')).toBe(DEFAULT_USER_AGENT);
  });

  it('retries a 5xx and returns the payload of a later attempt', async () => {
    // Measured on this very API by the contract suite: geo.api.gouv.fr answered
    // 503 on a request that had succeeded minutes earlier. A job that gave up
    // there would report someone else's bad minute as an ingestion failure.
    const fake = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse([{ code: '01004' }]));

    const injected = deps(fake);

    await expect(
      fetchReferentialJson('geo', 'https://geo.api.gouv.fr/communes', injected),
    ).resolves.toEqual([{ code: '01004' }]);
    expect(injected.waits).toEqual([1_000]);
  });

  it('retries a transport error too', async () => {
    const fake = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(jsonResponse([]));

    await expect(
      fetchReferentialJson('geo', 'https://geo.api.gouv.fr/communes', deps(fake)),
    ).resolves.toEqual([]);
  });

  it('backs off between attempts instead of hammering', async () => {
    const fake = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse({}, 500)));
    const injected = deps(fake);

    await expect(
      fetchReferentialJson('geo', 'https://geo.api.gouv.fr/communes', injected),
    ).rejects.toBeInstanceOf(ReferentialUnavailableError);
    expect(fake).toHaveBeenCalledTimes(4);
    expect(injected.waits).toEqual([1_000, 4_000, 10_000]);
  });

  it('says availability, not drift, when it gives up', async () => {
    // The distinction the contract suite pays for and this job inherits: a
    // payload that never arrived says nothing about the shape of the payload.
    // Confusing the two is how a schema gets "fixed" to match an outage.
    const fake = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse({}, 500)));

    await expect(
      fetchReferentialJson('geo', 'https://geo.api.gouv.fr/communes', deps(fake)),
    ).rejects.toThrow(/did not answer after 4 attempts/);
  });

  it('does not retry a 4xx, which will answer the same way forever', async () => {
    const fake = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonResponse({ error: 'bad where' }, 400)),
    );

    await expect(
      fetchReferentialJson('annuaire', 'https://example.gouv.fr/records', deps(fake)),
    ).rejects.toThrow(/HTTP 400/);
    expect(fake).toHaveBeenCalledTimes(1);
  });

  it('reports a body that is not JSON as an availability failure, not a parse error', async () => {
    // What an HTML error page from a gateway looks like from here.
    const fake = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response('<html>502 Bad Gateway</html>', { status: 200 })),
    );

    await expect(
      fetchReferentialJson('geo', 'https://geo.api.gouv.fr/communes', deps(fake)),
    ).rejects.toBeInstanceOf(ReferentialUnavailableError);
  });

  it('never echoes the payload in its error message', async () => {
    // Third-party bytes end up in a workflow log otherwise (CLAUDE.md §7).
    const fake = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response('secret-looking body', { status: 500 })),
    );

    await expect(
      fetchReferentialJson('geo', 'https://geo.api.gouv.fr/communes', deps(fake)),
    ).rejects.toThrow(/^(?!.*secret-looking).*$/s);
  });
});

describe('fetchCommunes and fetchMairies', () => {
  it('asks geo.api.gouv.fr for the six fields, and parses through the production schema', async () => {
    const fake = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        jsonResponse([
          {
            code: '01004',
            nom: 'Ambérieu-en-Bugey',
            population: 15_934,
            codeDepartement: '01',
            codeRegion: '84',
            codeEpci: '240100883',
          },
        ]),
      ),
    );

    const communes = await fetchCommunes(deps(fake));

    expect(communes).toHaveLength(1);
    expect(communes[0]?.codeInsee).toBe('01004');
    expect(requestedUrl(fake)).toContain('fields=code%2Cnom%2Cpopulation');
  });

  it('asks the directory for town halls in a single export request', async () => {
    // Not the paginated `/records` endpoint: 35 803 records at 100 per page is
    // 358 requests to a government API for data it will hand over in one.
    const fake = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse([])));

    await fetchMairies(deps(fake));

    expect(fake).toHaveBeenCalledTimes(1);
    expect(requestedUrl(fake)).toContain('/exports/json');
  });

  it('parses the bare array the export endpoint returns', async () => {
    const fake = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        jsonResponse([
          {
            id: '00000000-0000-4000-8000-000000000000',
            nom: 'Mairie - Curgy',
            code_insee_commune: '71162',
            site_internet: '[{"libelle": "", "valeur": "https://www.curgy.fr/"}]',
            pivot: '[{"type_service_local": "mairie", "code_insee_commune": ["71162"]}]',
            statut_de_diffusion: 'true',
            date_modification_datetime: '2026-01-01T00:00:00+00:00',
          },
        ]),
      ),
    );

    const records = await fetchMairies(deps(fake));

    expect(records[0]?.urls).toEqual(['https://www.curgy.fr/']);
  });
});
