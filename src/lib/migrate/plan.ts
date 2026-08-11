/**
 * What a migration run would do, computed before it does it.
 *
 * Drizzle applies pending migrations and says almost nothing about it, which is
 * tolerable at a shell and not here: there is no shell in production
 * (CLAUDE.md §3), so a dispatched workflow's log and its artefact are the only
 * account anyone will ever get of a schema change on real data.
 *
 * The join key is the timestamp, and that is measured rather than assumed:
 * `drizzle.__drizzle_migrations` stores `id`, `hash` and `created_at`, and
 * `created_at` is exactly the `when` of the corresponding journal entry. The
 * tag — the only human-readable name a migration has — exists solely in the
 * journal file, so nothing names what ran unless this module does it.
 *
 * Two situations block a run rather than being reported and passed over. Both
 * mean the database in front of us is not the one these files describe, and in
 * both the safe move is to stop and let a human look:
 *
 *  - **drift** — the database holds a migration this checkout does not have;
 *  - **out-of-order** — a pending migration is older than one already applied,
 *    which is what two branches merged in the wrong order produce.
 */

/** One entry of drizzle/meta/_journal.json. */
export interface JournalEntry {
  readonly idx: number;
  /** Milliseconds since the epoch. The key Drizzle records in the database. */
  readonly when: number;
  /** The only human-readable name a migration has. Never stored in the database. */
  readonly tag: string;
}

export interface MigrationPlan {
  /** Tags already recorded in the database, in journal order. */
  readonly applied: readonly string[];
  /** Tags a run would apply, in the order it would apply them. */
  readonly pending: readonly string[];
  /** Timestamps recorded in the database that no journal entry claims. */
  readonly unknown: readonly number[];
  /** Pending tags older than something already applied. */
  readonly outOfOrder: readonly string[];
  /** True when the run must not proceed. */
  readonly blocked: boolean;
}

export function planMigrations(
  journal: readonly JournalEntry[],
  appliedTimestamps: readonly number[],
): MigrationPlan {
  const ordered = [...journal].sort((a, b) => a.idx - b.idx);
  const applied = new Set(appliedTimestamps);

  const appliedEntries = ordered.filter((entry) => applied.has(entry.when));
  const pendingEntries = ordered.filter((entry) => !applied.has(entry.when));

  const known = new Set(ordered.map((entry) => entry.when));
  const unknown = appliedTimestamps.filter((timestamp) => !known.has(timestamp));

  // `-1` rather than 0: an empty database has applied nothing, and every
  // migration is legitimately "after" that. Using 0 would work by accident
  // today and stop working the day an index of 0 is the one already applied.
  const lastAppliedIdx = appliedEntries.reduce(
    (highest, entry) => Math.max(highest, entry.idx),
    -1,
  );
  const outOfOrder = pendingEntries
    .filter((entry) => entry.idx < lastAppliedIdx)
    .map((entry) => entry.tag);

  return {
    applied: appliedEntries.map((entry) => entry.tag),
    pending: pendingEntries.map((entry) => entry.tag),
    unknown,
    outOfOrder,
    blocked: unknown.length > 0 || outOfOrder.length > 0,
  };
}
