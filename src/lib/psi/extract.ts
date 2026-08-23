import { z } from 'zod';
import { extractFindings, type PsiFinding } from './findings.js';
import { PsiPayloadError, type PsiReport } from './payload.js';

/**
 * One report, translated into the columns of `measurement` (src/db/schema.ts).
 *
 * Pure, and named exactly as the columns are named, for the reason
 * `src/lib/signals/extract.ts` gives about the other half of a measurement: a
 * translation layer between two shapes that ought to be identical is a place
 * for a field to be quietly dropped.
 *
 * Everything it does not name is thrown away here rather than later. That is
 * CLAUDE.md §11.1 applied at the earliest possible point: the raw report is
 * 600 kB to 1.2 MB, three quarters of it a base64 screenshot, and the twenty
 * numbers below are all of it that survives.
 */

export interface PsiMeasurement {
  /** Where the redirects landed. Equal to the requested URL when they did not. */
  readonly finalUrl: string;
  /**
   * The status of the **main document**, not of the PSI call.
   *
   * `null` when the report does not say, which the capture never showed but
   * which a Lighthouse without `network-requests` would produce.
   */
  readonly httpStatus: number | null;
  /** Lighthouse's own `fetchTime`, in UTC, for `measurement.fetched_at` (§4). */
  readonly fetchedAt: Date;

  readonly performanceScore: number | null;
  readonly accessibilityScore: number | null;
  readonly bestPracticesScore: number | null;
  readonly seoScore: number | null;

  readonly lcpMs: number | null;
  readonly fcpMs: number | null;
  readonly speedIndexMs: number | null;
  readonly tbtMs: number | null;
  readonly ttiMs: number | null;
  readonly cls: number | null;

  readonly findings: readonly PsiFinding[];
  /** Failing rules with no recognised severity. See `findings.ts`. */
  readonly unratedRules: readonly string[];

  // --- Provenance. Logged, never stored: `methodology_version` is the column
  // that carries "how this was measured", and a second one would drift from it.
  readonly lighthouseVersion: string;
  readonly axeCoreVersion: string | null;
  readonly runWarnings: readonly string[];
}

/**
 * The four categories, and the columns they land in.
 *
 * PSI reports a category score as a 0–1 value rounded to two decimals, so the
 * integer percentage the column holds is lossless rather than a convenient
 * approximation — the comment on `measurement` says so, and the capture
 * confirms it (`0.46`, `0.9`, `0.96`, `0.92`).
 */
const CATEGORY_COLUMNS = [
  ['performance', 'performanceScore'],
  ['accessibility', 'accessibilityScore'],
  ['best-practices', 'bestPracticesScore'],
  ['seo', 'seoScore'],
] as const;

/**
 * The six metric audits, with the unit each one is *required* to be in.
 *
 * The unit is checked rather than assumed, and it is the one place this module
 * refuses to produce a number. Lighthouse hands `numericValue` and
 * `numericUnit` side by side; if a future version reported LCP in seconds, a
 * module that read only `numericValue` would store `23` where it means 23 000
 * and publish it, about a real commune, as an excellent result. There is no
 * recovering from that downstream, so it fails here.
 */
const METRIC_COLUMNS = [
  ['largest-contentful-paint', 'lcpMs', 'millisecond'],
  ['first-contentful-paint', 'fcpMs', 'millisecond'],
  ['speed-index', 'speedIndexMs', 'millisecond'],
  ['total-blocking-time', 'tbtMs', 'millisecond'],
  ['interactive', 'ttiMs', 'millisecond'],
  ['cumulative-layout-shift', 'cls', 'unitless'],
] as const;

/** Metrics stored as whole milliseconds; the layout shift keeps its decimals. */
const ROUNDED_METRICS = new Set(['lcpMs', 'fcpMs', 'speedIndexMs', 'tbtMs', 'ttiMs']);

/**
 * The `network-requests` audit, reduced to the single question we ask it: what
 * did the document answer? Parsed with its own schema because the audit's items
 * are `unknown` everywhere else — an axe item is a fragment of somebody's page.
 */
const documentRequestSchema = z.object({
  url: z.string(),
  statusCode: z.number().int(),
  resourceType: z.string().optional(),
});

/**
 * The status of the main document.
 *
 * Matched on `mainDocumentUrl` rather than taken from the first item, because
 * the first item is only the document by luck: a redirect puts two `Document`
 * requests in the list and the interesting one is the last. Falling back to the
 * last document request covers the report that omits `mainDocumentUrl`.
 *
 * This is what catches a stale directory URL: `https://www.paris.fr/<page
 * absente>` was measured on 23 August 2026 and came back with an accessibility
 * score of **95**, which is a perfectly good score for a 404 page and a false
 * statement about the commune. Only this number says so.
 */
function mainDocumentStatus(report: PsiReport): number | null {
  const items = report.audits['network-requests']?.details?.items ?? [];

  const documents = items
    .map((item) => documentRequestSchema.safeParse(item))
    .flatMap((parsed) => (parsed.success ? [parsed.data] : []))
    .filter((item) => item.resourceType === undefined || item.resourceType === 'Document');

  const matched = documents.find((item) => item.url === report.mainDocumentUrl);
  return (matched ?? documents.at(-1))?.statusCode ?? null;
}

function categoryScore(report: PsiReport, id: string): number | null {
  const score = report.categories[id]?.score;
  return score === undefined || score === null ? null : Math.round(score * 100);
}

function metricValue(
  report: PsiReport,
  auditId: string,
  unit: string,
  column: string,
): number | null {
  const audit = report.audits[auditId];
  if (audit?.numericValue === undefined) return null;

  if (audit.numericUnit !== unit) {
    throw new PsiPayloadError(
      `The audit ${auditId} reports its value in "${String(audit.numericUnit)}" where "${unit}" was measured on 23 August 2026`,
    );
  }

  return ROUNDED_METRICS.has(column) ? Math.round(audit.numericValue) : audit.numericValue;
}

export function extractMeasurement(report: PsiReport): PsiMeasurement {
  const scores = Object.fromEntries(
    CATEGORY_COLUMNS.map(([id, column]) => [column, categoryScore(report, id)]),
  ) as Record<(typeof CATEGORY_COLUMNS)[number][1], number | null>;

  const metrics = Object.fromEntries(
    METRIC_COLUMNS.map(([auditId, column, unit]) => [
      column,
      metricValue(report, auditId, unit, column),
    ]),
  ) as Record<(typeof METRIC_COLUMNS)[number][1], number | null>;

  const { findings, unratedRules } = extractFindings(report);

  return {
    // `mainDocumentUrl` is the URL of the last document request; the displayed
    // one can differ after a client-side navigation, and it is the document we
    // measured that the row is about.
    finalUrl: report.mainDocumentUrl ?? report.finalDisplayedUrl,
    httpStatus: mainDocumentStatus(report),
    fetchedAt: new Date(report.fetchTime),
    ...scores,
    ...metrics,
    findings,
    unratedRules,
    lighthouseVersion: report.lighthouseVersion,
    axeCoreVersion: report.environment?.credits?.['axe-core'] ?? null,
    runWarnings: report.runWarnings ?? [],
  };
}
