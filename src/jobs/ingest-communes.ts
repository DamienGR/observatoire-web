import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { connect } from '../db/client.js';
import { applyIngestion, type IngestionOutcome } from '../db/ingest.js';
import { requireEnv, type Env } from '../lib/env/index.js';
import { serverEnv } from '../lib/env/runtime.js';
import { buildIngestionPlan, type IngestionPlan } from '../lib/ingest/plan.js';
import { fetchCommunes, fetchMairies } from '../lib/ingest/referentials.js';
import { createLogger, type Logger } from '../lib/log/index.js';

/**
 * The commune referential ingestion job (J1-14).
 *
 * There is no shell in production (CLAUDE.md §3), so this is not a script
 * someone runs "on the server": it is dispatched by
 * `.github/workflows/ingest.yml`, it writes its report to a file the workflow
 * uploads as an artefact, and it says everything it did on stdout — from a
 * cloud-only session that log is the only window on it.
 *
 * The work itself is elsewhere and on purpose. Deciding what to write is pure
 * and unit tested (`src/lib/ingest/`), writing it is exercised against a real
 * Postgres (`src/db/ingest.ts`), and this file is the wiring: read the
 * environment, download, plan, apply, report. It holds no rule of its own,
 * which is why it has no test of its own.
 *
 *   node dist-jobs/jobs/ingest-communes.js [--dry-run] [--report <path>]
 */

interface JobArguments {
  readonly dryRun: boolean;
  readonly reportPath: string | undefined;
}

function parseArguments(argv: readonly string[]): JobArguments {
  const reportIndex = argv.indexOf('--report');

  return {
    dryRun: argv.includes('--dry-run'),
    reportPath: reportIndex === -1 ? undefined : argv[reportIndex + 1],
  };
}

/**
 * The direct endpoint, falling back to the pooled one.
 *
 * A bulk upsert in one transaction is exactly the shape the pooled endpoint
 * serves worst, and §9 already reserves `DATABASE_URL_UNPOOLED` for the work
 * that needs a session of its own.
 */
function connectionString(env: Env): string {
  return env.DATABASE_URL_UNPOOLED ?? requireEnv(env, 'DATABASE_URL');
}

async function download(logger: Logger): Promise<IngestionPlan> {
  const deps = { fetch };

  logger.info('downloading the commune referential', { source: 'geo.api.gouv.fr' });
  const communes = await fetchCommunes(deps);

  logger.info('downloading the town-hall directory', { source: 'annuaire' });
  const annuaire = await fetchMairies(deps);

  const plan = buildIngestionPlan({ communes, annuaire });

  const { communesWithoutCandidate, ...counts } = plan.report;
  logger.info('planned', counts);

  // Named rather than counted: these are the communes that will need a URL from
  // somewhere other than the directory, and an operator reading a count would
  // have no way to find out which.
  if (communesWithoutCandidate.length > 0) {
    logger.warn('communes with no candidate URL', {
      count: communesWithoutCandidate.length,
      codes: communesWithoutCandidate,
    });
  }

  return plan;
}

async function run(argv: readonly string[], logger: Logger): Promise<void> {
  const options = parseArguments(argv);
  const startedAt = Date.now();

  // Read before downloading: a missing variable must fail in the first second
  // of the job, not after 17 MB have been pulled from two government APIs.
  const url = options.dryRun ? undefined : connectionString(serverEnv());

  const plan = await download(logger);

  let outcome: IngestionOutcome | undefined;

  if (url === undefined) {
    // A dry run is the only way to see what the job would do when there is no
    // shell to try it in, so it is a first-class mode rather than a flag that
    // skips the interesting half.
    logger.info('dry run: nothing written', {
      communes: plan.communes.length,
      sites: plan.sites.length,
    });
  } else {
    const connection = connect(url);
    try {
      outcome = await applyIngestion(connection.db, plan);
      logger.info('written', { ...outcome });
    } finally {
      await connection.close();
    }
  }

  const report = {
    startedAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    dryRun: options.dryRun,
    plan: plan.report,
    outcome: outcome ?? null,
  };

  if (options.reportPath !== undefined) {
    writeReport(options.reportPath, report);
    logger.info('report written', { path: options.reportPath });
  }

  logger.info('done', { durationMs: report.durationMs });
}

/**
 * The workflow uploads this file as an artefact, so it is written on failure
 * too: a run that stopped halfway is the one worth reading, and from a
 * cloud-only session the artefact is the only way to read it.
 */
function writeReport(path: string, report: unknown): void {
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
  const message = error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error';
  logger.error('ingestion failed', { error: message });

  const reportPath = parseArguments(argv).reportPath;
  if (reportPath !== undefined) writeReport(reportPath, { failed: true, error: message });

  process.exitCode = 1;
}
