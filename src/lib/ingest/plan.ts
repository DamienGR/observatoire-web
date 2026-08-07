import type { AnnuaireRecord } from '../sources/annuaire.js';
import type { CommuneRecord } from '../sources/geo.js';
import { candidatesFor, indexMairiesByCommune, type SiteCandidate } from './candidates.js';
import { V1_POPULATION_THRESHOLD, selectPerimeter, type PerimeterCommune } from './perimeter.js';

/**
 * What one ingestion run intends to write, decided without touching a database.
 *
 * The split is deliberate: everything above this line is pure and unit tested,
 * everything below it (`src/db/ingest.ts`) is a writer that takes this plan and
 * has no opinion. It also makes a dry run a real thing rather than a promise —
 * `--dry-run` builds the plan and stops, which is the only way to see what a
 * job would do when there is no shell to try it in.
 */

/** What the operator reads in the workflow log. Numbers, and one list. */
export interface IngestionReport {
  readonly populationThreshold: number;
  /** Communes the referential returned, in total. 34 969 on 6 August 2026. */
  readonly communesSeen: number;
  /** Of those, the ones above the threshold. 1 067 on the same day. */
  readonly communesInPerimeter: number;
  /** Town-hall records the directory returned. 35 803 on the same day. */
  readonly mairieRecords: number;
  /** Distinct candidate URLs planned, across the perimeter. 1 224. */
  readonly candidateUrls: number;
  /** Communes with two or more candidates — the queue J1-06 will arbitrate. 138. */
  readonly communesWithSeveralCandidates: number;
  /**
   * The INSEE codes with no candidate at all, named rather than counted: these
   * are the communes needing a URL from somewhere else, and a count would say
   * "15" without ever saying which. 15 on 6 August 2026, of which two have no
   * town-hall record at all (49126 Orée d'Anjou, 98747 Taiarapu-Est).
   */
  readonly communesWithoutCandidate: readonly string[];
}

export interface IngestionPlan {
  readonly communes: readonly PerimeterCommune[];
  readonly sites: readonly SiteCandidate[];
  readonly report: IngestionReport;
}

export interface IngestionPlanInput {
  readonly communes: readonly CommuneRecord[];
  readonly annuaire: readonly AnnuaireRecord[];
  readonly threshold?: number;
}

/**
 * Crosses the two referentials and returns what to write.
 *
 * Communes outside the perimeter are dropped **with** their websites: the
 * directory covers 35 732 communes and v1 measures 1 067, so ingesting the rest
 * would store rows nothing will ever scan. Widening the perimeter later is a
 * threshold change and a re-run, which is exactly the extensibility the brief
 * asks for (§3).
 */
export function buildIngestionPlan(input: IngestionPlanInput): IngestionPlan {
  const threshold = input.threshold ?? V1_POPULATION_THRESHOLD;
  const communes = selectPerimeter(input.communes, threshold);
  const index = indexMairiesByCommune(input.annuaire);

  const sites: SiteCandidate[] = [];
  const communesWithoutCandidate: string[] = [];
  let communesWithSeveralCandidates = 0;

  for (const commune of communes) {
    const candidates = candidatesFor(commune.codeInsee, index);

    if (candidates.length === 0) communesWithoutCandidate.push(commune.codeInsee);
    if (candidates.length > 1) communesWithSeveralCandidates += 1;

    sites.push(...candidates);
  }

  return {
    communes,
    sites,
    report: {
      populationThreshold: threshold,
      communesSeen: input.communes.length,
      communesInPerimeter: communes.length,
      mairieRecords: input.annuaire.length,
      candidateUrls: sites.length,
      communesWithSeveralCandidates,
      communesWithoutCandidate,
    },
  };
}
