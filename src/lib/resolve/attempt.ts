import { checkUrl, type UrlCheck, type UrlRejectionReason } from '../fetch/url.js';
import type { ResolutionReason, StatutResolution } from './states.js';

/**
 * What the resolver does *before* any packet moves.
 *
 * Two questions, both answerable from the string alone: can this candidate be
 * fetched at all, and — when a commune carries several — in which order should
 * they be tried. Everything decidable here is decided here, because a fetch
 * that was never worth making is the cheapest one to avoid, and because the
 * SSRF guard's verdict (CLAUDE.md §7) is a resolution decision as much as a
 * security one.
 *
 * Pure: `checkUrl` does no DNS and no network.
 */

export type AttemptPlan =
  | {
      readonly kind: 'attempt';
      /** Canonical form — the exact string the client will request. */
      readonly url: string;
      /**
       * True for an http candidate. §7 allows the scheme only as an explicit,
       * logged fallback, so the flag is the caller's obligation to opt in
       * (`allowHttp`) and to record it, not a detail it may ignore.
       */
      readonly insecure: boolean;
    }
  | {
      readonly kind: 'reject';
      /** Never `candidat` or `verifie`: a rejection is a decision, not a wait. */
      readonly statut: Extract<StatutResolution, 'invalide' | 'a_revoir'>;
      readonly reason: ResolutionReason;
    };

/**
 * The guard's vocabulary, mapped onto states. Everything is `invalide` except
 * what a human could plausibly fix, and only one thing qualifies — a value that
 * is a hostname with no scheme.
 */
const REJECTION_REASONS: Readonly<Record<UrlRejectionReason, ResolutionReason>> = {
  malformed: 'malformed-url',
  'forbidden-scheme': 'forbidden-scheme',
  'embedded-credentials': 'embedded-credentials',
  'reserved-hostname': 'blocked-address',
  'blocked-address': 'blocked-address',
};

function reject(reason: ResolutionReason): AttemptPlan {
  return { kind: 'reject', statut: 'invalide', reason };
}

/**
 * The guard's refusal, as a state.
 *
 * The `??` is defensive and unreachable: `checkUrl` sets a reason on every
 * refusal. It is written once, here, rather than at each call site — `UrlCheck`
 * types `reason` as optional even when `ok` is false, and the discriminated
 * union that would make the branch disappear belongs to `src/lib/fetch/`, whose
 * 34 tests are not this ticket's to rewrite (CLAUDE.md §12). Noted in the debt
 * of docs/roadmap.md instead.
 */
function rejectFromGuard(check: UrlCheck): AttemptPlan {
  return reject(REJECTION_REASONS[check.reason ?? 'malformed']);
}

/**
 * A scheme-less value, judged without being repaired.
 *
 * The repair is computed — and thrown away. It exists only to answer two
 * questions the raw string cannot: does this look like a host at all, and would
 * the repaired URL be one we are allowed to fetch. The second matters:
 * `192.168.1.10` looks exactly like a hostname missing its scheme, and offering
 * it for review would put a private address one operator click away from being
 * fetched.
 */
function planSchemeless(raw: string): AttemptPlan {
  let repaired: URL;
  try {
    repaired = new URL(`https://${raw}`);
  } catch {
    return reject('malformed-url');
  }

  // No dot means no public name: `https://neant` is not a URL somebody forgot
  // to prefix, it is a word in a database column.
  if (!repaired.hostname.includes('.')) return reject('malformed-url');

  const checked = checkUrl(repaired.href, { allowHttp: false });
  if (!checked.ok) return rejectFromGuard(checked);

  // Repairable, and the repair would be safe — so this is a human's call. The
  // repaired URL is deliberately not returned: it is not what the directory
  // published, and storing it as an `annuaire` candidate would misattribute it.
  // A repaired URL belongs to a `heuristique` row somebody decided to create.
  return { kind: 'reject', statut: 'a_revoir', reason: 'missing-scheme' };
}

/** Whether the raw value carries a scheme at all — `www.x.fr` does not. */
function hasScheme(raw: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(raw);
}

export function planAttempt(raw: string): AttemptPlan {
  // `allowHttp: true` because http candidates are attempted, not refused: 154
  // of the perimeter's 1 224 are http, and refusing them here would report
  // "site unreachable" about sites that answer. The flag on the plan is what
  // keeps §7 honest.
  const checked = checkUrl(raw, { allowHttp: true });

  if (!checked.ok || checked.url === undefined) {
    if (checked.reason === 'malformed' && !hasScheme(raw)) return planSchemeless(raw);
    return rejectFromGuard(checked);
  }

  return {
    kind: 'attempt',
    url: checked.url.href,
    insecure: checked.url.protocol === 'http:',
  };
}

/**
 * The order in which one commune's candidates should be tried.
 *
 * Sorted, never rewritten: the strings that come out are the strings that went
 * in, so the caller can still match a result with the `site` row it came from.
 *
 * The keys, in order of weight:
 *
 *  1. **Fetchable before not.** A candidate nothing can request cannot win.
 *  2. **Shallow before deep.** We measure homepages; the second candidate of a
 *     commune is very often a "mes démarches" page (138 communes concerned).
 *  3. **Bare before decorated.** A query string on a homepage is a tracking
 *     parameter somebody pasted, not a better address.
 *  4. **https before http.** Same site, better transport.
 *  5. **Source order.** The first value of the first record is the one the
 *     directory presents as *the* website. Nothing here beats it by guesswork:
 *     scoring a hostname against the commune's name was considered and left
 *     out, because "ville-x.fr looks more official than mairie-x.fr" is an
 *     intuition, and this project measures instead of intuiting.
 *
 * Depth outranks the scheme on purpose: measuring a homepage over http says
 * more about a commune's site than measuring its appointment-booking page over
 * https.
 */
export function rankCandidates(urls: readonly string[]): string[] {
  const keyed = urls.map((url, index) => {
    const plan = planAttempt(url);

    if (plan.kind !== 'attempt') {
      return { url, fetchable: 1, depth: 0, decorated: 0, insecure: 0, index };
    }

    const parsed = new URL(plan.url);

    return {
      url,
      fetchable: 0,
      depth: parsed.pathname.split('/').filter((segment) => segment !== '').length,
      decorated: parsed.search === '' && parsed.hash === '' ? 0 : 1,
      insecure: plan.insecure ? 1 : 0,
      index,
    };
  });

  keyed.sort(
    (left, right) =>
      left.fetchable - right.fetchable ||
      left.depth - right.depth ||
      left.decorated - right.decorated ||
      left.insecure - right.insecure ||
      left.index - right.index,
  );

  return keyed.map((entry) => entry.url);
}
