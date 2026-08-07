import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, type Connection } from '~/db/client.js';
import { applyIngestion } from '~/db/ingest.js';
import { commune, site } from '~/db/schema.js';
import { requireEnv } from '~/lib/env/index.js';
import { serverEnv } from '~/lib/env/runtime.js';
import { buildIngestionPlan, type IngestionPlan } from '~/lib/ingest/plan.js';
import type { AnnuaireRecord } from '~/lib/sources/annuaire.js';
import type { CommuneRecord } from '~/lib/sources/geo.js';

/**
 * The writer, against a real Postgres.
 *
 * These are the properties the ops surface will depend on and that no unit test
 * can prove, because they are properties of a database and not of a function:
 * that re-ingesting converges instead of accumulating, that it does not undo a
 * resolution decision, and that the constraints of J1-08 accept what the
 * planner produces.
 *
 * It applies the migrations itself rather than assuming a prepared schema. That
 * costs a second and buys two things: the suite runs against any empty
 * database, and every run exercises `drizzle/*.sql` on a real server one more
 * time (CLAUDE.md §6.5).
 *
 * Where it runs today: a throwaway Postgres 16 cluster inside the session
 * container (docs/journal.md 014). In CI it will run against an ephemeral Neon
 * branch — that is J1-11, blocked on a console setting, which is why this file
 * exists before the job that will execute it.
 */
const DATABASE_URL = requireEnv(serverEnv(), 'DATABASE_URL');

let connection: Connection;

