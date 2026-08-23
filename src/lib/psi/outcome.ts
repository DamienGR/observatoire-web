import type { AttemptOutcome } from '../scan/progress.js';
import type { PsiApiError } from './payload.js';

/**
 * Which PageSpeed Insights failures a fourth request would answer differently.
 *
 * This is the decision `src/lib/scan/progress.ts` refused to make. Its comment
 * says why in one sentence — "that mapping needs the real payloads, and the
 * frozen fixture does not exist yet (J2-02)" — and J2-01 took the verdict as an
 * input rather than write down a guess in the one place this repository treats
 * as observed fact (docs/journal.md 027).
 *
 * The payloads now exist, and the first thing they say is that **PSI does not
 * know either**. Two targets were captured on 23 August 2026: a commune whose
 * CDN answers 503, and a commune whose host no longer resolves. Both came back
 * as the same HTTP 400, with the same `FAILED_DOCUMENT_REQUEST`, the same
 * `"reason": "lighthouseUserError"`, differing only in five words of prose —
 * `net::ERR_FAILED` against `net::ERR_CONNECTION_FAILED`.
 *
 * So the taxonomy below draws its line somewhere else than "is the site
 * coming back". It asks **whose fault the failure is**:
 *
 *  - the failure is *ours* — a malformed request, a report we cannot read —
 *    and repeating it is repeating the mistake: **permanent**;
 *  - the failure is *the target's*, right now: **transient**, and the attempt
 *    budget of `settleAttempt` is what eventually says "we tried". Guessing
 *    permanence from a `net::` string would be reading a symptom;
 *  - the failure is *the platform's* — quota, a 500, a revoked key: transient,
 *    because nothing about this commune is wrong and marking its row as
 *    definitively unmeasurable would publish our outage as its defect.
 *
 * The last family carries `fatalForRun`, which is not a synonym for permanent:
 * it means every other commune of this run will fail the same way, so the job
 * of J2-05 should stop rather than spend a thousand seconds proving it.
 */

export const PSI_ERROR_CODES = [
  /** The target answered, with something other than a success (the 404 trap). */
  'psi-target-http-error',
  /** Lighthouse could not load the page at all. */
  'psi-document-unavailable',
  /** A report Lighthouse itself does not stand behind (`runtimeError`). */
  'psi-runtime-error',
  /** The API refused the request as written — ours to fix. */
  'psi-bad-request',
  /** The daily quota is spent. */
  'psi-quota-exceeded',
  /** The key is missing, wrong, or revoked. */
  'psi-unauthorised',
  /** The API is having a bad minute; the brief measures this at §4. */
  'psi-server-error',
  /** Any other status the API returned. */
  'psi-http-error',
  /** A payload no schema of `payload.ts` recognises. */
  'psi-unreadable-report',
  /** We declined to send the request at all (`request.ts`). */
  'psi-target-refused',
  'psi-timeout',
  'psi-network-error',
] as const;

export type PsiErrorCode = (typeof PSI_ERROR_CODES)[number];

export interface PsiFailure {
  readonly errorCode: PsiErrorCode;
  readonly outcome: AttemptOutcome;
  /**
   * True when the next commune will fail identically. The row is still only
   * transiently failed — it is the *run* that should stop.
   */
  readonly fatalForRun: boolean;
}

function failure(
  errorCode: PsiErrorCode,
  outcome: AttemptOutcome,
  fatalForRun = false,
): PsiFailure {
  return { errorCode, outcome, fatalForRun };
}

/**
 * What the *target* answered, read through the report.
 *
 * The same rule as `src/lib/signals/collect.ts` applies to the same question,
 * and deliberately so: one measurement, two fetches, and a commune that is
 * down must not be transient on one side and permanent on the other.
 *
 * A 404 is permanent, and that is the point of measuring the status at all: a
 * directory URL that has moved will 404 for ever, and the page it serves scores
 * well enough to look like a measurement (95 on accessibility, measured). What
 * happens next is not this module's business — a scan never invalidates a URL
 * on its own (CLAUDE.md §8) — but the operator's queue needs the code.
 */
export function classifyTargetStatus(status: number): PsiFailure {
  if (status >= 500 || status === 429 || status === 408) {
    return failure('psi-target-http-error', 'transient-failure');
  }
  return failure('psi-target-http-error', 'permanent-failure');
}

/** A 200 whose report carries a `runtimeError`: no usable scores. */
export function classifyRuntimeError(): PsiFailure {
  // `NO_FCP` and its siblings are about a page that did not paint in time,
  // which is exactly the kind of thing a second attempt settles.
  return failure('psi-runtime-error', 'transient-failure');
}

function isDocumentFailure(error: PsiApiError): boolean {
  const reasons = (error.errors ?? []).map((entry) => entry.reason);
  if (reasons.includes('lighthouseUserError')) return true;

  // Belt and braces: the `errors` array is documented as optional, and the
  // code is in the message either way. Both captures carry both.
  return (error.message ?? '').includes('FAILED_DOCUMENT_REQUEST');
}

/** The error envelope, with the HTTP status the API sent it under. */
export function classifyApiError(httpStatus: number, error?: PsiApiError): PsiFailure {
  if (httpStatus === 429) return failure('psi-quota-exceeded', 'transient-failure', true);
  if (httpStatus === 401 || httpStatus === 403) {
    return failure('psi-unauthorised', 'transient-failure', true);
  }
  if (httpStatus >= 500) return failure('psi-server-error', 'transient-failure', true);

  if (httpStatus === 400) {
    if (error !== undefined && isDocumentFailure(error)) {
      return failure('psi-document-unavailable', 'transient-failure');
    }
    // A 400 that is not about the page is about the request, and the request
    // is the same on every attempt.
    return failure('psi-bad-request', 'permanent-failure');
  }

  // Everything the platform can be blamed for — 429, 401, 403, 5xx — has been
  // answered above, so what reaches here is a status that says our request was
  // wrong. Permanent, without a branch on the number: a `>= 500` test at this
  // point can never be true, and this repository deletes an unreachable branch
  // rather than testing it (docs/journal.md 019, 024 and 031).
  return failure('psi-http-error', 'permanent-failure');
}
