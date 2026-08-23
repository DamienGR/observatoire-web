import { FINDING_IMPACTS, type FindingImpact } from '../../db/schema.js';
import type { PsiAudit, PsiReport } from './payload.js';

/**
 * The accessibility violations of one report, in the vocabulary of the
 * `finding` table (src/db/schema.ts).
 *
 * The rule that decides what counts is one line long and was found in the
 * capture rather than reasoned out: **a finding is an audit of the
 * accessibility category whose `scoreDisplayMode` is `binary` and whose `score`
 * is `0`.** Both halves are load-bearing.
 *
 * `score === 0` alone is not enough, and the payload of Andrézieux-Bouthéon
 * says why: `image-redundant-alt` arrives with `scoreDisplayMode:
 * "informative"`, five items and `debugData.impact: "minor"` — everything that
 * looks like a violation — and a score of **1**. Lighthouse deliberately does
 * not count it. A filter written on "has items" or "has an impact" would have
 * published, about a real commune, five failures that Lighthouse itself
 * declines to call failures (CLAUDE.md §11.5).
 *
 * `binary` alone is not enough either: thirty-odd audits per page are `binary`
 * and pass.
 *
 * Across the five captured pages: 173 audits `notApplicable`, 137 `binary` and
 * passing, 50 `manual`, 6 `informative`, and **14 `binary` at zero** — the
 * findings, every one of them carrying an impact.
 */

export interface PsiFinding {
  /** The axe-core rule id, e.g. `color-contrast`. */
  readonly ruleId: string;
  readonly impact: FindingImpact;
  readonly occurrences: number;
}

export interface AccessibilityFindings {
  readonly findings: readonly PsiFinding[];
  /**
   * Rules that failed without a severity this project recognises.
   *
   * Never observed — all fourteen failures of the capture declare `critical`,
   * `serious` or `moderate` — and reported rather than dropped in silence
   * because `finding.impact` is `not null` with a CHECK behind it: inventing a
   * level to satisfy the column would publish a severity nobody measured, and
   * losing the rule would understate a site. The job logs this; the contract
   * test asserts it stays empty against the real API.
   */
  readonly unratedRules: readonly string[];
}

const KNOWN_IMPACTS = new Set<string>(FINDING_IMPACTS);

function isFailure(audit: PsiAudit): boolean {
  return audit.scoreDisplayMode === 'binary' && audit.score === 0;
}

/**
 * How many nodes the rule failed on.
 *
 * The floor of one is not a rounding: `finding.occurrences` carries a
 * `> 0` CHECK, and a rule Lighthouse scored zero failed at least once whatever
 * its item list says. The alternative — dropping the finding — would hide a
 * violation because its evidence table was empty.
 *
 * The list is *asked* for rather than assumed, because `details.items` is not
 * always one (`payload.ts`). An axe audit always sends a table; an audit that
 * sent something else would be counted as the one failure we know about rather
 * than crash a measurement.
 */
function occurrencesOf(audit: PsiAudit): number {
  const items = audit.details?.items;
  return Math.max(1, Array.isArray(items) ? items.length : 0);
}

export function extractFindings(report: PsiReport): AccessibilityFindings {
  const category = report.categories.accessibility;
  if (category === undefined) return { findings: [], unratedRules: [] };

  const findings: PsiFinding[] = [];
  const unratedRules: string[] = [];

  for (const ref of category.auditRefs) {
    const audit = report.audits[ref.id];
    // A reference to an audit the report does not carry: not worth failing a
    // whole measurement over, and worth not pretending we read it either.
    if (audit === undefined || !isFailure(audit)) continue;

    // Defaulted to the empty string rather than tested for `undefined` first:
    // a set lookup already answers "absent" and "unknown" the same way, and the
    // extra clause would be a branch no test could ever distinguish — the kind
    // this repository deletes rather than tolerates (docs/journal.md 019).
    const impact = audit.details?.debugData?.impact ?? '';
    if (!KNOWN_IMPACTS.has(impact)) {
      unratedRules.push(audit.id);
      continue;
    }

    findings.push({
      ruleId: audit.id,
      impact: impact as FindingImpact,
      occurrences: occurrencesOf(audit),
    });
  }

  // Sorted by rule id rather than left in Lighthouse's own order, which groups
  // audits by theme and reorders between versions. A stable order makes the
  // write of J2-04 and the tests here comparable from one run to the next.
  findings.sort((left, right) => left.ruleId.localeCompare(right.ruleId));
  unratedRules.sort();

  return { findings, unratedRules };
}
