import type { ResolutionReason, StatutResolution } from './states.js';

/**
 * From one observation to one decision.
 *
 * The module answers a single question — *what does this fetch mean for the
 * state of this URL* — and it answers it without knowing how the fetch was
 * made. That is what lets the scan job stay a loop with no judgement in it, and
 * what lets every rule below be unit tested with no network at all (§5).
 *
 * The hard part is not the mapping, it is the third outcome. A verdict is not
 * only "verified" or "invalid": most of the interesting statuses mean *try
 * again later* or *a human has to look*. Collapsing those two into `invalide`
 * is how an observatory ends up publishing "no website" about a commune whose
 * server was restarting.
 */

/** What the guarded client (`src/lib/fetch/`) can fail with. */
export type FetchFailure =
  | 'ssrf-blocked'
  | 'unsafe-url'
  | 'too-many-redirects'
  | 'response-too-large'
  | 'timeout'
  | 'network';

export type Observation =
  | {
      readonly kind: 'response';
      readonly requestedUrl: string;
      /** Where the redirect chain ended — the client follows them itself. */
      readonly finalUrl: string;
      readonly status: number;
    }
  | {
      readonly kind: 'failure';
      readonly requestedUrl: string;
      readonly failure: FetchFailure;
    };

export type Verdict =
  | {
      readonly decision: 'transition';
      readonly to: StatutResolution;
      readonly reason: ResolutionReason;
      /** The URL that answered, when one did. Null after a transport failure. */
      readonly resolvedUrl: string | null;
      /** The answer came from another host than the one requested. */
      readonly movedHost: boolean;
    }
  | { readonly decision: 'retry'; readonly reason: ResolutionReason };

export interface RetryPolicy {
  /** Attempts already spent on this URL, `measurement.attempts` in the schema. */
  readonly attempts: number;
  readonly maxAttempts?: number;
}

/**
 * Three, not a rounder number: the PSI-side lesson of the brief (§4) is that a
 * third party under strain answers 500 for minutes, not seconds. A fourth
 * attempt in the same run would still be inside the same outage, so the useful
 * next step is to stop and let a human — or the next run — see it.
 */
export const DEFAULT_MAX_ATTEMPTS = 3;

/** Comparable form of a host: lowercase, no port, no `www.`. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Whether two URLs are served by the same host, `www.` aside.
 *
 * Not a public-suffix comparison, and not an attempt at one: `mairie.x.fr` and
 * `x.fr` may well be the same organisation, but asserting it needs a rule about
 * who publishes what. Here it would only ever be used to *flag* something for a
 * human, so being narrow costs a flag and being wide would hide a real move.
 */
export function isSameHost(left: string, right: string): boolean {
  const leftHost = hostOf(left);
  const rightHost = hostOf(right);

  return leftHost !== null && leftHost === rightHost;
}

type Settlement =
  | { readonly to: StatutResolution; readonly reason: ResolutionReason }
  | { readonly retry: ResolutionReason };

function settleStatus(status: number): Settlement {
  if (status >= 200 && status < 300) return { to: 'verifie', reason: 'reachable' };

  // Only ever seen when the redirect carried no Location header: the client
  // follows the ones it can, through the guard, hop by hop.
  if (status >= 300 && status < 400) return { to: 'a_revoir', reason: 'redirect-without-location' };

  if (status === 404 || status === 410) return { to: 'invalide', reason: 'not-found' };
  if (status === 401 || status === 403) return { to: 'a_revoir', reason: 'forbidden-by-site' };
  if (status === 429) return { retry: 'rate-limited' };
  if (status >= 500 && status < 600) return { retry: 'server-error' };

  return { to: 'a_revoir', reason: 'unexpected-status' };
}

function settleFailure(failure: FetchFailure): Settlement {
  switch (failure) {
    case 'ssrf-blocked':
      return { to: 'invalide', reason: 'blocked-address' };
    case 'unsafe-url':
      return { to: 'invalide', reason: 'unsafe-url' };
    case 'too-many-redirects':
      return { to: 'a_revoir', reason: 'redirect-loop' };
    case 'response-too-large':
      return { to: 'a_revoir', reason: 'response-too-large' };
    case 'timeout':
      return { retry: 'timeout' };
    case 'network':
      return { retry: 'network-error' };
  }
}

/**
 * What one observation does to the state of one URL.
 *
 * Retries are bounded here rather than in the job, because "we tried enough"
 * is a decision about the URL and belongs with the other ones. When the budget
 * is spent the URL goes to `a_revoir`, never to `invalide`: three timeouts say
 * the server did not answer, not that the commune has no website — and the
 * difference is what the observatory would otherwise publish as a fact.
 */
export function judgeObservation(observation: Observation, policy: RetryPolicy): Verdict {
  const settlement =
    observation.kind === 'response'
      ? settleStatus(observation.status)
      : settleFailure(observation.failure);

  const resolvedUrl = observation.kind === 'response' ? observation.finalUrl : null;
  const movedHost =
    observation.kind === 'response' && !isSameHost(observation.requestedUrl, observation.finalUrl);

  if (!('retry' in settlement)) {
    return {
      decision: 'transition',
      to: settlement.to,
      reason: settlement.reason,
      resolvedUrl,
      movedHost,
    };
  }

  const maxAttempts = policy.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (policy.attempts + 1 <= maxAttempts) {
    return { decision: 'retry', reason: settlement.retry };
  }

  return {
    decision: 'transition',
    to: 'a_revoir',
    reason: 'attempts-exhausted',
    resolvedUrl,
    movedHost,
  };
}
