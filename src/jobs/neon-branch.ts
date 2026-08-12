import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { requireEnv, type Env } from '../lib/env/index.js';
import { serverEnv } from '../lib/env/runtime.js';
import { describeErrorChain } from '../lib/log/errors.js';
import { createLogger, type Logger } from '../lib/log/index.js';
import { NeonApiError, createNeonClient, type NeonClient } from '../lib/neon/api.js';
import {
  ephemeralBranchName,
  selectOrganizationId,
  selectProjectId,
  selectStaleBranches,
} from '../lib/neon/branch.js';

/**
 * The ephemeral Neon branch of one CI run (J1-11).
 *
 * CLAUDE.md §5 puts the integration layer on "une branche Neon éphémère", and
 * §7 forbids production's `DATABASE_URL` in CI or in a preview. This job is
 * what makes that possible: it creates a throwaway copy-on-write clone of the
 * project's default branch, hands the workflow its two connection strings, and
 * deletes it when the run is over.
 *
 * It lives in `src/jobs/` rather than in `scripts/` for one reason: the Neon
 * API is an external API, and §4 requires every external payload to be parsed
 * by a Zod schema before use. That parsing is TypeScript, so the file has to be
 * compiled — which also means `pnpm build:jobs`, and therefore `pnpm verify`,
 * breaks on a module it can no longer resolve instead of the CI run that needed
 * it (docs/roadmap.md).
 *
 * The rules are all next door in `src/lib/neon/`, unit tested without a
 * network, because `NEON_API_KEY` is a repository secret no cloud session can
 * read: what this file holds is wiring and nothing else.
 *
 *   node dist-jobs/jobs/neon-branch.js create --label <l> --run-id <id> \
 *     --run-attempt <n> --env-out <path>
 *   node dist-jobs/jobs/neon-branch.js delete --branch <branch-id>
 *
 * `--env-out` and not the obvious `--env-file`: Node 22 claims that option for
 * itself and swallows it wherever it appears on the command line, script
 * arguments included — measured in a session, where the job died with
 * `node: …/neon.env: not found` before its own argument parser ever ran.
 */

/**
 * How long a branch may live before any later run may delete it on sight.
 *
 * Longer than the whole pipeline's target of ten minutes (CLAUDE.md §5) by a
 * wide margin: the pruner must never meet a run in flight, and the cost of
 * waiting is a branch that lingers two hours in a project nobody is looking at.
 */
const STALE_AFTER_MS = 2 * 60 * 60 * 1_000;

interface JobArguments {
  readonly command: string | undefined;
  readonly label: string;
  readonly runId: string;
  readonly runAttempt: string;
  readonly branchId: string;
  readonly envOut: string | undefined;
  /**
   * Where the Neon API lives. Defaulted, and overridable for one reason: with
   * `NEON_API_KEY` locked in the repository secrets, pointing this at a local
   * stand-in is the only way anybody can rehearse the whole chain — create,
   * hand over, migrate, test, delete — before a CI run does it for real
   * (docs/journal.md 022). The workflow never passes it.
   */
  readonly apiBase: string | undefined;
}

function flag(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
}

function parseArguments(argv: readonly string[]): JobArguments {
  return {
    command: argv[0],
    label: flag(argv, 'label') ?? '',
    runId: flag(argv, 'run-id') ?? '',
    runAttempt: flag(argv, 'run-attempt') ?? '',
    branchId: flag(argv, 'branch') ?? '',
    envOut: flag(argv, 'env-out'),
    apiBase: flag(argv, 'api-base'),
  };
}

/**
 * The project to act on: whatever `NEON_PROJECT_ID` names, or the only one the
 * key can see. The variable is optional on purpose — requiring it would have
 * made this task wait on a console setting, which is precisely what kept J1-11
 * blocked for a week — but it is the documented way out the day the account
 * holds a second project.
 *
 * The organisation detour is not speculative and was not in the plan: the first
 * real CI run answered `400: org_id is required` to a bare `GET /projects`,
 * because the account behind the key belongs to an organisation. It is keyed on
 * the **status**, not on the wording — a 400 on a request that carries no
 * parameter can only mean "you have to say which account" — and it costs one
 * request in the case that already worked.
 */
async function resolveProjectId(neon: NeonClient, env: Env, logger: Logger): Promise<string> {
  const declared = env.NEON_PROJECT_ID;

  if (declared !== undefined) {
    logger.info('project declared', { projectId: declared });
    return declared;
  }

  const projectId = await discoverProjectId(neon, logger);
  logger.info('project discovered', { projectId });
  return projectId;
}

async function discoverProjectId(neon: NeonClient, logger: Logger): Promise<string> {
  try {
    return selectProjectId(await neon.listProjects());
  } catch (error) {
    if (!(error instanceof NeonApiError) || error.status !== 400) throw error;

    const organizationId = selectOrganizationId(await neon.listOrganizations());
    logger.info('organisation discovered', { organizationId });

    return selectProjectId(await neon.listProjects(organizationId));
  }
}

