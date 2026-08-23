import { extractMeasurement, type PsiMeasurement } from './extract.js';
import { PsiPayloadError, parsePsiResponse } from './payload.js';
import {
  classifyApiError,
  classifyRuntimeError,
  classifyTargetStatus,
  type PsiErrorCode,
  type PsiFailure,
} from './outcome.js';
import { buildPsiRequestUrl, redactPsiKey, type PsiStrategy } from './request.js';
import type { AttemptOutcome } from '../scan/progress.js';

/**
 * One measurement bought from PageSpeed Insights.
 *
 * The impure half of the module, impure only in the sense that it takes its
 * transport by injection — the unit project forbids I/O outright (CLAUDE.md
 * §5), so the caller supplies `fetch` and the job supplies the real one. It is
 * the same shape as `src/lib/signals/collect.ts`, on purpose: the two halves of
 * a measurement should not need to be read differently.
 *
 * Plain `fetch` rather than the guarded client of `src/lib/fetch/`, and the
 * distinction matters. That guard exists for URLs a directory handed us, which
 * may point at a loopback address; the address dialled here is Google's, fixed
 * in `request.ts`. The *target* is untrusted — which is exactly why we are
 * buying the measurement from someone whose browser is not ours.
 */

export interface PsiFetchDeps {
  readonly fetch: (input: string, init?: RequestInit) => Promise<Response>;
}

export interface PsiMeasurementSuccess {
  readonly ok: true;
  /** The PSI call's own status. 200 whenever there is a report. */
  readonly apiStatus: number;
  readonly measurement: PsiMeasurement;
}

export interface PsiMeasurementFailure {
  readonly ok: false;
  /**
   * The status of the **main document**, when one was measured — the case
   * where PSI succeeded and the commune's page did not. `null` otherwise.
   */
  readonly httpStatus: number | null;
  /** The PSI call's own status, `null` when the request never completed. */
  readonly apiStatus: number | null;
  readonly errorCode: PsiErrorCode;
  readonly outcome: AttemptOutcome;
  /** Every commune of this run will fail the same way. See `outcome.ts`. */
  readonly fatalForRun: boolean;
  /** A short, key-free line for the operator. Never a payload, never a URL. */
  readonly detail: string | null;
}

export type PsiMeasurementResult = PsiMeasurementSuccess | PsiMeasurementFailure;

export interface MeasureWithPsiOptions {
  readonly strategy?: PsiStrategy;
  readonly timeoutMs?: number;
}

/**
 * Long. A heavy home page took 28 s in the capture and PSI queues behind its
 * own load; the brief already describes an API that answers 500 for minutes
 * under pressure (§4). Cutting a slow measurement short spends the attempt and
 * learns nothing.
 */
const DEFAULT_TIMEOUT_MS = 120_000;

/** Bounded, and redacted: an error message is not a place to find a key (§7). */
function detailOf(error: unknown): string {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error';
  return redactPsiKey(raw).slice(0, 200);
}

/**
 * `AbortSignal.timeout` rejects with a `DOMException` *named* `TimeoutError`.
 * The same note as `src/lib/signals/collect.ts`: matching on a class would file
 * every slow commune under a network error, and a slow commune is the one thing
 * a retry exists for.
 */
function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

function failed(
  verdict: PsiFailure,
  extra: { apiStatus?: number | null; httpStatus?: number | null; detail?: string | null } = {},
): PsiMeasurementFailure {
  return {
    ok: false,
    httpStatus: extra.httpStatus ?? null,
    apiStatus: extra.apiStatus ?? null,
    errorCode: verdict.errorCode,
    outcome: verdict.outcome,
    fatalForRun: verdict.fatalForRun,
    detail: extra.detail ?? null,
  };
}

export async function measureWithPsi(
  url: string,
  apiKey: string,
  deps: PsiFetchDeps,
  options: MeasureWithPsiOptions = {},
): Promise<PsiMeasurementResult> {
  let requestUrl;
  try {
    requestUrl = buildPsiRequestUrl({
      url,
      apiKey,
      ...(options.strategy === undefined ? {} : { strategy: options.strategy }),
    });
  } catch (error) {
    // `buildPsiRequestUrl` raises `InvalidPsiTargetError` and nothing else, by
    // construction and by its own tests, so there is no second branch here to
    // write — one that no test could reach is one this repository deletes
    // (docs/journal.md 019, 024 and 031).
    //
    // We never asked, so nothing about the site was observed. Permanent by
    // construction: the same target produces the same refusal.
    return failed(
      { errorCode: 'psi-target-refused', outcome: 'permanent-failure', fatalForRun: false },
      { detail: detailOf(error) },
    );
  }

  let response;
  let body;
  try {
    response = await deps.fetch(requestUrl, {
      headers: { 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    body = await response.text();
  } catch (error) {
    const errorCode: PsiErrorCode = isAbort(error) ? 'psi-timeout' : 'psi-network-error';
    return failed(
      { errorCode, outcome: 'transient-failure', fatalForRun: false },
      { detail: detailOf(error) },
    );
  }

  let parsed;
  try {
    parsed = parsePsiResponse(JSON.parse(body) as unknown);
  } catch (error) {
    // A body that will not parse when the status already says no is not a
    // schema problem — it is an error page from a proxy. Report the status.
    if (!response.ok) {
      return failed(classifyApiError(response.status), {
        apiStatus: response.status,
        detail: detailOf(error),
      });
    }

    return failed(
      {
        errorCode: 'psi-unreadable-report',
        // Retrying will produce the same payload the same schema will refuse.
        // Loud and permanent is the intent: this is how a drift in the API
        // reaches an operator instead of becoming a silent hole.
        outcome: 'permanent-failure',
        fatalForRun: error instanceof PsiPayloadError,
      },
      { apiStatus: response.status, detail: detailOf(error) },
    );
  }

  if (parsed.kind === 'error') {
    return failed(classifyApiError(response.status, parsed.error), {
      apiStatus: response.status,
      detail: redactPsiKey(parsed.error.message ?? '').slice(0, 200) || null,
    });
  }

  if (!response.ok) {
    // A report under a failing status has never been observed. Trusting it
    // would mean publishing numbers the API disowned.
    return failed(classifyApiError(response.status), { apiStatus: response.status });
  }

  if (parsed.report.runtimeError !== undefined) {
    return failed(classifyRuntimeError(), {
      apiStatus: response.status,
      detail: parsed.report.runtimeError.code,
    });
  }

  let measurement;
  try {
    measurement = extractMeasurement(parsed.report);
  } catch (error) {
    return failed(
      {
        errorCode: 'psi-unreadable-report',
        outcome: 'permanent-failure',
        fatalForRun: true,
      },
      { apiStatus: response.status, detail: detailOf(error) },
    );
  }

  if (measurement.httpStatus !== null && !isSuccessStatus(measurement.httpStatus)) {
    // The API worked; the commune's page did not. Publishing the scores of a
    // 404 page as the commune's would be a false statement about a site we
    // never measured (CLAUDE.md §11.5).
    return failed(classifyTargetStatus(measurement.httpStatus), {
      apiStatus: response.status,
      httpStatus: measurement.httpStatus,
      detail: `the document answered ${String(measurement.httpStatus)}`,
    });
  }

  return { ok: true, apiStatus: response.status, measurement };
}

function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

/** We announce ourselves on every outgoing request (CLAUDE.md §7). */
const USER_AGENT = 'observatoire-web (+https://github.com/DamienGR/observatoire-web)';
