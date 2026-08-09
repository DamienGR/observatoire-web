import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, type Connection } from '~/db/client.js';
import { applyIngestion } from '~/db/ingest.js';
import { site } from '~/db/schema.js';
import { readStats } from '~/db/stats.js';
import { requireEnv } from '~/lib/env/index.js';
import { serverEnv } from '~/lib/env/runtime.js';
import { buildIngestionPlan } from '~/lib/ingest/plan.js';
import type { AnnuaireRecord } from '~/lib/sources/annuaire.js';
import type { CommuneRecord } from '~/lib/sources/geo.js';
import { buildStatsView } from '~/lib/stats/view.js';

/**
 * The read behind `/stats`, against a real Postgres.
 *
 * It belongs here and not in the unit project for a reason this suite has
 * already paid once: the query is raw SQL, so nothing between it and the page
 * is checked by the type system. The first render against a real database
 * returned `max(updated_at)` as a **string** — Drizzle installs its own type
 * parsers on the pool and `db.execute` has no column to map — which every unit
 * test in the world would have missed and which the Zod parse caught on the
 * first request (docs/journal.md 019). The assertion on the *type* below is
 * that defect, pinned.
 */
const DATABASE_URL = requireEnv(serverEnv(), 'DATABASE_URL');

let connection: Connection;

function communeRecord(codeInsee: string, population: number): CommuneRecord {
  return {
    codeInsee,
    nom: `Commune ${codeInsee}`,
    population,
    departement: '01',
    region: '84',
    epci: '240100883',
  };
}

function mairieRecord(codeInsee: string, urls: readonly string[]): AnnuaireRecord {
  return {
    id: `id-${codeInsee}`,
    nom: `Mairie - ${codeInsee}`,
    codeInsee,
    pivots: [{ typeServiceLocal: 'mairie', codesInsee: [codeInsee] }],
    urls,
    published: true,
    modifiedAt: null,
  };
}

/** Two communes, three candidate URLs, one commune with no URL at all. */
const plan = buildIngestionPlan({
  communes: [communeRecord('01004', 15_934), communeRecord('2A004', 71_361)],
  annuaire: [
    mairieRecord('01004', ['https://a.example.fr/', 'https://a.example.fr/demarches']),
    mairieRecord('2A004', []),
  ],
});

beforeAll(async () => {
  connection = connect(DATABASE_URL, { statementTimeoutMs: 10_000 });
  await migrate(connection.db, { migrationsFolder: 'drizzle' });
  await connection.db.execute(sql`truncate table commune restart identity cascade`);
}, 60_000);

afterAll(async () => {
  await connection.close();
});

describe('readStats, on a real Postgres', () => {
  it('counts nothing on an empty database, and says so without dividing by zero', async () => {
    // The state of the production database until the ingestion job has run
    // against it — that is, the state the page renders in on its first day.
    const snapshot = await readStats(connection.db);

    expect(snapshot).toEqual({
      communes: 0,
      communesWithCandidate: 0,
      perimeterPopulation: 0,
      sitesByStatut: [],
      measurements: 0,
      scanRuns: 0,
      referentialUpdatedAt: null,
    });

    const view = buildStatsView(snapshot);
    expect(view.resolution.map((row) => row.share)).toEqual([0, 0, 0, 0]);
    expect(view.hasCommunes).toBe(false);
  });

  it('counts the perimeter, its population and its candidate URLs', async () => {
    await applyIngestion(connection.db, plan);

    const snapshot = await readStats(connection.db);

    expect(snapshot.communes).toBe(2);
    expect(snapshot.perimeterPopulation).toBe(15_934 + 71_361);
    expect(snapshot.communesWithCandidate).toBe(1);
    expect(snapshot.sitesByStatut).toEqual([{ statut: 'candidat', total: 2 }]);
    expect(snapshot.measurements).toBe(0);
    expect(snapshot.scanRuns).toBe(0);
  });

  it('returns the last referential write as a Date, not as a string', async () => {
    // The defect of the first render. `toBeInstanceOf` rather than a value
    // comparison: what broke was the type, and `new Date("…")` on the page
    // would have published `Invalid Date` without anything failing.
    const { referentialUpdatedAt } = await readStats(connection.db);

    expect(referentialUpdatedAt).toBeInstanceOf(Date);
    expect(referentialUpdatedAt?.getTime()).not.toBeNaN();
  });

  it('follows a URL as it changes state, one state per row', async () => {
    await connection.db
      .update(site)
      .set({ statutResolution: 'verifie', verifiedAt: new Date() })
      .where(eq(site.url, 'https://a.example.fr/'));

    const snapshot = await readStats(connection.db);
    const view = buildStatsView(snapshot);

    expect(view.sites).toBe(2);
    expect(view.resolution.map((row) => [row.statut, row.total])).toEqual([
      ['candidat', 1],
      ['verifie', 1],
      ['invalide', 0],
      ['a_revoir', 0],
    ]);
    expect(view.resolution.map((row) => row.share)).toEqual([0.5, 0.5, 0, 0]);
  });
});
