import { describe, expect, it } from 'vitest';
import {
  ANDREZIEUX,
  PAGE_ABSENTE,
  PARIS,
  readPsiFixture,
} from '../../../tests/unit/helpers/psi-fixtures.js';
import { extractFindings } from './findings.js';
import { parsePsiResponse, type PsiReport } from './payload.js';

function report(name: string): PsiReport {
  const parsed = parsePsiResponse(readPsiFixture(name));
  if (parsed.kind !== 'report') throw new Error(`${name} is not a report`);
  return parsed.report;
}

describe('extractFindings, against the frozen capture', () => {
  it('reads the three failures of paris.fr, with their impacts and counts', () => {
    expect(extractFindings(report(PARIS))).toEqual({
      findings: [
        { ruleId: 'aria-hidden-focus', impact: 'serious', occurrences: 12 },
        { ruleId: 'link-name', impact: 'serious', occurrences: 2 },
        { ruleId: 'list', impact: 'serious', occurrences: 1 },
      ],
      unratedRules: [],
    });
  });

  it('reads the seven failures of the smallest site of the capture', () => {
    const { findings } = extractFindings(report(ANDREZIEUX));

    expect(findings).toEqual([
      { ruleId: 'button-name', impact: 'critical', occurrences: 1 },
      { ruleId: 'color-contrast', impact: 'serious', occurrences: 4 },
      { ruleId: 'heading-order', impact: 'moderate', occurrences: 1 },
      { ruleId: 'landmark-one-main', impact: 'moderate', occurrences: 1 },
      { ruleId: 'link-name', impact: 'serious', occurrences: 1 },
      { ruleId: 'select-name', impact: 'critical', occurrences: 3 },
      { ruleId: 'target-size', impact: 'serious', occurrences: 2 },
    ]);
  });

  /**
   * The reason `findings.ts` tests the display mode and not just the score.
   * `image-redundant-alt` arrives with five items and `impact: "minor"` and a
   * score of **1**: everything that looks like a violation, and Lighthouse
   * counting it as none.
   */
  it('ignores an informative audit that carries items and an impact', () => {
    const source = report(ANDREZIEUX);
    const audit = source.audits['image-redundant-alt'];

    expect(audit?.scoreDisplayMode).toBe('informative');
    expect(audit?.score).toBe(1);
    expect((audit?.details?.items as unknown[]).length).toBe(5);
    expect(audit?.details?.debugData?.impact).toBe('minor');

    expect(extractFindings(source).findings.map((finding) => finding.ruleId)).not.toContain(
      'image-redundant-alt',
    );
  });

  it('ignores the audits that did not apply and the ones left to a human', () => {
    const source = report(PARIS);
    const modes = new Set(
      source.categories.accessibility?.auditRefs.map(
        (ref) => source.audits[ref.id]?.scoreDisplayMode,
      ),
    );

    expect(modes).toContain('notApplicable');
    expect(modes).toContain('manual');
    expect(extractFindings(source).findings).toHaveLength(3);
  });

  it('reports a 404 page as having its own failures, which is why the status matters', () => {
    const { findings } = extractFindings(report(PAGE_ABSENTE));

    expect(findings.map((finding) => finding.ruleId)).toEqual(['heading-order', 'link-name']);
  });

  /**
   * Lighthouse groups its audit references by theme, so its own order for this
   * page ends `target-size, landmark-one-main`. The assertion is the explicit
   * list rather than "is this array sorted", which a comparator that did
   * nothing would also satisfy.
   */
  it('returns findings sorted by rule id, whatever order Lighthouse groups them in', () => {
    const source = report(ANDREZIEUX);
    const lighthouseOrder = source.categories.accessibility?.auditRefs
      .map((ref) => source.audits[ref.id])
      .filter((audit) => audit?.score === 0)
      .map((audit) => audit?.id);

    expect(lighthouseOrder?.at(-1)).toBe('landmark-one-main');
    expect(extractFindings(source).findings.at(-1)?.ruleId).toBe('target-size');
  });
});

