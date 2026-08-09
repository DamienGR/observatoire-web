import { describe, expect, it } from 'vitest';
import { STATUTS_RESOLUTION } from '../../db/schema.js';
import type { StatsSnapshot } from './snapshot.js';
import { buildStatsView } from './view.js';

/**
 * What the `/stats` page shows, derived from the counts a database read
 * returns. Pure: it takes a snapshot and returns a view model, so the page
 * holds no arithmetic and this file holds no I/O (CLAUDE.md §5).
 *
 * The cases below are the ones the real data produces, not invented ones. The
 * perimeter ingested on 7 August 2026 is 1 067 communes, 1 224 candidate URLs
 * and 15 communes with no URL at all (docs/journal.md 017), and every
 * measurement count is zero because the scan is milestone 2 — which is exactly
 * why the zero cases are the ones that must not break.
 */
const empty: StatsSnapshot = {
  communes: 0,
  communesWithCandidate: 0,
  perimeterPopulation: 0,
  sitesByStatut: [],
  measurements: 0,
  scanRuns: 0,
  referentialUpdatedAt: null,
};

const ingested: StatsSnapshot = {
  communes: 1_067,
  communesWithCandidate: 1_052,
  perimeterPopulation: 29_000_000,
  sitesByStatut: [{ statut: 'candidat', total: 1_224 }],
  measurements: 0,
  scanRuns: 0,
  referentialUpdatedAt: new Date('2026-08-07T09:00:00Z'),
};

describe('buildStatsView', () => {
  it('carries the counts of the snapshot through unchanged', () => {
    const view = buildStatsView(ingested);

    expect(view.communes).toBe(1_067);
    expect(view.perimeterPopulation).toBe(29_000_000);
    expect(view.measurements).toBe(0);
    expect(view.scanRuns).toBe(0);
    expect(view.referentialUpdatedAt).toEqual(new Date('2026-08-07T09:00:00Z'));
  });

  it('derives the communes with no candidate URL rather than reading a count', () => {
    // Measured at 15 on the real perimeter. Deriving it from the two counts the
    // database can answer exactly means the page cannot show a total and a
    // breakdown that disagree.
    const view = buildStatsView(ingested);

    expect(view.communesWithoutCandidate).toBe(15);
  });

  it('sums the candidate URLs rather than taking a separate total', () => {
    const view = buildStatsView({
      ...ingested,
      sitesByStatut: [
        { statut: 'candidat', total: 1_200 },
        { statut: 'verifie', total: 20 },
        { statut: 'invalide', total: 4 },
      ],
    });

    expect(view.sites).toBe(1_224);
  });

  it('lists every resolution state, in the order of the schema', () => {
    // A state that no row currently holds still has to appear: "0 URL invalide"
    // is a fact about the pipeline, while an absent line reads as an omission —
    // and the review queue nobody displays is the one nobody empties.
    const view = buildStatsView(ingested);

    expect(view.resolution.map((row) => row.statut)).toEqual([...STATUTS_RESOLUTION]);
    expect(view.resolution.map((row) => row.total)).toEqual([1_224, 0, 0, 0]);
  });

  it('gives every state a French label', () => {
    const view = buildStatsView(ingested);

    expect(view.resolution.every((row) => row.label.length > 0)).toBe(true);
    expect(view.resolution.map((row) => row.label)).toContain('À revoir');
  });

  it('computes each share against the total of candidate URLs', () => {
    const view = buildStatsView({
      ...ingested,
      sitesByStatut: [
        { statut: 'candidat', total: 3 },
        { statut: 'verifie', total: 1 },
      ],
    });

    expect(view.resolution.map((row) => row.share)).toEqual([0.75, 0.25, 0, 0]);
  });

  it('reports a share of zero rather than NaN on an empty database', () => {
    // This is the state of the production database until the ingestion job has
    // run against it: a division by zero here would render "NaN %" on a public
    // page, which is the failure mode of every dashboard written against data
    // that already existed.
    const view = buildStatsView(empty);

    expect(view.sites).toBe(0);
    expect(view.resolution.map((row) => row.share)).toEqual([0, 0, 0, 0]);
    expect(view.communesWithoutCandidate).toBe(0);
  });

  it('says whether anything has been ingested at all', () => {
    expect(buildStatsView(empty).hasCommunes).toBe(false);
    expect(buildStatsView(ingested).hasCommunes).toBe(true);
  });

  it('says whether any measurement exists, which is what the page announces', () => {
    // §11.5: the site never lets a reader believe more has been measured than
    // has been. Until the scan of milestone 2 runs, this is false and the page
    // says so in a sentence rather than showing an empty table.
    expect(buildStatsView(ingested).hasMeasurements).toBe(false);
    expect(buildStatsView({ ...ingested, measurements: 20 }).hasMeasurements).toBe(true);
  });
});
