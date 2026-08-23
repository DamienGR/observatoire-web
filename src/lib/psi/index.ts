/**
 * The PageSpeed Insights client (J2-02): what we ask, what comes back, what
 * survives of it, and what a failure is worth.
 *
 * Five pure stages and one that takes its transport by injection, the same
 * shape as `src/lib/signals/` next door, because the two are the two halves of
 * one measurement and should not need to be read differently:
 *
 *  - `request`  — the URL, the four categories, mobile, and the redactor for a
 *                 key the API accepts nowhere but the query string.
 *  - `payload`  — the Zod schemas, written against the frozen capture.
 *  - `findings` — which audits are violations. `binary` **and** zero.
 *  - `extract`  — the twenty numbers `measurement` keeps of a 700 kB report.
 *  - `outcome`  — which failures a fourth request would answer differently:
 *                 the decision `src/lib/scan/progress.ts` deferred to here.
 *  - `collect`  — one request, and one of the two answers above.
 *
 * The whole module was written **after** observing the API, as CLAUDE.md §5
 * requires of a third party, from payloads captured on 23 August 2026 by a
 * manual dispatch of the Contracts workflow — the only way a session can see
 * PSI at all (docs/journal.md 027 and 032). The captures are in
 * `tests/fixtures/psi/`, pruned by `scripts/prune-psi-capture.mjs`, and
 * `tests/contract/psi.test.ts` asks the real API the same questions weekly.
 */

export {
  DEFAULT_PSI_CATEGORIES,
  DEFAULT_PSI_STRATEGY,
  InvalidPsiTargetError,
  PSI_ENDPOINT,
  PSI_STRATEGIES,
  buildPsiRequestUrl,
  redactPsiKey,
} from './request.js';
export type { PsiCategory, PsiRequest, PsiStrategy } from './request.js';

export { PsiPayloadError, parsePsiResponse } from './payload.js';
export type { PsiApiError, PsiAudit, PsiReport, PsiResponse } from './payload.js';

export { extractFindings } from './findings.js';
export type { AccessibilityFindings, PsiFinding } from './findings.js';

export { extractMeasurement } from './extract.js';
export type { PsiMeasurement } from './extract.js';

export {
  PSI_ERROR_CODES,
  classifyApiError,
  classifyRuntimeError,
  classifyTargetStatus,
} from './outcome.js';
export type { PsiErrorCode, PsiFailure } from './outcome.js';

export { measureWithPsi } from './collect.js';
export type {
  MeasureWithPsiOptions,
  PsiFetchDeps,
  PsiMeasurementFailure,
  PsiMeasurementResult,
  PsiMeasurementSuccess,
} from './collect.js';
