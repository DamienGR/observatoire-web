import { sql } from 'drizzle-orm/sql';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { z } from 'zod';
import type { Database } from './client.js';

/**
 * Drizzle's own bookkeeping, read from the outside.
 *
 * The migrator keeps `drizzle.__drizzle_migrations` (`id`, `hash`,
 * `created_at`) and offers no way to ask what it holds — measured on a real
 * Postgres rather than read in a changelog, together with the fact that
 * `created_at` is exactly the `when` of the matching journal entry. That
 * timestamp is the only key linking a row in the database to a file in the
 * repository.
 */

/** Where the migrator keeps its table. Drizzle's defaults, named once. */
const MIGRATIONS_FOLDER = 'drizzle';
const MIGRATIONS_TABLE = 'drizzle.__drizzle_migrations';

/**
 * `created_at` is a `bigint`, so `pg` hands it over as a string rather than
 * lose precision — the same trap J1-15 met with a timestamp, met again one
 * table further. Coerced here, once, instead of at each call site.
 */
const appliedRow = z.object({ created_at: z.coerce.number().int() });

/**
 * The timestamps of the migrations this database has applied, oldest first.
 *
 * An absent table means an untouched database, not an error: that is the state
 * of every fresh Neon branch and — as of 11 August 2026 — of production itself.
 * `to_regclass` answers null instead of raising, which is what lets the normal
 * first case stay on the normal path.
 */
export async function readAppliedMigrations(db: Database): Promise<number[]> {
  const presence = await db.execute(
    sql`select to_regclass(${MIGRATIONS_TABLE}) is not null as present`,
  );

  if (!z.object({ present: z.boolean() }).parse(presence.rows[0]).present) return [];

  const rows = await db.execute(
    sql`select created_at from drizzle.__drizzle_migrations order by created_at`,
  );

  return rows.rows.map((row) => appliedRow.parse(row).created_at);
}

/**
 * Applies whatever is pending. Idempotent by Drizzle's own bookkeeping: a
 * second run applies nothing, which is what CLAUDE.md §8 requires of every
 * operation this project can dispatch.
 */
export async function applyMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
