import { count, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { IngestionPlan } from '../lib/ingest/plan.js';
import type { Database } from './client.js';
import { commune, site } from './schema.js';

/**
 * Writes an ingestion plan. Decides nothing.
 *
 * Every judgement — which communes are in the perimeter, which URLs are
 * candidates — was made by the pure planner in `src/lib/ingest/`, which is why
 * that half is unit tested and this one is exercised against a real Postgres.
 *
 * Two properties hold here and are asserted in tests/integration/ingest.test.ts,
 * because they are the ones a second run depends on (CLAUDE.md §8: every
 * operation is idempotent):
 *
 *  1. **Re-ingesting converges.** Communes are upserted on their INSEE code,
 *     candidate sites are inserted only if that (commune, url) pair is unknown.
 *     Running the job twice writes the same rows, never a duplicate.
 *  2. **Re-ingesting never resets a resolution state.** A `site` whose
 *     `statut_resolution` reached `verifie` — or `invalide` — is left strictly
 *     alone when the directory proposes the same URL again. `DO NOTHING`, not
 *     `DO UPDATE`: the directory has nothing new to say about a URL we have
 *     already judged, and quietly returning it to `candidat` would erase the
 *     work of the state machine (J1-06) on every run.
 *
 * Nothing is ever deleted. A commune that drops below the threshold, or a URL
 * the directory withdraws, keeps its row and its history — retiring a candidate
 * is a decision with a trace, which is the whole reason the brief models
 * resolution as a process (docs/brief.md §4).
 */

/** What the run actually wrote, as opposed to what it planned. */
export interface IngestionOutcome {
  readonly communesPlanned: number;
  readonly communesInserted: number;
  readonly communesUpdated: number;
  readonly sitesPlanned: number;
  readonly sitesInserted: number;
  /** Candidates the database already held. On a second identical run: all of them. */
  readonly sitesAlreadyKnown: number;
}

export interface ApplyIngestionOptions {
  /**
   * Rows per statement. Postgres caps a statement at 65 535 parameters and a
   * commune costs seven, so 500 leaves an order of magnitude of headroom while
   * keeping the number of round trips small.
   */
  readonly chunkSize?: number;
  /** Injected so a test can prove `updated_at` moved. */
  readonly now?: () => Date;
}

/**
 * The value the failed insert *would* have written, in an upsert's update
 * branch. A multi-row statement has no other way to name it.
 *
 * `sql.identifier` rather than string interpolation: the names are constants of
 * the schema module, but CLAUDE.md §7 has no exception for "constants I trust".
 */
function excluded(column: AnyPgColumn): SQL {
  return sql`excluded.${sql.identifier(column.name)}`;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/**
 * Applies the plan in a single transaction.
 *
 * One transaction for the lot: an ingestion that half-applied would leave
 * communes without their candidate sites, and the next run would have no way to
 * tell that state from a directory that dropped them. The volume makes this
 * affordable — 1 067 communes and 1 224 sites, measured on 7 August 2026.
 */
export async function applyIngestion(
  db: Database,
  plan: IngestionPlan,
  options: ApplyIngestionOptions = {},
): Promise<IngestionOutcome> {
  const chunkSize = options.chunkSize ?? 500;
  const now = options.now ?? ((): Date => new Date());

  return db.transaction(async (tx) => {
    const [before] = await tx.select({ total: count() }).from(commune);

    for (const rows of chunk(plan.communes, chunkSize)) {
      await tx
        .insert(commune)
        .values(
          rows.map((entry) => ({
            codeInsee: entry.codeInsee,
            nom: entry.nom,
            population: entry.population,
            departement: entry.departement,
            region: entry.region,
            epci: entry.epci,
          })),
        )
        .onConflictDoUpdate({
          target: commune.codeInsee,
          set: {
            nom: excluded(commune.nom),
            population: excluded(commune.population),
            departement: excluded(commune.departement),
            region: excluded(commune.region),
            epci: excluded(commune.epci),
            // Set by hand: Drizzle's `$onUpdate` fires on `update()`, not on the
            // conflict branch of an upsert, so the column would otherwise say
            // the row has not changed since it was first ingested.
            updatedAt: now(),
          },
        });
    }

    const [after] = await tx.select({ total: count() }).from(commune);

    let sitesInserted = 0;

    for (const rows of chunk(plan.sites, chunkSize)) {
      const inserted = await tx
        .insert(site)
        .values(
          rows.map((candidate) => ({
            communeId: candidate.communeId,
            url: candidate.url,
            source: candidate.source,
          })),
        )
        // Property 2. The unique index on (commune_id, url) is what makes this
        // a convergence rather than an accumulation.
        .onConflictDoNothing({ target: [site.communeId, site.url] })
        .returning({ id: site.id });

      sitesInserted += inserted.length;
    }

    const communesInserted = (after?.total ?? 0) - (before?.total ?? 0);

    return {
      communesPlanned: plan.communes.length,
      communesInserted,
      // Nothing is deleted, so every planned commune that is not new was updated.
      communesUpdated: plan.communes.length - communesInserted,
      sitesPlanned: plan.sites.length,
      sitesInserted,
      sitesAlreadyKnown: plan.sites.length - sitesInserted,
    };
  });
}
