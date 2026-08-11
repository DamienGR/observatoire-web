import { describe, expect, it } from 'vitest';
import { planMigrations, type JournalEntry } from './plan.js';

/**
 * What a migration run would do, before it does it.
 *
 * The cases below are built from the repository's real journal
 * (drizzle/meta/_journal.json), whose two entries carry the timestamps Drizzle
 * writes verbatim into `drizzle.__drizzle_migrations.created_at` — measured on
 * a real Postgres, not assumed (docs/journal.md 021). That join key is the
 * whole reason this module exists: the database records *when*, never the tag,
 * so nothing in a log says which migration ran unless something computes it.
 */
const JOURNAL: readonly JournalEntry[] = [
  { idx: 0, when: 1_786_029_350_888, tag: '0000_married_whistler' },
  { idx: 1, when: 1_786_033_672_933, tag: '0001_cloudy_doctor_doom' },
];

describe('planMigrations', () => {
  it('plans every migration on a database that has none', () => {
    // The state of the production database on 11 August 2026: connected,
    // reachable, and without a single table.
    const plan = planMigrations(JOURNAL, []);

    expect(plan.pending).toEqual(['0000_married_whistler', '0001_cloudy_doctor_doom']);
    expect(plan.applied).toEqual([]);
    expect(plan.blocked).toBe(false);
  });

  it('plans nothing when the database is up to date', () => {
    const plan = planMigrations(JOURNAL, [1_786_029_350_888, 1_786_033_672_933]);

    expect(plan.pending).toEqual([]);
    expect(plan.applied).toEqual(['0000_married_whistler', '0001_cloudy_doctor_doom']);
    expect(plan.blocked).toBe(false);
  });

  it('plans only the tail when the database is behind', () => {
    const plan = planMigrations(JOURNAL, [1_786_029_350_888]);

    expect(plan.pending).toEqual(['0001_cloudy_doctor_doom']);
    expect(plan.applied).toEqual(['0000_married_whistler']);
  });

  it('orders by index rather than by the order of the file', () => {
    // The journal is written in order today. Sorting is not defensiveness: the
    // index *is* the definition of migration order, and reading it from the
    // array's order would make a reordered file silently change what runs.
    const plan = planMigrations([...JOURNAL].reverse(), []);

    expect(plan.pending).toEqual(['0000_married_whistler', '0001_cloudy_doctor_doom']);
  });

  it('refuses to run when the database holds a migration this checkout does not', () => {
    // Drift. The database was migrated from a branch, or history was rewritten:
    // whatever the cause, the schema in front of us is not the one these SQL
    // files describe, and applying more on top builds on an unknown base.
    const plan = planMigrations(JOURNAL, [1_786_029_350_888, 1_999_999_999_999]);

    expect(plan.unknown).toEqual([1_999_999_999_999]);
    expect(plan.blocked).toBe(true);
  });

  it('refuses to run when a pending migration is older than an applied one', () => {
    // Two branches, each adding a migration, merged in the order nobody
    // intended: 0001 would run *after* 0002, producing a schema that no
    // sequence of these files can reproduce. Drizzle would apply it without a
    // word — it only tracks what ran, not in which order it should have.
    const journal: readonly JournalEntry[] = [
      ...JOURNAL,
      { idx: 2, when: 1_786_100_000_000, tag: '0002_late_arrival' },
    ];
    const plan = planMigrations(journal, [1_786_029_350_888, 1_786_100_000_000]);

    expect(plan.outOfOrder).toEqual(['0001_cloudy_doctor_doom']);
    expect(plan.blocked).toBe(true);
  });

  it('is not blocked by an out-of-order check when nothing has been applied', () => {
    // The empty database must never look like an anomaly: it is the normal
    // first state, and a blocked plan there would stop the one run that matters.
    expect(planMigrations(JOURNAL, []).outOfOrder).toEqual([]);
  });

  it('says nothing is pending for an empty journal, rather than failing', () => {
    // A repository with no migration at all is a legitimate state — the first
    // day. It is not drift, and it is not an error.
    const plan = planMigrations([], []);

    expect(plan).toMatchObject({ pending: [], applied: [], unknown: [], blocked: false });
  });
});
