import { count } from 'drizzle-orm';
import { sql } from 'drizzle-orm/sql';
import { z } from 'zod';
import type { ResolutionCount, StatsSnapshot } from '../lib/stats/snapshot.js';
import type { Database } from './client.js';
import { site } from './schema.js';

/**
 * The read behind `/stats` (J1-15): the first page of this site whose content
 * comes from the database rather than from the code.
 *
 * Two round trips rather than six, and the reason is where this runs: inside the
 * SSR function, on the path of a visitor's request. Everything that reduces to a
 * scalar is asked for in one statement of sub-selects; the per-state breakdown
 * needs a `group by` and gets a statement of its own.
 *
 * The scalar row is parsed by Zod rather than cast (CLAUDE.md §4). The database
 * is ours, so this is not the untrusted-source case the rule was written for —
 * but `db.execute` hands back `Record<string, unknown>`, and the alternative to
 * parsing is a cast that would keep compiling after a column is renamed by a
 * migration. A parse fails loudly on the first request instead.
 */

/**
 * A `timestamptz`, as `db.execute` hands it over.
 *
 * Measured rather than assumed, and the first render is what measured it: the
 * column arrives as a **string**, not as a `Date`. Drizzle installs its own
 * type parsers on the pool so that it can map columns itself, and raw SQL has
 * no column to map — so the driver's usual conversion never happens. A cast
 * would have compiled and published an invalid date; the parse said so on the
 * first request instead (docs/journal.md 019).
 *
 * Both shapes are accepted because only one of them is ours to guarantee: if a
 * Drizzle upgrade stops overriding the parsers, this keeps working.
 */
const instant = z
  .union([z.date(), z.string().transform((value) => new Date(value))])
  .refine((value) => !Number.isNaN(value.getTime()), 'not a readable timestamp')
  .nullable();

const totalsRow = z.object({
  communes: z.number().int(),
  communes_with_candidate: z.number().int(),
  perimeter_population: z.number().int(),
  measurements: z.number().int(),
  scan_runs: z.number().int(),
  referential_updated_at: instant,
});

/**
 * Every count is cast to `int` in SQL. Without it, `count(*)` comes back from
 * `pg` as a *string* — Postgres returns `bigint`, and the driver refuses to
 * lose precision silently. The cast is safe here by a wide margin: the largest
 * of these figures is the number of communes in France.
 *
 * `sum(population)` is coalesced because it is null on an empty table, which is
 * the state of the database until the ingestion job has run against it.
 */
const TOTALS = sql`
  select
    (select count(*) from commune)::int as communes,
    (select count(distinct commune_id) from site)::int as communes_with_candidate,
    (select coalesce(sum(population), 0) from commune)::int as perimeter_population,
    (select count(*) from measurement)::int as measurements,
    (select count(*) from scan_run)::int as scan_runs,
    (select max(updated_at) from commune) as referential_updated_at
`;

export async function readStats(db: Database): Promise<StatsSnapshot> {
  const result = await db.execute(TOTALS);
  const totals = totalsRow.parse(result.rows[0]);

  const byStatut: ResolutionCount[] = (
    await db
      .select({ statut: site.statutResolution, total: count() })
      .from(site)
      .groupBy(site.statutResolution)
  ).map((row) => ({ statut: row.statut, total: row.total }));

  return {
    communes: totals.communes,
    communesWithCandidate: totals.communes_with_candidate,
    perimeterPopulation: totals.perimeter_population,
    sitesByStatut: byStatut,
    measurements: totals.measurements,
    scanRuns: totals.scan_runs,
    referentialUpdatedAt: totals.referential_updated_at,
  };
}
