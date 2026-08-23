import {
  FetchGuardError,
  ResponseTooLargeError,
  SsrfBlockedError,
  TimeoutError,
  TooManyRedirectsError,
  UnsafeUrlError,
  guardedFetch,
  type AuditEvent,
  type GuardedFetchDeps,
} from '../fetch/index.js';
import type { AttemptOutcome } from '../scan/progress.js';
import { extractSignals, type SiteSignals } from './extract.js';
import { scanHtml } from './html.js';

/**
 * One page fetched through the guard of CLAUDE.md §7, and the eight signals
 * read off it.
 *
 * This is the impure half of the module, and it is impure only in the sense
 * that it takes its transport by injection — the unit project forbids I/O
 * outright (§5), so the deps come from the caller and the default wiring lives
 * in `src/lib/fetch/index.ts` with the job that uses it.
 *
 * It fetches **one** page, deliberately. Following the accessibility statement
 * to read its conformance level would double the crawl of a job the brief
 * already paces at one request a second, for a level the schema does not hold.
 *
 * It also decides, for this fetch, what `src/lib/scan/progress.ts` refuses to
 * guess: which failures a fourth attempt would answer differently. Here that
 * decision is defensible because the failures are ours — the guard's own
 * refusals, and the status codes measured on 41 town hall sites on 23 August
 * 2026. The same decision for PageSpeed Insights waits for its fixture (J2-02).
 */

export const SIGNAL_ERROR_CODES = [
  'blocked-address',
  'unsafe-url',
  'too-many-redirects',
  'response-too-large',
  'timeout',
  'network-error',
  'http-error',
  'not-html',
  'empty-document',
] as const;

export type SignalErrorCode = (typeof SIGNAL_ERROR_CODES)[number];

export interface SignalsSuccess {
  readonly ok: true;
  /** Where the redirects landed. Five of the 41 surveyed sites moved. */
  readonly finalUrl: string;
  readonly httpStatus: number;
  /** §7 asks for the http fallback to be visible; this is how it surfaces. */
  readonly usedInsecureScheme: boolean;
  readonly signals: SiteSignals;
}

export interface SignalsFailure {
  readonly ok: false;
  /** Null unless a response actually came back with a status. */
  readonly httpStatus: number | null;
  readonly errorCode: SignalErrorCode;
  readonly outcome: AttemptOutcome;
}

export type SignalsCollection = SignalsSuccess | SignalsFailure;

export interface CollectSignalsOptions {
  /** The directory hands out http URLs for 4 957 town halls (§7, J1-14). */
  readonly allowHttp?: boolean;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly onAudit?: (event: AuditEvent) => void;
}

const HTML_MEDIA_TYPES = new Set(['text/html', 'application/xhtml+xml']);

/**
 * Statuses a fourth request could answer differently: the server was busy, not
 * the address wrong. `408` and `429` say so in words; `5xx` is the case
 * measured twice on the survey, where a CDN in front of the site answered 503
 * with 121 bytes of plain text.
 */
function outcomeForStatus(status: number): AttemptOutcome {
  if (status >= 500 || status === 429 || status === 408) return 'transient-failure';
  return 'permanent-failure';
}

/**
 * `AbortSignal.timeout` rejects with a `DOMException` *named* `TimeoutError`,
 * never with the guard's class of the same name — which is thrown only when the
 * deadline has already passed before a hop. Matching the class alone would file
 * every slow commune under `network-error`, and a slow commune is the one thing
 * a retry exists for.
 */
function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

function failureFor(error: unknown): SignalsFailure {
  const failed = (errorCode: SignalErrorCode, outcome: AttemptOutcome): SignalsFailure => ({
    ok: false,
    httpStatus: null,
    errorCode,
    outcome,
  });

  if (error instanceof SsrfBlockedError) return failed('blocked-address', 'permanent-failure');
  if (error instanceof UnsafeUrlError) return failed('unsafe-url', 'permanent-failure');
  if (error instanceof TooManyRedirectsError) {
    return failed('too-many-redirects', 'permanent-failure');
  }
  if (error instanceof ResponseTooLargeError) {
    // The page is that big on every attempt: retrying spends the budget of a
    // commune that could have been measured.
    return failed('response-too-large', 'permanent-failure');
  }
  if (error instanceof TimeoutError || isAbort(error)) {
    return failed('timeout', 'transient-failure');
  }
  if (error instanceof FetchGuardError) return failed('unsafe-url', 'permanent-failure');

  return failed('network-error', 'transient-failure');
}

export async function collectSignals(
  url: string,
  deps: GuardedFetchDeps,
  options: CollectSignalsOptions = {},
): Promise<SignalsCollection> {
  let outcome;
  try {
    // Spread rather than assigned: `exactOptionalPropertyTypes` is on, so
    // passing `timeoutMs: undefined` is a type error and — more to the point —
    // would be a different thing from not passing it. The client's own
    // defaults are the ones that apply when the caller says nothing.
    outcome = await guardedFetch(url, deps, {
      allowHttp: options.allowHttp ?? false,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
      ...(options.onAudit === undefined ? {} : { onAudit: options.onAudit }),
    });
  } catch (error) {
    return failureFor(error);
  }

  if (outcome.status < 200 || outcome.status >= 300) {
    return {
      ok: false,
      httpStatus: outcome.status,
      errorCode: 'http-error',
      outcome: outcomeForStatus(outcome.status),
    };
  }

  const mediaType = (outcome.headers.get('content-type') ?? '')
    .replace(/;[\s\S]*$/, '')
    .trim()
    .toLowerCase();
  if (!HTML_MEDIA_TYPES.has(mediaType)) {
    return {
      ok: false,
      httpStatus: outcome.status,
      errorCode: 'not-html',
      outcome: 'permanent-failure',
    };
  }

  const document = scanHtml(outcome.body);
  if (document.links.length === 0) {
    // Measured: one commune answers 200 with 216 bytes of JavaScript that sets
    // a cookie and reloads. Reading that as "this commune publishes nothing"
    // would be a false claim about a site we never saw (CLAUDE.md §11.5); a
    // home page without a single link is a page we could not read.
    return {
      ok: false,
      httpStatus: outcome.status,
      errorCode: 'empty-document',
      outcome: 'permanent-failure',
    };
  }

  return {
    ok: true,
    finalUrl: outcome.url,
    httpStatus: outcome.status,
    usedInsecureScheme: outcome.usedInsecureScheme,
    signals: extractSignals(
      { finalUrl: outcome.url, headers: outcome.headers, html: outcome.body },
      document,
    ),
  };
}
