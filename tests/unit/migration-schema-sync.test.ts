import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from '~/db/schema.js';

/**
 * The committed migrations must describe the schema the code compiles against.
 *
 * Nothing else checks this. `pnpm typecheck` reads `src/db/schema.ts` and never
 * opens `drizzle/`; `drizzle-kit check` verifies that the migration history is
 * internally consistent, not that it matches the schema. So a column added to
 * the schema without running `pnpm db:generate` produces a green pipeline, a
 * green deploy, and a `column does not exist` in production — the one place
 * this project has no shell to fix it from (CLAUDE.md §1).
 *
 * The comparison is made against the latest drizzle-kit snapshot, which is the
 * state the migrations add up to. It reads files, which the unit project allows
 * — the anti-I/O guard covers the network (tests/setup/no-io.ts). No database
 * is involved.
 */
const DRIZZLE_DIR = fileURLToPath(new URL('../../drizzle/', import.meta.url));

interface SnapshotColumn {
  name: string;
  type: string;
  notNull: boolean;
}

interface SnapshotTable {
  name: string;
  columns: Record<string, SnapshotColumn>;
  indexes: Record<string, { name: string; isUnique: boolean }>;
  foreignKeys: Record<string, { name: string; onDelete?: string }>;
  checkConstraints: Record<string, { name: string }>;
}

interface JournalEntry {
  idx: number;
  tag: string;
}

const journal = JSON.parse(readFileSync(`${DRIZZLE_DIR}meta/_journal.json`, 'utf8')) as {
  entries: JournalEntry[];
};

const latest = journal.entries.reduce((a, b) => (a.idx > b.idx ? a : b));

const snapshot = JSON.parse(
  readFileSync(`${DRIZZLE_DIR}meta/${String(latest.idx).padStart(4, '0')}_snapshot.json`, 'utf8'),
) as { tables: Record<string, SnapshotTable> };

/**
 * Every table the schema module exports, discovered rather than listed: a
 * sixth table added tomorrow is compared without anyone remembering to add it
 * here. The cast to `unknown[]` is what lets `is()` narrow — the module also
 * exports tuples and a function, and TypeScript refuses a type predicate whose
 * type is not assignable to that union.
 */
const declared = new Map(
  (Object.values(schema) as unknown[])
    .filter((value): value is PgTable => is(value, PgTable))
    .map((table) => {
      const config = getTableConfig(table);
      return [config.name, config] as const;
    }),
);

const migrated = new Map(
  Object.values(snapshot.tables).map((table) => [table.name, table] as const),
);

describe('the committed migrations and the schema', () => {
  it('has something to compare on both sides', () => {
    // Without this, every comparison below would compare two empty sets and
    // pass for it.
    expect(journal.entries.length).toBeGreaterThan(0);
    expect(declared.size).toBe(5);
  });

  it('ships a SQL file for every journal entry', () => {
    const files = new Set(readdirSync(DRIZZLE_DIR).filter((file) => file.endsWith('.sql')));

    for (const entry of journal.entries) {
      expect([...files]).toContain(`${entry.tag}.sql`);
    }
  });

  it('describes the same tables on both sides', () => {
    expect([...migrated.keys()].sort()).toEqual([...declared.keys()].sort());
  });

  it.each([...declared])('declares the same columns on %s', (name, config) => {
    const applied = Object.values(migrated.get(name)?.columns ?? {}).map((column) => ({
      name: column.name,
      type: column.type,
      notNull: column.notNull,
    }));

    const expected = config.columns.map((column) => ({
      name: column.name,
      type: column.getSQLType(),
      notNull: column.notNull,
    }));

    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

    expect(applied.sort(byName)).toEqual(expected.sort(byName));
  });

  it.each([...declared])('declares the same constraints on %s', (name, config) => {
    const table = migrated.get(name);

    expect(Object.keys(table?.checkConstraints ?? {}).sort()).toEqual(
      config.checks.map((constraint) => constraint.name).sort(),
    );

    expect(
      Object.values(table?.indexes ?? {})
        .map((index) => `${index.name}${index.isUnique ? ' (unique)' : ''}`)
        .sort(),
    ).toEqual(
      config.indexes
        .map((index) => `${index.config.name ?? ''}${index.config.unique ? ' (unique)' : ''}`)
        .sort(),
    );

    // The deletion rules are the part of the schema that quietly destroys data
    // when it drifts: a `restrict` that becomes a `cascade` in the database and
    // not in the code is a history nobody meant to delete.
    expect(
      Object.values(table?.foreignKeys ?? {})
        .map((key) => `${key.name} on delete ${key.onDelete ?? 'no action'}`)
        .sort(),
    ).toEqual(
      config.foreignKeys
        .map((key) => `${key.getName()} on delete ${key.onDelete ?? 'no action'}`)
        .sort(),
    );
  });
});