/**
 * Deletes the ephemeral branches an earlier run left behind.
 *
 * The cleanup step of the workflow is the normal path and this is the
 * safety net, because a Neon project caps how many branches it may hold: a
 * couple of runs killed mid-flight — cancelled by `concurrency`, or by a runner
 * outage — would otherwise be enough to make every later run fail at creation,
 * with an error naming a quota rather than the runs that leaked.
 *
 * A failure here never fails the job. Being unable to tidy up is not a reason
 * to refuse to run the tests.
 */
async function prune(neon: NeonClient, projectId: string, logger: Logger): Promise<void> {
  try {
    const stale = selectStaleBranches(await neon.listBranches(projectId), {
      now: new Date(),
      maxAgeMs: STALE_AFTER_MS,
    });

    if (stale.length === 0) return;

    logger.warn('deleting branches an earlier run left behind', {
      count: stale.length,
      names: stale.map((branch) => branch.name),
    });

    for (const branch of stale) {
      await neon.deleteBranch(projectId, branch.id);
    }
  } catch (error) {
    logger.warn('could not prune older branches', { error: describeErrorChain(error) });
  }
}

/**
 * Writes what the rest of the job needs, for the workflow to append to
 * `$GITHUB_ENV`.
 *
 * A file rather than stdout: two of these three values are credentials, and a
 * workflow log is public on a public repository (CLAUDE.md §7). The masking
 * directives below are the second half of the same precaution — they make the
 * runner redact the values should anything ever echo them.
 */
function writeEnvFile(path: string, values: Readonly<Record<string, string>>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `${Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')}\n`,
    'utf8',
  );
}

/** A GitHub Actions workflow command, not a log line — hence the raw write. */
function mask(value: string): void {
  if (value === '') return;
  process.stdout.write(`::add-mask::${value}\n`);
}

async function create(options: JobArguments, neon: NeonClient, env: Env, logger: Logger) {
  // Checked before anything is created: a branch nobody can reach is a branch
  // nobody deletes either.
  const envOut = options.envOut;

  if (envOut === undefined) {
    throw new Error('`create` needs --env-out: it is how the connection strings leave this job.');
  }

  const name = ephemeralBranchName([options.label, options.runId, options.runAttempt]);
  const projectId = await resolveProjectId(neon, env, logger);

  await prune(neon, projectId, logger);

  const branch = await neon.createBranch(projectId, name);

  // Before anything else can print them, and before the readiness poll gives
  // the API a chance to quote them back in an error.
  mask(branch.directUri);
  mask(branch.pooledUri);
  mask(new URL(branch.directUri).password);

  logger.info('branch created', { branchId: branch.id, name: branch.name });

  await neon.waitForBranchReady(projectId, branch.id);
  logger.info('branch ready', { branchId: branch.id });

  writeEnvFile(envOut, {
    NEON_PROJECT_ID: projectId,
    NEON_BRANCH_ID: branch.id,
    // The two shapes CLAUDE.md §9 keeps apart, so the CI job exercises the
    // same split as production: the pooled endpoint for what the site reads,
    // the direct one for migrations.
    DATABASE_URL: branch.pooledUri,
    DATABASE_URL_UNPOOLED: branch.directUri,
  });
}

async function destroy(options: JobArguments, neon: NeonClient, env: Env, logger: Logger) {
  if (options.branchId === '') {
    throw new Error('`delete` needs --branch <branch-id>.');
  }

  const projectId = await resolveProjectId(neon, env, logger);

  await neon.deleteBranch(projectId, options.branchId);
  logger.info('branch deleted', { branchId: options.branchId });
}

async function run(argv: readonly string[], logger: Logger): Promise<void> {
  const options = parseArguments(argv);
  const env = serverEnv();

  const neon = createNeonClient(
    {
      apiKey: requireEnv(env, 'NEON_API_KEY'),
      ...(options.apiBase === undefined ? {} : { baseUrl: options.apiBase }),
    },
    { fetch },
  );

  switch (options.command) {
    case 'create':
      return create(options, neon, env, logger);
    case 'delete':
      return destroy(options, neon, env, logger);
    default:
      throw new Error(
        `Unknown command ${options.command ?? '(none)'}. Expected \`create\` or \`delete\`.`,
      );
  }
}

const logger = createLogger({
  sink: (line) => {
    process.stdout.write(`${line}\n`);
  },
});

try {
  await run(process.argv.slice(2), logger);
} catch (error) {
  // The message, never the payload — and here the payload is a credential.
  logger.error('neon branch job failed', { error: describeErrorChain(error) });
  process.exitCode = 1;
}
