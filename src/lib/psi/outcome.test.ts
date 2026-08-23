import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_INDISPONIBLE,
  HOTE_INJOIGNABLE,
  readPsiFixture,
} from '../../../tests/unit/helpers/psi-fixtures.js';
import { parsePsiResponse, type PsiApiError } from './payload.js';
import { classifyApiError, classifyRuntimeError, classifyTargetStatus } from './outcome.js';

function apiError(name: string): PsiApiError {
  const parsed = parsePsiResponse(readPsiFixture(name));
  if (parsed.kind !== 'error') throw new Error(`${name} is not an error`);
  return parsed.error;
}

describe('classifyApiError, against the two errors that were actually observed', () => {
  /**
   * The finding this module was written around: PSI answers the commune whose
   * CDN returns 503 and the commune whose host no longer resolves with the same
   * status, the same code and the same reason. It does not know which is which,
   * so neither can we.
   */
  it('reads both captured failures as the same transient document failure', () => {
    const unavailable = classifyApiError(400, apiError(DOCUMENT_INDISPONIBLE));
    const unreachable = classifyApiError(400, apiError(HOTE_INJOIGNABLE));

    expect(unavailable).toEqual({
      errorCode: 'psi-document-unavailable',
      outcome: 'transient-failure',
      fatalForRun: false,
    });
    expect(unreachable).toEqual(unavailable);
  });

  it('recognises the failure by its message when the reason is gone', () => {
    const withoutErrors: PsiApiError = {
      code: 400,
      message: 'Lighthouse returned error: FAILED_DOCUMENT_REQUEST. …',
    };

    expect(classifyApiError(400, withoutErrors).errorCode).toBe('psi-document-unavailable');
  });

  it('recognises the failure by its reason when the message is gone', () => {
    const withoutMessage: PsiApiError = {
      code: 400,
      errors: [{ domain: 'lighthouse', reason: 'lighthouseUserError' }],
    };

    expect(classifyApiError(400, withoutMessage).errorCode).toBe('psi-document-unavailable');
  });

  it('reads a reason it does not know as a request we got wrong', () => {
    const other: PsiApiError = {
      code: 400,
      message: 'no such field',
      errors: [{ domain: 'global', reason: 'invalid' }],
    };

    expect(classifyApiError(400, other).errorCode).toBe('psi-bad-request');
  });
});

describe('classifyApiError, on the statuses the API can answer', () => {
  it('treats a spent quota as transient, and as a reason to stop the run', () => {
    expect(classifyApiError(429)).toEqual({
      errorCode: 'psi-quota-exceeded',
      outcome: 'transient-failure',
      fatalForRun: true,
    });
  });

  it.each([401, 403])('treats a key problem (%i) as ours, never as the commune’s', (status) => {
    const verdict = classifyApiError(status);

    expect(verdict.errorCode).toBe('psi-unauthorised');
    // Not permanent: nothing about this site is wrong, and burning its attempt
    // budget for our expired key would need an operator to reset every row.
    expect(verdict.outcome).toBe('transient-failure');
    expect(verdict.fatalForRun).toBe(true);
  });

  it.each([500, 502, 503, 504])('treats a %i from the API as transient', (status) => {
    const verdict = classifyApiError(status);

    expect(verdict.errorCode).toBe('psi-server-error');
    expect(verdict.outcome).toBe('transient-failure');
    expect(verdict.fatalForRun).toBe(true);
  });

  it('treats a 400 that is not about the page as our own mistake, and permanent', () => {
    const invalid: PsiApiError = {
      code: 400,
      message: "Invalid value at 'strategy'",
      errors: [{ reason: 'invalidParameter', domain: 'global' }],
    };

    expect(classifyApiError(400, invalid)).toEqual({
      errorCode: 'psi-bad-request',
      outcome: 'permanent-failure',
      fatalForRun: false,
    });
  });

  it('treats a bare 400 as our own mistake: nothing says the page was reached', () => {
    expect(classifyApiError(400).errorCode).toBe('psi-bad-request');
  });

  it('treats a 400 whose envelope says nothing at all the same way', () => {
    expect(classifyApiError(400, { code: 400 }).errorCode).toBe('psi-bad-request');
  });

  it.each([404, 405, 418])('treats any other %i as permanent', (status) => {
    const verdict = classifyApiError(status);

    expect(verdict.errorCode).toBe('psi-http-error');
    expect(verdict.outcome).toBe('permanent-failure');
  });
});

describe('classifyTargetStatus', () => {
  /**
   * The same rule as `src/lib/signals/collect.ts` answers for the same
   * question: one measurement, two fetches, and a commune that is down must not
   * be transient on one side and permanent on the other.
   */
  it.each([500, 502, 503, 429, 408])('treats a %i from the site as transient', (status) => {
    expect(classifyTargetStatus(status)).toEqual({
      errorCode: 'psi-target-http-error',
      outcome: 'transient-failure',
      fatalForRun: false,
    });
  });

  it.each([404, 401, 403, 410, 451])('treats a %i from the site as permanent', (status) => {
    expect(classifyTargetStatus(status).outcome).toBe('permanent-failure');
  });

  it('treats a redirect the browser did not follow as permanent', () => {
    expect(classifyTargetStatus(304).outcome).toBe('permanent-failure');
  });
});

describe('classifyRuntimeError', () => {
  it('treats a report Lighthouse disowns as worth one more try', () => {
    expect(classifyRuntimeError()).toEqual({
      errorCode: 'psi-runtime-error',
      outcome: 'transient-failure',
      fatalForRun: false,
    });
  });
});
