import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { connect } from '../db/client.js';
import { applyMigrations, readAppliedMigrations } from '../db/migrations.js';
import { requireEnv } from '../lib/env/index.js';
import { serverEnv } from '../lib/env/runtime.js';
import { parseJournal } from '../lib/migrate/journal.js';
import { planMigrations, type MigrationPlan } from '../lib/migrate/plan.js';
import { describeErrorChain } from '../lib/log/errors.js';
import { createLogger, type Logger } from '../lib/log/index.js';

/**
 * Applies the schema migrations to a database (J1-16).
 *
 * This job exists because of a gap nobody had noticed until production hit it:
 * the roadmap said how a *preview* would get a schema (J1-11, an ephemeral Neon
 * branch) and how the data would be loaded (J1-14), and never said how
 * production receives its own migrations. It received none. On 11 August 2026
 * the ingestion failed with `relation "commune" does not exist` — the five
 * tables had only ever existed in throwaway Postgres clusters destroyed with
 * their session (docs/journal.md 021).
 *
 * There is no shell in production (CLAUDE.md §3), so this is a workflow someone
 * dispatches: `.github/workflows/migrate.yml`, on the `production` environment,
 * behind a required reviewer.
 *
 * It says what it *would* do before doing it, and defaults to saying only that.
 * A schema change on real data is the one operation this repository cannot take
 * back — drizzle-kit generates no down migration (docs/roadmap.md) — so the
 * default has to be the one that cannot destroy anything.
 *
 *   node dist-jobs/jobs/migrate.js [--apply] [--report <path>]
 */

const JOURNAL_PATH = 'drizzle/meta/_journal.json';

interface JobArguments {
  /** Applying is opt-in. Reading is what happens by default. */
  readonly apply: boolean;
  readonly reportPath: string | undefined;
}

function parseArguments(argv: readonly string[]): JobArguments {
  const reportIndex = argv.indexOf('--report');

  return {
    apply: argv.includes('--apply'),
    reportPath: reportIndex === -1 ? undefined : argv[reportIndex + 1],
  };
}

function describe(plan: MigrationPlan): Record<string, unknown> {
  return {
    applied: plan.applied.length,
    pending: plan.pending,
    unknown: plan.unknown,
    outOfOrder: plan.outOfOrder,
  };
}

/**
 * The direct endpoint, and no fallback to the pooled one.
 *
 * The ingestion job falls back because a bulk upsert through a pooler is merely
 * a bad idea; a migration through one is a session-level operation running
 * where sessions do not exist. Failing by name beats succeeding strangely.
 */
function connectionString(): string {
  return requireEnv(serverEnv(), 'DATABASE_URL_UNPOOLED');
}

async function run(argv: readonly string[], logger: Logger): Promise<void> {
  const options = parseArguments(argv);
  const startedAt = Date.now();

  const journal = parseJournal(JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')));
  const connection = connect(connectionString());

  let plan: MigrationPlan;
  let applied = false;

  try {
    plan = planMigrations(journal, await readAppliedMigrations(connection.db));
    logger.info('plan', describe(plan));

    if (plan.blocked) {
      // Not an apology for stopping: the schema in front of us is not the one
      // these files describe, and applying more on top builds on an unknown
      // base. A human has to look.
      throw new Error(
        'The database does not match this checkout, so nothing was applied.\n' +
          (plan.unknown.length > 0
            ? `  - it has applied ${String(plan.unknown.length)} migration(s) absent from drizzle/\n`
            : '') +
          (plan.outOfOrder.length > 0
            ? `  - these are older than something already applied: ${plan.outOfOrder.join(', ')}\n`
            : '') +
          'Check which branch this database was migrated from before doing anything else.',
      );
    }

    if (!options.apply) {
      logger.info('dry run: nothing applied', { wouldApply: plan.pending.length });
    } else if (plan.pending.length === 0) {
      // Idempotence, out loud: dispatching this twice is a legitimate thing to
      // do and must read as a no-op rather than as a success nobody can size.
      logger.info('nothing to apply, the database is up to date');
    } else {
      await applyMigrations(connection.db);
      applied = true;

      // Read back rather than trust the call that just returned. This is the
      // only account anyone gets of a schema change on real data.
      const after = planMigrations(journal, await readAppliedMigrations(connection.db));
      logger.info('applied', { migrations: plan.pending, stillPending: after.pending });

      if (after.pending.length > 0) {
        throw new Error(
          `The migrator returned, but ${String(after.pending.length)} migration(s) are still pending: ` +
            `${after.pending.join(', ')}.`,
        );
      }
    }
  } finally {
    await connection.close();
  }

  writeReport(options.reportPath, {
    startedAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    apply: options.apply,
    applied,
    plan: describe(plan),
  });

  logger.info('done', { durationMs: Date.now() - startedAt });
}

/**
 * Written on failure too: a run that stopped halfway is the one worth reading,
 * and from a cloud-only session the artefact is the only way to read it.
 */
function writeReport(path: string | undefined, report: unknown): void {
  if (path === undefined) return;

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

const logger = createLogger({
  sink: (line) => {
    process.stdout.write(`${line}\n`);
  },
});

const argv = process.argv.slice(2);

try {
  await run(argv, logger);
} catch (error) {
  // The message, never the payload: this log is public on a public repository.
  // The whole chain: Drizzle wraps the driver's error, so the outer message
  // says the query failed and the reason is one `cause` away.
  const message = describeErrorChain(error);
  logger.error('migration failed', { error: message });

  writeReport(parseArguments(argv).reportPath, { failed: true, error: message });

  process.exitCode = 1;
}
