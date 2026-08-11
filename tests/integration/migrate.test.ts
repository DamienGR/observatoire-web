import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, type Connection } from '~/db/client.js';
import { applyMigrations, readAppliedMigrations } from '~/db/migrations.js';
import { requireEnv } from '~/lib/env/index.js';
import { serverEnv } from '~/lib/env/runtime.js';
import { parseJournal } from '~/lib/migrate/journal.js';
import { planMigrations } from '~/lib/migrate/plan.js';

/**
 * Reading Drizzle's bookkeeping, against a real Postgres.
 *
 * The planner is pure and unit tested; what cannot be unit tested is the half
 * that talks to the database, and it is where this repository has now been
 * bitten twice in the same way. `created_at` is a `bigint`, so `pg` returns it
 * as a **string** rather than lose precision — exactly the trap J1-15 met with
 * a timestamp, one table further along. A cast would compile and produce a plan
 * that silently believes nothing has ever been applied, which on a production
 * database means re-running every migration.
 *
 * So the assertions below are about types as much as about values.
 */
const DATABASE_URL = requireEnv(serverEnv(), 'DATABASE_URL');

const journal = parseJournal(JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')));

let connection: Connection;

beforeAll(async () => {
  connection = connect(DATABASE_URL);
  await applyMigrations(connection.db);
}, 60_000);

afterAll(async () => {
  await connection.close();
});

describe('readAppliedMigrations, on a real Postgres', () => {
  it('reads the applied timestamps as numbers, not as strings', async () => {
    // The defect this file exists for. `expect(typeof …).toBe('number')` rather
    // than a value comparison: what breaks is the type, and `'1786029350888'`
    // compares unequal to every journal entry without anything failing.
    const applied = await readAppliedMigrations(connection.db);

    expect(applied.length).toBeGreaterThan(0);
    expect(applied.every((timestamp) => typeof timestamp === 'number')).toBe(true);
    expect(applied.every(Number.isInteger)).toBe(true);
  });

  it('matches every journal entry, which is what makes the plan meaningful', async () => {
    const applied = await readAppliedMigrations(connection.db);

    // The join key of the whole module: `created_at` in the database is the
    // `when` of the journal. If this ever fails, the plan is fiction.
    expect([...applied].sort()).toEqual(journal.map((entry) => entry.when).sort());
  });

  it('reports nothing pending, no drift, and no anomaly once migrated', async () => {
    const plan = planMigrations(journal, await readAppliedMigrations(connection.db));

    expect(plan.pending).toEqual([]);
    expect(plan.unknown).toEqual([]);
    expect(plan.outOfOrder).toEqual([]);
    expect(plan.blocked).toBe(false);
  });

  it('applies nothing on a second run', async () => {
    // CLAUDE.md §8: replaying an operation duplicates nothing. Dispatching this
    // workflow twice is a legitimate thing to do, so it has to be a no-op.
    const before = await readAppliedMigrations(connection.db);

    await applyMigrations(connection.db);

    expect(await readAppliedMigrations(connection.db)).toEqual(before);
  });
});
