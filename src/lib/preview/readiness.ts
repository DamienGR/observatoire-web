/**
 * Whether a deployment answered, decided apart from the code that asks it.
 *
 * The E2E layer runs against the Netlify deploy preview (CLAUDE.md §5), and on
 * 18/8 it went red on a diff that touched neither a template, nor a stylesheet,
 * nor the rendering. Playwright announced axe-core violations in the dark
 * palette; the detail said `Expected: 200, Received: 500` and
 * `net::ERR_ABORTED`. The suite had started rendering pages against a preview
 * seven seconds old, on a function whose routes were all still cold, and the
 * failure was reported under a title about accessibility (docs/journal.md 028,
 * issue #46).
 *
 * The missing distinction is the one `tests/contract/http.ts` already draws for
 * third-party APIs — "This is an availability failure, not a contract failure"
 * — and this module is that distinction for our own deployment. Three verdicts
 * and no fourth:
 *
 *  - `ready`       — the route answered the status it promises;
 *  - `unavailable` — nothing was rendered, so nothing was measured: wait and
 *                    ask again, within a bounded plan;
 *  - `wrong`       — the deployment answered, definitively, with something
 *                    else. That is a defect, and it is reported at once.
 *
 * It is pure, and not out of taste: no cloud session can reach a public URL at
 * all — Chromium answers `ERR_CONNECTION_RESET` and Node's `fetch` does not
 * honour the container proxy (docs/journal.md 020) — so the transport can never
 * be exercised from here. What could mistake an outage for a regression is
 * therefore kept where a unit test reaches it.
 */

/** One observation of one route. `status` is 0 when nothing answered. */
export interface Probe {
  readonly status: number;
  /** The transport failure, when there was one, cause chain included. */
  readonly error?: string;
}

export type ReadinessKind = 'ready' | 'unavailable' | 'wrong';

export interface Readiness {
  readonly kind: ReadinessKind;
  /** What was observed, short enough for a log line to carry it. */
  readonly reason: string;
}

/**
 * Statuses that mean the request never reached a rendering.
 *
 * The 5xx family is the cold start itself. 408 and 429 join it because they say
 * the same thing in the platform's voice — "not now" — and a page nobody
 * rendered is a page nobody measured, whichever number carries the refusal.
 */
