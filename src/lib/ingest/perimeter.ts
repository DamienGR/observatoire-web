import type { CommuneRecord } from '../sources/geo.js';

/**
 * The v1 perimeter: French communes of **more than** 10 000 inhabitants
 * (docs/brief.md §3).
 *
 * The exact count is derived from the API rather than from a secondary source —
 * the brief calls that "le premier test d'ingestion". Measured on the
 * referential of 6 August 2026: 34 969 communes, of which **1 067** are in the
 * perimeter. The brief's "de l'ordre de 950 à 1 000 entités" is an estimate,
 * and this module is what makes the estimate unnecessary.
 */
export const V1_POPULATION_THRESHOLD = 10_000;

/**
 * A commune of the perimeter: the parser's record with its population narrowed
 * to a number.
 *
 * The narrowing is the point. `commune.population` is `not null` in the schema
 * while `CommuneRecord.population` is `number | null`, and the only honest
 * bridge between the two is the function that already decides on population.
 * Anywhere else the bridge would be a `?? 0`, which stores a wrong number for
 * a commune whose figure is simply unknown.
 */
export interface PerimeterCommune extends CommuneRecord {
  readonly population: number;
}

/**
 * Strictly above the threshold, as the brief words it, and unknown populations
 * are out: six communes carry no population at all, and "not measured" is not
 * "above 10 000".
 */
export function isInPerimeter(
  commune: CommuneRecord,
  threshold: number = V1_POPULATION_THRESHOLD,
): commune is PerimeterCommune {
  return commune.population !== null && commune.population > threshold;
}

/**
 * The communes to ingest, deduplicated by INSEE code and ordered by it.
 *
 * Both properties exist for the writer downstream. The order makes two runs on
 * the same data produce the same statements, which is what lets an interrupted
 * run be compared with a complete one. The deduplication prevents a batched
 * upsert from meeting the same key twice, which Postgres rejects outright
 * ("ON CONFLICT DO UPDATE command cannot affect row a second time") — and it
 * rejects the whole batch, not the duplicate.
 */
export function selectPerimeter(
  communes: readonly CommuneRecord[],
  threshold: number = V1_POPULATION_THRESHOLD,
): PerimeterCommune[] {
  const kept = new Map<string, PerimeterCommune>();

  for (const commune of communes) {
    if (isInPerimeter(commune, threshold)) {
      // Last one wins: on a referential that ever sent the same code twice, the
      // later record is the more recent statement about it.
      kept.set(commune.codeInsee, commune);
    }
  }

  return [...kept.values()].sort((left, right) => left.codeInsee.localeCompare(right.codeInsee));
}
