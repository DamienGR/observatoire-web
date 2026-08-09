import { STATUTS_RESOLUTION, type StatutResolution } from '../../db/schema.js';
import type { ResolutionCount, StatsSnapshot } from './snapshot.js';

/**
 * The `/stats` page as data: everything it displays, derived once, so the
 * template holds no arithmetic and this module can be tested without a server
 * (CLAUDE.md §5).
 *
 * Two properties are worth stating because they are what the tests defend:
 *
 *  1. **Nothing is counted twice.** The total number of candidate URLs is the
 *     sum of the per-state counts rather than a separate query, so the page
 *     cannot display a total and a breakdown that contradict each other.
 *  2. **Every state appears, including the empty ones.** "0 URL à revoir" is a
 *     statement about the pipeline; an absent line is an omission a reader
 *     cannot tell from a state that does not exist.
 */

/** French labels for the states of docs/brief.md §4, in the schema's order. */
const LABELS: Readonly<Record<StatutResolution, string>> = {
  candidat: 'Candidate',
  verifie: 'Vérifiée',
  invalide: 'Invalide',
  a_revoir: 'À revoir',
};

export interface ResolutionRow {
  readonly statut: StatutResolution;
  readonly label: string;
  readonly total: number;
  /** Of all candidate URLs, between 0 and 1. Zero when there are none. */
  readonly share: number;
}

export interface StatsView {
  readonly communes: number;
  readonly perimeterPopulation: number;
  readonly communesWithCandidate: number;
  readonly communesWithoutCandidate: number;
  readonly sites: number;
  readonly resolution: readonly ResolutionRow[];
  readonly measurements: number;
  readonly scanRuns: number;
  /** False until the referential has been ingested into this database. */
  readonly hasCommunes: boolean;
  /** False until the scan of milestone 2 has run. */
  readonly hasMeasurements: boolean;
  readonly referentialUpdatedAt: Date | null;
}

/**
 * A proportion, or zero when there is nothing to divide by.
 *
 * The guard is not defensive coding: an empty database is the *normal* state of
 * this page until the ingestion job has run against it, and `0/0` would publish
 * `NaN %` on a page whose subject is measurement quality.
 */
function share(part: number, total: number): number {
  return total === 0 ? 0 : part / total;
}

function totalFor(counts: readonly ResolutionCount[], statut: StatutResolution): number {
  return counts.find((count) => count.statut === statut)?.total ?? 0;
}

export function buildStatsView(snapshot: StatsSnapshot): StatsView {
  const sites = snapshot.sitesByStatut.reduce((sum, count) => sum + count.total, 0);

  const resolution = STATUTS_RESOLUTION.map((statut) => {
    const total = totalFor(snapshot.sitesByStatut, statut);

    return { statut, label: LABELS[statut], total, share: share(total, sites) };
  });

  return {
    communes: snapshot.communes,
    perimeterPopulation: snapshot.perimeterPopulation,
    communesWithCandidate: snapshot.communesWithCandidate,
    communesWithoutCandidate: snapshot.communes - snapshot.communesWithCandidate,
    sites,
    resolution,
    measurements: snapshot.measurements,
    scanRuns: snapshot.scanRuns,
    hasCommunes: snapshot.communes > 0,
    hasMeasurements: snapshot.measurements > 0,
    referentialUpdatedAt: snapshot.referentialUpdatedAt,
  };
}