describe('extractFindings, on the cases the capture does not contain', () => {
  const withAudit = (audit: Record<string, unknown>): PsiReport => ({
    finalDisplayedUrl: 'https://ville.fr/',
    lighthouseVersion: '13.4.1',
    fetchTime: '2026-08-23T13:56:58.703Z',
    categories: {
      accessibility: { id: 'accessibility', score: 0.5, auditRefs: [{ id: 'ruled', weight: 3 }] },
    },
    audits: { ruled: { id: 'ruled', score: 0, scoreDisplayMode: 'binary', ...audit } },
  });

  it('sets aside a failure whose severity it cannot read, rather than inventing one', () => {
    expect(extractFindings(withAudit({ details: { type: 'table', items: [1, 2] } }))).toEqual({
      findings: [],
      unratedRules: ['ruled'],
    });
  });

  it('sets aside a severity axe does not use either', () => {
    const result = extractFindings(
      withAudit({ details: { type: 'table', items: [1], debugData: { impact: 'catastrophic' } } }),
    );

    expect(result.unratedRules).toEqual(['ruled']);
  });

  /**
   * The other half of the rule, and the half the capture cannot show: an
   * informative audit at zero. Lighthouse says of that display mode that it
   * "can't be interpreted as pass/fail", so it is not one — whatever its score.
   */
  it('ignores an informative audit even when it scores zero', () => {
    const result = extractFindings(
      withAudit({
        scoreDisplayMode: 'informative',
        details: { items: [1, 2], debugData: { impact: 'serious' } },
      }),
    );

    expect(result).toEqual({ findings: [], unratedRules: [] });
  });

  it('ignores an audit that did not apply, whatever it carries', () => {
    const result = extractFindings(
      withAudit({
        score: null,
        scoreDisplayMode: 'notApplicable',
        details: { items: [1], debugData: { impact: 'critical' } },
      }),
    );

    expect(result.findings).toEqual([]);
  });

  it('ignores a binary audit that passed', () => {
    const result = extractFindings(
      withAudit({ score: 1, details: { items: [1], debugData: { impact: 'critical' } } }),
    );

    expect(result.findings).toEqual([]);
  });

  it('counts one occurrence for a failure with no evidence table', () => {
    const result = extractFindings(withAudit({ details: { debugData: { impact: 'minor' } } }));

    expect(result.findings).toEqual([{ ruleId: 'ruled', impact: 'minor', occurrences: 1 }]);
  });

  it('counts one occurrence for a failure with an empty evidence table', () => {
    const result = extractFindings(
      withAudit({ details: { items: [], debugData: { impact: 'minor' } } }),
    );

    expect(result.findings[0]?.occurrences).toBe(1);
  });

  it('counts one occurrence when the evidence is not a list at all', () => {
    const result = extractFindings(
      withAudit({
        details: { type: 'checklist', items: { a: 1, b: 2 }, debugData: { impact: 'minor' } },
      }),
    );

    expect(result.findings[0]?.occurrences).toBe(1);
  });

  it('accepts every impact the schema allows', () => {
    for (const impact of ['minor', 'moderate', 'serious', 'critical']) {
      const result = extractFindings(withAudit({ details: { items: [1], debugData: { impact } } }));

      expect(result.findings[0]?.impact).toBe(impact);
    }
  });

  it('skips a reference to an audit the report does not carry', () => {
    const source: PsiReport = {
      finalDisplayedUrl: 'https://ville.fr/',
      lighthouseVersion: '13.4.1',
      fetchTime: '2026-08-23T13:56:58.703Z',
      categories: {
        accessibility: { id: 'accessibility', score: 1, auditRefs: [{ id: 'absent', weight: 3 }] },
      },
      audits: {},
    };

    expect(extractFindings(source)).toEqual({ findings: [], unratedRules: [] });
  });

  it('reads no findings from a report with no accessibility category', () => {
    const source: PsiReport = {
      finalDisplayedUrl: 'https://ville.fr/',
      lighthouseVersion: '13.4.1',
      fetchTime: '2026-08-23T13:56:58.703Z',
      categories: { performance: { id: 'performance', score: 0.5, auditRefs: [] } },
      audits: {},
    };

    expect(extractFindings(source)).toEqual({ findings: [], unratedRules: [] });
  });

  it('records a rule that fails with weight zero: it is still a violation', () => {
    const source: PsiReport = {
      finalDisplayedUrl: 'https://ville.fr/',
      lighthouseVersion: '13.4.1',
      fetchTime: '2026-08-23T13:56:58.703Z',
      categories: {
        accessibility: { id: 'accessibility', score: 1, auditRefs: [{ id: 'ruled', weight: 0 }] },
      },
      audits: {
        ruled: {
          id: 'ruled',
          score: 0,
          scoreDisplayMode: 'binary',
          details: { items: [1], debugData: { impact: 'serious' } },
        },
      },
    };

    expect(extractFindings(source).findings).toHaveLength(1);
  });

  it('sorts the rules it had to set aside, so two runs report the same list', () => {
    const source: PsiReport = {
      finalDisplayedUrl: 'https://ville.fr/',
      lighthouseVersion: '13.4.1',
      fetchTime: '2026-08-23T13:56:58.703Z',
      categories: {
        accessibility: {
          id: 'accessibility',
          score: 0,
          auditRefs: [
            { id: 'zebra', weight: 1 },
            { id: 'alpha', weight: 1 },
          ],
        },
      },
      audits: {
        zebra: { id: 'zebra', score: 0, scoreDisplayMode: 'binary' },
        alpha: { id: 'alpha', score: 0, scoreDisplayMode: 'binary' },
      },
    };

    expect(extractFindings(source).unratedRules).toEqual(['alpha', 'zebra']);
  });
});
