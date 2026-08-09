import type { StatutResolution } from '../../db/schema.js';

/**
 * The figures a single read of the database produces, before anything is
 * derived from them.
 *
 * It is declared here rather than next to the query (`src/db/stats.ts`) so the
 * pure half can be tested without importing a driver, and so the page depends
 * on a shape rather than on a query. Everything the reader eventually sees is
 * computed from this by `buildStatsView`.
 *
 * Nothing here is a measurement: milestone 1 has ingested a referential and
 * queued candidate URLs, and the scan is milestone 2. The counts below describe
 * *the pipeline*, and saying so plainly is the whole point of the page — a site
 * that measures others has no business being vague about its own state.
 */

/** How many candidate URLs sit in one resolution state. */
export interface ResolutionCount {
  readonly statut: StatutResolution;
  readonly total: number;
}

export interface StatsSnapshot {
  /** Communes in the v1 perimeter, as ingested. Never a hard-coded number. */
  readonly communes: number;
  /** Communes holding at least one candidate URL. */
  readonly communesWithCandidate: number;
  /** Cumulated population of the perimeter, from the referential. */
  readonly perimeterPopulation: number;
  /** One entry per state actually present; states with no row are absent. */
  readonly sitesByStatut: readonly ResolutionCount[];
  readonly measurements: number;
  readonly scanRuns: number;
  /** When the referential was last written, or null if it never was. */
  readonly referentialUpdatedAt: Date | null;
}