function saysNotNow(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

/**
 * Transport failures worth another attempt.
 *
 * An allowlist, and the direction matters: an unknown failure is reported now
 * rather than retried on the guess that it is a bad moment. A misspelt host
 * does not become right on the fourth attempt, and retrying it spends the whole
 * plan to report a timeout instead of the cause — the exact defect
 * `scripts/resolve-netlify-url.mjs` avoids by classifying Netlify's `error`
 * status instead of waiting it out.
 *
 * `fetch failed` is deliberately absent: Node wraps a DNS failure in it too, so
 * matching it would make `ENOTFOUND` look like a bad minute forever.
 */
const TRANSIENT_TRANSPORT_PATTERNS = [
  'err_aborted',
  'err_connection_',
  'err_empty_response',
  'err_timed_out',
  'err_network_',
  'err_socket_',
  'err_address_unreachable',
  'err_http2_',
  'timeout',
  'timed out',
  'socket hang up',
  'econnreset',
  'econnrefused',
  'etimedout',
  'eai_again',
  'epipe',
  'other side closed',
] as const;

export function isTransientTransportError(message: string): boolean {
  const haystack = message.toLowerCase();
  return TRANSIENT_TRANSPORT_PATTERNS.some((pattern) => haystack.includes(pattern));
}

export function classifyProbe(probe: Probe, expectedStatus: number): Readiness {
  if (probe.status > 0) {
    const status = String(probe.status);
    if (probe.status === expectedStatus) return { kind: 'ready', reason: `HTTP ${status}` };

    const reason = saysNotNow(probe.status)
      ? `HTTP ${status}`
      : `HTTP ${status}, expected ${String(expectedStatus)}`;

    return { kind: saysNotNow(probe.status) ? 'unavailable' : 'wrong', reason };
  }

  const reason = probe.error ?? '';

  // Nothing answered and nothing said why: that is our own deadline firing, not
  // a fault the deployment reported. Waiting it out is the whole point.
  if (reason === '') return { kind: 'unavailable', reason: 'no response' };

  return { kind: isTransientTransportError(reason) ? 'unavailable' : 'wrong', reason };
}

/**
 * How many times to ask, and how long to wait between asks.
 *
 * Bounded on purpose, and asserted as such by the unit tests: §5 gives the E2E
 * layer six minutes and the whole pipeline ten, and issue #46 is explicit that
 * the answer must not be a larger `retries` — that would hide a real outage as
 * well as a cold start, which is the defect this is meant to remove.
 */
export interface RetryPlan {
  readonly attempts: number;
  /** The wait before attempts 2, 3, … The last entry holds for any beyond it. */
  readonly backoffMs: readonly number[];
}

/**
 * Meeting a function that has never run, possibly seconds after Netlify
 * published its status. 15 s of waiting spread over five attempts.
 */
export const WARMUP_PLAN: RetryPlan = { attempts: 5, backoffMs: [1_000, 2_000, 4_000, 8_000] };

/**
 * Meeting a function the warm-up already woke. Less patience is the point: at
 * this stage a route that will not answer is far more likely to be broken than
 * asleep, and §5 wants a real failure reported quickly.
 */
export const NAVIGATION_PLAN: RetryPlan = { attempts: 3, backoffMs: [1_000, 3_000] };

export function delayBeforeAttempt(plan: RetryPlan, attempt: number): number {
  if (attempt <= 1) return 0;
  const schedule = plan.backoffMs;
  return schedule[attempt - 2] ?? schedule.at(-1) ?? 0;
}

/** The whole plan's waiting, which is what a time budget has to account for. */
export function totalWaitMs(plan: RetryPlan): number {
  let total = 0;
  for (let attempt = 1; attempt <= plan.attempts; attempt += 1) {
    total += delayBeforeAttempt(plan, attempt);
  }
  return total;
}

export interface UnavailableReport {
  readonly target: string;
  readonly attempts: number;
  readonly elapsedMs: number;
  readonly lastReason: string;
}

/**
 * The words a reader meets first when a deployment would not answer.
 *
 * This is the acceptance criterion of issue #46: an availability failure has to
 * read as one. The phrasing echoes `tests/contract/http.ts` on purpose — the
 * repository already solved this problem once, for third-party APIs, and two
 * different vocabularies for one idea is how the second one gets misread.
 */
export function unavailableMessage(report: UnavailableReport): string {
  const seconds = (report.elapsedMs / 1_000).toFixed(1);

  return (
    `The preview did not answer for ${report.target}: ` +
    `${String(report.attempts)} attempts over ${seconds}s, last ${report.lastReason}.\n` +
    'This is an availability failure, not a defect of the page: nothing was rendered, ' +
    'so nothing was measured. Re-run before reading it as a regression of the diff.'
  );
}

/**
 * The words for a failure that is not worth another attempt.
 *
 * Two of them, because there are two such failures and one sentence for both
 * was wrong. The first version said "answered HTTP 0 … the deployment
 * answered" on a host that does not resolve — found by rehearsing the warm-up
 * job against a stand-in, not by re-reading it. That is the very defect issue
 * #46 is about: a report naming a failure that did not happen. The verdict was
 * right; only the sentence lied.
 */
export function wrongAnswerMessage(target: string, probe: Probe, expectedStatus: number): string {
  if (probe.status > 0) {
    return (
      `GET ${target} answered HTTP ${String(probe.status)}, expected ${String(expectedStatus)}. ` +
      'The deployment answered, so this is a failure of the page and not of its availability.'
    );
  }

  return (
    `GET ${target} could not be reached: ${probe.error ?? 'no reason given'}. ` +
    'That is not a bad minute — this address will not answer on a later attempt — so it is ' +
    'reported now instead of being waited out.'
  );
}
