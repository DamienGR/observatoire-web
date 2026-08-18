import type { StatutResolution } from '../../db/schema.js';

/**
 * Which sites a scan is allowed to measure, and in which order.
 *
 * Two questions, kept together because they are the same decision seen from two
 * sides: *may* we measure this URL, and — the perimeter being 1 052 communes
 * while milestone 2 measures 20 — *which* twenty.
 *
 * Pure, and it takes rows rather than a query on purpose. The sample of a run
 * is the thing an operator will argue with ("why was my commune not scanned?"),
 * so it has to be reproducible from its inputs alone, not from whatever order
 * Postgres felt like returning.
 */

/**
 * Only a verified URL is measured.
 *
 * `candidat` is excluded and it is the interesting exclusion: those URLs exist,
 * they usually answer, and measuring them would cost nothing. But the
 * observatory publishes a score *next to a commune's name*, and a candidate is
 * exactly a URL nobody has confirmed belongs to that commune — 138 communes of
 * the perimeter carry several (docs/brief.md §4), often a booking page beside
 * the home page. Publishing the wrong one is the failure this project cannot
 * afford, and it costs a re-measurement to undo.
 *
 * `invalide` and `a_revoir` are excluded for the reason CLAUDE.md §8 makes
 * non-negotiable: a scan never resurrects a URL an operator invalidated, and
 * never takes one out of the review queue. Not scanning them is how that rule
 * holds here — the state machine of `src/lib/resolve/` refuses the transition,
 * this refuses the request.
 */
export function isScannable(statut: StatutResolution): boolean {
  return statut === 'verifie';
}

/** Why a site the caller offered is not in the sample. */
export const SCAN_SKIP_REASONS = [
  'unverified-url',
  'commune-already-covered',
  'outside-requested-communes',
] as const;

export type ScanSkipReason = (typeof SCAN_SKIP_REASONS)[number];

/** The part of a `site` row, joined to its commune, that the sample depends on. */
export interface ScanCandidate {
  readonly siteId: number;
  readonly communeId: string;
  readonly url: string;
  readonly statutResolution: StatutResolution;
  readonly population: number;
}

export interface SkippedSite {
  readonly siteId: number;
  readonly communeId: string;
  readonly reason: ScanSkipReason;
}

export interface ScanSelectionReport {
  /** Rows the caller offered. */
  readonly sitesConsidered: number;
  /** Communes the run will measure — one site each, by construction. */
  readonly communesTargeted: number;
  /**
   * Eligible communes the sample size left out. A count, not a list, and the
   * asymmetry with `skipped` is the point: an operator can act on a site that
   * was refused, and can do nothing about the 1 032 communes that a sample of
   * 20 does not reach. Naming them would bury the three lines that matter.
   */
  readonly outsideSample: number;
  /** Same number as `skipped.length`, so a log line needs no arithmetic. */
  readonly skipped: number;
}

export interface ScanSelection {
  readonly selected: readonly ScanCandidate[];
  readonly skipped: readonly SkippedSite[];
  readonly report: ScanSelectionReport;
}

export interface ScanSelectionOptions {
  /** How many communes to measure. Absent means the whole eligible perimeter. */
  readonly limit?: number;
  /** Restrict to these INSEE codes — the ops surface replaying a few communes. */
  readonly communes?: readonly string[];
}

/**
 * Most populous first, INSEE code to break a tie, site id to break that.
 *
 * Population because milestone 2 measures twenty communes and the twenty that
 * matter are the ones most people visit. The two tie-breaks exist only so that
 * the sample is a function of the data: two runs a minute apart must plan the
 * same twenty, or a resumed run is not the run it resumes.
 */
function bySampleOrder(left: ScanCandidate, right: ScanCandidate): number {
  if (left.population !== right.population) return right.population - left.population;
  if (left.communeId !== right.communeId) return left.communeId < right.communeId ? -1 : 1;
  return left.siteId - right.siteId;
}

/**
 * The sample of one run: which sites it will measure, which it refused, and
 * how many the sample size left aside.
 */
export function selectScanTargets(
  sites: readonly ScanCandidate[],
  options: ScanSelectionOptions = {},
): ScanSelection {
  const requested = options.communes === undefined ? null : new Set(options.communes);

  const skipped: SkippedSite[] = [];
  const eligible: ScanCandidate[] = [];

  // Ordered before anything is refused, so that "the commune is already
  // covered" refuses the *runner-up* rather than whichever row came first out
  // of the database.
  const ordered = [...sites].sort(bySampleOrder);
  const covered = new Set<string>();

  for (const site of ordered) {
    const reason = ((): ScanSkipReason | null => {
      if (!isScannable(site.statutResolution)) return 'unverified-url';
      if (requested !== null && !requested.has(site.communeId)) return 'outside-requested-communes';
      if (covered.has(site.communeId)) return 'commune-already-covered';
      return null;
    })();

    if (reason !== null) {
      skipped.push({ siteId: site.siteId, communeId: site.communeId, reason });
      continue;
    }

    covered.add(site.communeId);
    eligible.push(site);
  }

  // No conditional: `slice(0, undefined)` is the whole array, so an absent
  // limit needs no branch of its own — and a branch nothing can distinguish is
  // a branch that only ever costs a reader.
  const selected = eligible.slice(0, options.limit);

  return {
    selected,
    skipped,
    report: {
      sitesConsidered: sites.length,
      communesTargeted: selected.length,
      outsideSample: eligible.length - selected.length,
      skipped: skipped.length,
    },
  };
}
