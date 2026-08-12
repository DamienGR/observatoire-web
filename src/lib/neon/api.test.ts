import { describe, expect, it, vi } from 'vitest';
import { NeonApiError, NeonUnavailableError, createNeonClient, type NeonApiDeps } from './api.js';

/**
 * Written before `api.ts`. The transport arrives by injection for the reason
 * `src/lib/ingest/referentials.ts` states — the unit project forbids I/O
 * (CLAUDE.md §5) — plus one specific to this module: `NEON_API_KEY` lives in
 * the repository secrets, so no cloud session can ever run these calls for
 * real. Every behaviour that is not "the API answered 200" is therefore
 * knowable here or nowhere.
 */

const API_KEY = 'neon_api_key_for_tests';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function deps(fetchImpl: typeof fetch): NeonApiDeps & { readonly waits: number[] } {
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

function client(fetchImpl: typeof fetch, injected: NeonApiDeps = deps(fetchImpl)) {
  return createNeonClient({ apiKey: API_KEY }, injected);
}

/** A branch object of the shape the Neon OpenAPI spec describes. */
function branchBody(currentState = 'ready') {
  return {
    id: 'br-holy-grail-123456',
    name: 'ci-pr-42-1000-1',
    created_at: '2026-08-12T09:00:00Z',
    default: false,
    protected: false,
    current_state: currentState,
  };
}

/** A create-branch response of the shape the Neon OpenAPI spec describes. */
function createdBranch(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    branch: branchBody(),
    connection_uris: [
      {
        connection_uri:
          'postgresql://neondb_owner:npg_secret@ep-cool-a1.eu-central-1.aws.neon.tech/neondb?sslmode=require',
        connection_parameters: {
          database: 'neondb',
          password: 'npg_secret',
          role: 'neondb_owner',
          host: 'ep-cool-a1.eu-central-1.aws.neon.tech',
          pooler_host: 'ep-cool-a1-pooler.eu-central-1.aws.neon.tech',
        },
      },
    ],
    ...overrides,
  };
}

function requestOf(fake: ReturnType<typeof vi.fn>, index = 0): { url: string; init: RequestInit } {
  const call = fake.mock.calls[index] as [string, RequestInit] | undefined;
  return { url: call?.[0] ?? '', init: call?.[1] ?? {} };
}

