import { lookup } from 'node:dns/promises';
import type { GuardedFetchDeps } from './client.js';

export { classifyAddress, isAllowedAddress, parseIpAddress } from './address.js';
export type { AddressCategory, AddressEmbedding, AddressVerdict } from './address.js';
export { checkUrl } from './url.js';
export type { CheckUrlOptions, UrlCheck, UrlRejectionReason } from './url.js';
export { DEFAULT_USER_AGENT, guardedFetch } from './client.js';
export type {
  AuditEvent,
  FetchLike,
  FetchOutcome,
  GuardedFetchDeps,
  GuardedFetchOptions,
} from './client.js';
export {
  FetchGuardError,
  ResponseTooLargeError,
  SsrfBlockedError,
  TimeoutError,
  TooManyRedirectsError,
  UnsafeUrlError,
} from './errors.js';

/**
 * Real transport and real DNS. Everything above this line is pure and unit
 * tested; this is the only place that touches the outside world, which is why
 * it is three lines long.
 *
 * `lookup` rather than `resolve4`/`resolve6` on purpose: it goes through the
 * same OS resolver path `fetch` will use, so the addresses we judge are the
 * addresses it would dial. The bypass-resistant-looking alternatives ignore
 * /etc/hosts and would judge something else.
 *
 * KNOWN RESIDUE — DNS rebinding. We resolve, judge, then hand the *hostname*
 * back to fetch, which resolves again. A record whose TTL expires between the
 * two answers can return a public address to the guard and a private one to
 * the connection. Closing this means dialling the checked IP directly with a
 * pinned Host header and a custom dispatcher. Recorded in docs/roadmap.md
 * rather than half-solved here: a partial mitigation that looks complete is
 * worse than a documented gap.
 */
export function createDefaultDeps(): GuardedFetchDeps {
  return {
    resolve: async (hostname: string): Promise<readonly string[]> => {
      const records = await lookup(hostname, { all: true, verbatim: true });
      return records.map((record) => record.address);
    },
    fetch: (input, init) => fetch(input, init),
  };
}
