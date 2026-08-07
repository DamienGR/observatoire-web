import { DEFAULT_USER_AGENT } from '../fetch/client.js';
import {
  parseAnnuaireRecords,
  mairiesExportUrl,
  type AnnuaireRecord,
} from '../sources/annuaire.js';
import { communesRequestUrl, parseCommunes, type CommuneRecord } from '../sources/geo.js';

/**
 * The two referential downloads of the ingestion job (docs/brief.md §4).
 *
 * Plain `fetch`, **not** the guarded client of `src/lib/fetch/`, and the
 * distinction is the same one `tests/contract/http.ts` states: that guard exists
 * for URLs a directory hands us, which may point anywhere, including at a cloud
 * metadata endpoint. These two addresses are ours, hard-coded, and government
 * APIs. The URLs the directory hands us are *recorded* by this job and fetched
 * by nobody yet — measuring them is milestone 2, and it will go through the
 * guard.
 *
 * The transport arrives by injection so the retry policy can be exercised
 * without a network or a timer (CLAUDE.md §5: zero I/O in the unit project).
 */

/** Four attempts, then give up. Same policy as the contract suite. */
const ATTEMPTS = 4;
const BACKOFF_MS = [1_000, 4_000, 10_000];

/**
 * Generous: the directory export is 12.7 MB and takes about six seconds from a
 * session container. A referential is downloaded once per run, so patience here
 * costs nothing and impatience costs a whole run.
 */
const DEFAULT_TIMEOUT_MS = 120_000;

export interface ReferentialFetchDeps {
  readonly fetch: typeof fetch;
  /** Injected so backoff can be asserted without waiting for it. */
  readonly wait?: (ms: number) => Promise<void>;
}

export interface ReferentialFetchOptions {
  readonly timeoutMs?: number;
}

/**
 * The payload never arrived. Says nothing about its shape — and the difference
 * matters enough that the contract suite is built around it: an availability
 * failure that gets read as drift is how a schema ends up "fixed" to match an
 * outage.
 */
export class ReferentialUnavailableError extends Error {
  override readonly name = 'ReferentialUnavailableError';
  readonly source: string;

  constructor(source: string, url: string, attempts: number, lastError: string) {
    super(
      `${source} did not answer after ${String(attempts)} attempts (${lastError}).\n` +
        `URL: ${url}\n` +
        'This is an availability failure, not a contract failure: the payload ' +
        'was never observed. Re-run before changing any schema.',
    );
    this.source = source;
  }
}

/** The request itself is wrong. Retrying it would ask the same question again. */
export class ReferentialRequestError extends Error {
  override readonly name = 'ReferentialRequestError';
  readonly source: string;
  readonly status: number;

  constructor(source: string, url: string, status: number) {
    super(
      `${source} rejected the request with HTTP ${String(status)}.\n` +
        `URL: ${url}\n` +
        'A 4xx is our mistake, not an outage: the query is malformed or the ' +
        'endpoint moved. Not retried.',
    );
    this.source = source;
    this.status = status;
  }
}

const defaultWait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Downloads and decodes one referential, retrying what is worth retrying.
 *
 * A body that fails to decode counts as a failed attempt rather than as a
 * parse error: what a gateway returns mid-incident is an HTML page with a 200
 * on it, and calling that "the schema drifted" would be a lie in the direction
 * that costs the most.
 *
 * Third-party bytes never reach the message. A workflow log is public on a
 * public repository, and the point of an error here is the URL and the count,
 * not the payload.
 */
export async function fetchReferentialJson(
  source: string,
  url: string,
  deps: ReferentialFetchDeps,
  options: ReferentialFetchOptions = {},
): Promise<unknown> {
  const wait = deps.wait ?? defaultWait;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let lastError = '';

  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    if (attempt > 0) await wait(BACKOFF_MS[attempt - 1] ?? 10_000);

    try {
      const response = await deps.fetch(url, {
        headers: { 'user-agent': DEFAULT_USER_AGENT, accept: 'application/json' },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (response.status >= 400 && response.status < 500) {
        throw new ReferentialRequestError(source, url, response.status);
      }

      if (!response.ok) {
        lastError = `HTTP ${String(response.status)}`;
        continue;
      }

      // No size cap: unlike a crawled page, this endpoint is ours and its
      // volume is known — 4.2 MB for the referential, 12.7 MB for the
      // directory export, measured on 7 August 2026.
      return JSON.parse(await response.text()) as unknown;
    } catch (error) {
      if (error instanceof ReferentialRequestError) throw error;
      lastError = error instanceof Error ? error.name : 'transport error';
    }
  }

  throw new ReferentialUnavailableError(source, url, ATTEMPTS, lastError);
}

/** The commune referential, parsed through the schema of `src/lib/sources/`. */
export async function fetchCommunes(
  deps: ReferentialFetchDeps,
  options?: ReferentialFetchOptions,
): Promise<CommuneRecord[]> {
  return parseCommunes(
    await fetchReferentialJson('geo.api.gouv.fr', communesRequestUrl(), deps, options),
  );
}

/**
 * Every town-hall record, in one request.
 *
 * The export endpoint rather than the paginated `/records` one: 35 803 records
 * at 100 per page is 358 requests to a government API for data it hands over in
 * a single 12.7 MB answer.
 */
export async function fetchMairies(
  deps: ReferentialFetchDeps,
  options?: ReferentialFetchOptions,
): Promise<AnnuaireRecord[]> {
  return parseAnnuaireRecords(
    await fetchReferentialJson('annuaire', mairiesExportUrl(), deps, options),
  );
}