describe('authentication and shape of every request', () => {
  it('sends the key as a bearer token in a header, never in the URL', async () => {
    // CLAUDE.md §8 states the rule for this project's own ops surface, and the
    // reason applies to somebody else's API just as well: a query string ends
    // up in logs and referrers.
    const fake = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse({ projects: [] })));

    await client(fake).listProjects();
    const { url, init } = requestOf(fake);

    expect(url).not.toContain(API_KEY);
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${API_KEY}`);
  });

  it('talks to the documented Neon API host', async () => {
    const fake = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse({ projects: [] })));
    await client(fake).listProjects();

    expect(requestOf(fake).url).toBe('https://console.neon.tech/api/v2/projects');
  });
});

describe('listProjects', () => {
  it('parses the projects it will have to choose between', async () => {
    const fake = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        jsonResponse({
          projects: [{ id: 'shiny-wind-028834', name: 'observatoire-web', region_id: 'aws-eu' }],
        }),
      ),
    );

    await expect(client(fake).listProjects()).resolves.toEqual([
      { id: 'shiny-wind-028834', name: 'observatoire-web' },
    ]);
  });

  it('refuses a payload that does not describe projects', async () => {
    // CLAUDE.md §4: external data is parsed, never cast. A gateway answering
    // HTML with a 200 must not become an empty project list.
    const fake = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse({ projects: 'none' })));

    await expect(client(fake).listProjects()).rejects.toThrow(/unexpected shape/i);
  });
});

describe('listBranches', () => {
  it('parses what the pruner needs, and nothing more', async () => {
    const fake = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        jsonResponse({
          branches: [
            {
              id: 'br-1',
              name: 'main',
              created_at: '2026-01-01T00:00:00Z',
              default: true,
              protected: false,
              current_state: 'ready',
              logical_size: 28,
            },
          ],
        }),
      ),
    );

    await expect(client(fake).listBranches('proj-1')).resolves.toEqual([
      {
        id: 'br-1',
        name: 'main',
        created_at: '2026-01-01T00:00:00Z',
        default: true,
        protected: false,
        current_state: 'ready',
      },
    ]);
    expect(requestOf(fake).url).toBe('https://console.neon.tech/api/v2/projects/proj-1/branches');
  });
});

describe('createBranch', () => {
  it('asks for a read-write compute, without which the branch has no address', async () => {
    const fake = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse(createdBranch(), 201)));

    await client(fake).createBranch('proj-1', 'ci-pr-42-1000-1');
    const { url, init } = requestOf(fake);

    expect(init.method).toBe('POST');
    expect(url).toBe('https://console.neon.tech/api/v2/projects/proj-1/branches');
    expect(JSON.parse(typeof init.body === 'string' ? init.body : '')).toEqual({
      branch: { name: 'ci-pr-42-1000-1' },
      endpoints: [{ type: 'read_write' }],
    });
  });

  it('returns both endpoints, because the job needs both (CLAUDE.md §9)', async () => {
    const fake = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse(createdBranch(), 201)));

    await expect(client(fake).createBranch('proj-1', 'ci-pr-42-1000-1')).resolves.toEqual({
      id: 'br-holy-grail-123456',
      name: 'ci-pr-42-1000-1',
      directUri:
        'postgresql://neondb_owner:npg_secret@ep-cool-a1.eu-central-1.aws.neon.tech/neondb?sslmode=require',
      pooledUri:
        'postgresql://neondb_owner:npg_secret@ep-cool-a1-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require',
    });
  });

  it('derives the pooled endpoint when the API reports no pooler host', async () => {
    const body = createdBranch({
      connection_uris: [
        {
          connection_uri:
            'postgresql://neondb_owner:npg_secret@ep-cool-a1.eu-central-1.aws.neon.tech/neondb',
          connection_parameters: {
            database: 'neondb',
            password: 'npg_secret',
            role: 'neondb_owner',
            host: 'ep-cool-a1.eu-central-1.aws.neon.tech',
          },
        },
      ],
    });
    const fake = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse(body, 201)));

    const branch = await client(fake).createBranch('proj-1', 'ci-pr-42-1000-1');

    expect(branch.pooledUri).toContain('ep-cool-a1-pooler.');
  });

  it('says which case it hit when Neon returns no connection URI at all', async () => {
    // Documented rather than hypothetical: the API omits `connection_uris`
    // when the parent branch holds more than one role or database. The day
    // that happens, "cannot read property of undefined" would send the next
    // session looking in the wrong place.
    const fake = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonResponse(createdBranch({ connection_uris: [] }), 201)),
    );

    await expect(client(fake).createBranch('proj-1', 'ci-pr-42-1000-1')).rejects.toThrow(
      /more than one role or database/i,
    );
  });

  it('never lets a connection string reach an error message', async () => {
    // The branch is throwaway, its credentials are not less of a credential —
    // and a workflow log is public on a public repository (CLAUDE.md §7).
    const body = createdBranch({ branch: { id: 'br-1' } });
    const fake = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse(body, 201)));

    await expect(client(fake).createBranch('proj-1', 'ci-x')).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('npg_secret') }) as Error,
    );
  });
});

describe('deleteBranch', () => {
  it('deletes by id, and treats an already-absent branch as done', async () => {
    // The cleanup step runs `if: always()`, including after a failure that may
    // have deleted the branch already. Idempotence, as CLAUDE.md §8 asks of
    // every operation this project can trigger.
    const fake = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({}, 200))
      .mockResolvedValueOnce(jsonResponse({ message: 'not found' }, 404));

    const neon = client(fake);

    await expect(neon.deleteBranch('proj-1', 'br-1')).resolves.toBeUndefined();
    await expect(neon.deleteBranch('proj-1', 'br-1')).resolves.toBeUndefined();

    const { url, init } = requestOf(fake);
    expect(init.method).toBe('DELETE');
    expect(url).toBe('https://console.neon.tech/api/v2/projects/proj-1/branches/br-1');
  });
});

describe('waitForBranchReady', () => {
  it('returns as soon as the branch reports itself ready', async () => {
    const fake = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse({ branch: branchBody() })));
    const injected = deps(fake);

    await client(fake, injected).waitForBranchReady('proj-1', 'br-1');

    expect(fake).toHaveBeenCalledTimes(1);
    expect(injected.waits).toEqual([]);
  });

  it('waits while the branch is still initialising', async () => {
    const initialising = { branch: branchBody('init') };
    const fake = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(initialising))
      .mockResolvedValueOnce(jsonResponse({ branch: branchBody() }));
    const injected = deps(fake);

    await client(fake, injected).waitForBranchReady('proj-1', 'br-1');

    expect(fake).toHaveBeenCalledTimes(2);
    expect(injected.waits).toHaveLength(1);
  });

  it('gives up by name rather than let the migration meet the failure', async () => {
    const initialising = { branch: branchBody('init') };
    const fake = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse(initialising)));
    const injected = deps(fake);

    await expect(
      client(fake, injected).waitForBranchReady('proj-1', 'br-1', { attempts: 3 }),
    ).rejects.toThrow(/never became ready/i);
    expect(fake).toHaveBeenCalledTimes(3);
  });
});

describe('failure modes', () => {
  it('does not retry a 4xx: the request is wrong, not the moment', async () => {
    const fake = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonResponse({ message: 'branch limit reached' }, 422)),
    );

    await expect(client(fake).createBranch('proj-1', 'ci-x')).rejects.toBeInstanceOf(NeonApiError);
    expect(fake).toHaveBeenCalledTimes(1);
  });

  it("carries the API's own explanation, which is the whole diagnosis", async () => {
    // "HTTP 422" and "you have reached the branch limit" send a reader to two
    // different places, and only one of them is the right one.
    const fake = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonResponse({ message: 'branch limit reached' }, 422)),
    );

    await expect(client(fake).createBranch('proj-1', 'ci-x')).rejects.toThrow(
      /branch limit reached/,
    );
  });

  it('survives an error body that explains nothing', async () => {
    const fake = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response('<html>', { status: 403 })),
    );

    await expect(client(fake).listProjects()).rejects.toThrow(/403/);
  });

  it('retries a 5xx and returns the answer of a later attempt', async () => {
    const fake = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({}, 502))
      .mockResolvedValueOnce(jsonResponse({ projects: [] }));
    const injected = deps(fake);

    await expect(client(fake, injected).listProjects()).resolves.toEqual([]);
    expect(injected.waits).toHaveLength(1);
  });

  it('retries a transport failure too', async () => {
    const fake = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(jsonResponse({ projects: [] }));

    await expect(client(fake, deps(fake)).listProjects()).resolves.toEqual([]);
  });

  it('distinguishes "never answered" from "answered something wrong"', async () => {
    // The distinction the contract suite is built around, applied here: an
    // outage read as a broken client is how a working thing gets "fixed".
    const fake = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse({}, 503)));

    await expect(client(fake, deps(fake)).listProjects()).rejects.toBeInstanceOf(
      NeonUnavailableError,
    );
  });

  it('never puts the API key in an error message', async () => {
    const fake = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse({}, 401)));

    await expect(client(fake).listProjects()).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(API_KEY) }) as Error,
    );
  });
});