function communeRecord(
  codeInsee: string,
  population: number,
  nom = `Commune ${codeInsee}`,
): CommuneRecord {
  return { codeInsee, nom, population, departement: '01', region: '84', epci: '240100883' };
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

const plan: IngestionPlan = buildIngestionPlan({
  communes: [
    communeRecord('01004', 15_934, 'Ambérieu-en-Bugey'),
    communeRecord('2A004', 71_361, 'Ajaccio'),
    // Below the threshold: must never reach the database.
    communeRecord('01001', 785, "L'Abergement-Clémenciat"),
  ],
  annuaire: [
    mairieRecord('01004', [
      'https://www.amberieuenbugey.fr/',
      'https://www.amberieuenbugey.fr/demarches',
    ]),
    mairieRecord('2A004', ['https://www.ajaccio.fr/']),
    mairieRecord('01001', ['https://www.abergement-clemenciat.fr/']),
  ],
});

beforeAll(async () => {
  connection = connect(DATABASE_URL);
  await migrate(connection.db, { migrationsFolder: 'drizzle' });

  // A clean slate, whatever the branch was reused from. `restart identity`
  // keeps the sequence of `site` from drifting between runs, and `cascade`
  // covers the tables that depend on these two.
  await connection.db.execute(sql`truncate table commune restart identity cascade`);
}, 60_000);

afterAll(async () => {
  await connection.close();
});

describe('applyIngestion, on a real Postgres', () => {
  it('writes the perimeter and its candidate URLs', async () => {
    const outcome = await applyIngestion(connection.db, plan);

    expect(outcome).toMatchObject({
      communesPlanned: 2,
      communesInserted: 2,
      communesUpdated: 0,
      sitesPlanned: 3,
      sitesInserted: 3,
      sitesAlreadyKnown: 0,
    });
  });

  it('stores the commune with the vocabulary of the schema', async () => {
    const [stored] = await connection.db
      .select()
      .from(commune)
      .where(eq(commune.codeInsee, '2A004'));

    expect(stored).toMatchObject({
      codeInsee: '2A004',
      nom: 'Ajaccio',
      population: 71_361,
      departement: '01',
      region: '84',
    });
  });

  it('leaves a commune below the threshold out of the database entirely', async () => {
    const rows = await connection.db.select().from(commune).where(eq(commune.codeInsee, '01001'));

    expect(rows).toEqual([]);
  });

  it('records every candidate as `candidat`, sourced from the directory', async () => {
    const rows = await connection.db.select().from(site).where(eq(site.communeId, '01004'));

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.statutResolution === 'candidat')).toBe(true);
    expect(rows.every((row) => row.source === 'annuaire')).toBe(true);
    expect(rows.every((row) => row.verifiedAt === null)).toBe(true);
  });

  it('converges when run again on the same data', async () => {
    // CLAUDE.md §8: every operation is idempotent — replaying it duplicates
    // nothing and corrupts nothing. This is the property the whole ops surface
    // rests on, so it is asserted on the row counts, not on the return value.
    const outcome = await applyIngestion(connection.db, plan);

    expect(outcome).toMatchObject({
      communesInserted: 0,
      communesUpdated: 2,
      sitesInserted: 0,
      sitesAlreadyKnown: 3,
    });

    const [communes] = await connection.db
      .select({ total: sql<number>`count(*)::int` })
      .from(commune);
    const [sites] = await connection.db.select({ total: sql<number>`count(*)::int` }).from(site);

    expect(communes?.total).toBe(2);
    expect(sites?.total).toBe(3);
  });

  it('never resets the resolution state of a URL already judged', async () => {
    // The failure this test exists to prevent: the directory proposes the same
    // URL every week, and an upsert that touched `statut_resolution` would undo
    // the work of J1-06 on every run — silently, and only for the sites someone
    // had bothered to verify.
    const verifiedAt = new Date('2026-08-07T09:00:00Z');

    await connection.db
      .update(site)
      .set({ statutResolution: 'verifie', verifiedAt })
      .where(eq(site.url, 'https://www.ajaccio.fr/'));

    await applyIngestion(connection.db, plan);

    const [judged] = await connection.db
      .select()
      .from(site)
      .where(eq(site.url, 'https://www.ajaccio.fr/'));

    expect(judged?.statutResolution).toBe('verifie');
    expect(judged?.verifiedAt).toEqual(verifiedAt);
  });

  it('updates a commune whose population changed, and says when', async () => {
    const before = await connection.db.select().from(commune).where(eq(commune.codeInsee, '01004'));
    const updatedAt = new Date('2027-01-01T00:00:00Z');

    const grown = buildIngestionPlan({
      communes: [communeRecord('01004', 16_500, 'Ambérieu-en-Bugey')],
      annuaire: [mairieRecord('01004', ['https://www.amberieuenbugey.fr/'])],
    });

    await applyIngestion(connection.db, grown, { now: () => updatedAt });

    const [after] = await connection.db
      .select()
      .from(commune)
      .where(eq(commune.codeInsee, '01004'));

    expect(after?.population).toBe(16_500);
    // `$onUpdate` does not fire on the conflict branch of an upsert, so this
    // asserts the column is maintained by hand there — a column that only
    // *looks* maintained is worse than no column at all.
    expect(after?.updatedAt).toEqual(updatedAt);
    expect(after?.createdAt).toEqual(before[0]?.createdAt);
  });

  it('leaves the candidates of a commune it no longer proposes alone', async () => {
    // Ingestion never deletes. A URL the directory drops keeps its row, because
    // retiring a candidate is a decision that has to leave a trace.
    const rows = await connection.db.select().from(site).where(eq(site.communeId, '01004'));

    expect(rows).toHaveLength(2);
  });

  it('writes 1 000 communes in one transaction, in chunks', async () => {
    // The real perimeter is 1 067 communes and 1 224 sites, above the 500-row
    // chunk: this is the path production takes, and the one where a mistake in
    // the chunking would only show up at full scale.
    const many = buildIngestionPlan({
      communes: Array.from({ length: 1_000 }, (_, index) =>
        communeRecord(`9${String(index).padStart(4, '0')}`, 20_000),
      ),
      annuaire: Array.from({ length: 1_000 }, (_, index) =>
        mairieRecord(`9${String(index).padStart(4, '0')}`, [`https://ville-${String(index)}.fr/`]),
      ),
    });

    const outcome = await applyIngestion(connection.db, many);

    expect(outcome.communesInserted).toBe(1_000);
    expect(outcome.sitesInserted).toBe(1_000);
  }, 30_000);
});
