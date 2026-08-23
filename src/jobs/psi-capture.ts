import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { requireEnv } from '../lib/env/index.js';
import { serverEnv } from '../lib/env/runtime.js';
import { describeErrorChain } from '../lib/log/errors.js';
import { createLogger, type Logger } from '../lib/log/index.js';
import {
  DEFAULT_PSI_STRATEGY,
  PSI_STRATEGIES,
  buildPsiRequestUrl,
  redactPsiKey,
  type PsiStrategy,
} from '../lib/psi/request.js';

/**
 * Captures raw PageSpeed Insights payloads, so that a session can see one.
 *
 * This job exists because of a wall docs/journal.md 027 ran into and could not
 * climb: **no session can call PSI**. The keyless mode is not a reduced quota
 * but a quota of zero (measured, `HTTP 429, "quota_limit_value": "0"`), and
 * `PSI_API_KEY` is a repository secret that no container here holds. CLAUDE.md
 * §5 nevertheless demands that a third-party API be *observed* before it is
 * parsed — "on observe le comportement réel, puis on fige l'observation en
 * fixture" — so the observation has to be made by CI on the session's behalf.
 *
 * Hence: `.github/workflows/contracts.yml` runs this on a manual dispatch and
 * uploads what it wrote. It is the refresh path for `tests/fixtures/psi/`, and
 * the only one — a fixture nobody can regenerate is a fixture that will be
 * edited by hand the first time a test goes red, which is exactly what
 * tests/fixtures/README.md forbids.
 *
 * It holds no rule of its own. It does not parse, does not decide what a
 * failure means, and does not know what a Lighthouse category is: it asks, it
 * writes the bytes down, and it prints a **structural** outline — keys, types,
 * array lengths — so that the log alone is worth something on the day the
 * artefact cannot be downloaded.
 *
 *   node dist-jobs/jobs/psi-capture.js [--out <dir>] [--strategy mobile|desktop] [url…]
 */

/**
 * Six real observations rather than one, each chosen for a case the parser will
 * have to survive. They are dispatched in this order and are, deliberately, the
 * addresses of actual town halls: a synthetic target would tell us what PSI
 * does to a page nobody publishes.
 */
const DEFAULT_TARGETS = [
  // The largest commune of the perimeter, and 347 kB of home page.
  'https://www.paris.fr/',
  // A middle-sized one, on a different stack.
  'https://www.montreuil.fr/',
  // The small end of the v1 perimeter (docs/journal.md 031 sampled down to it).
  'https://www.andrezieux-boutheon.com/',
  // Answers 503 through the CDN in front of it — measured twice on 23/8 and
  // again on 23/8 from this session. What PSI makes of that is the question.
  'https://www.ville-lunel.fr/',
  // A 404 on a site that works: PSI happily measures an error page, and the
  // scan must not publish its score as the commune's.
  'https://www.paris.fr/observatoire-web-page-qui-nexiste-pas',
  // A directory URL whose host no longer resolves. Not invented: it is what
  // the annuaire still hands out for Saint-Jean-de-Luz.
  'https://www.mairie-saintjeandeluz.fr/',
] as const;

interface JobArguments {
  readonly outDir: string;
  readonly strategy: PsiStrategy;
  readonly targets: readonly string[];
}

function parseArguments(argv: readonly string[]): JobArguments {
  const outIndex = argv.indexOf('--out');
  const strategyIndex = argv.indexOf('--strategy');
  const strategy = strategyIndex === -1 ? undefined : argv[strategyIndex + 1];

  if (strategy !== undefined && !PSI_STRATEGIES.includes(strategy as PsiStrategy)) {
    throw new Error(`Unknown strategy ${strategy}. Expected one of ${PSI_STRATEGIES.join(', ')}.`);
  }

  const flagged = new Set([outIndex, outIndex + 1, strategyIndex, strategyIndex + 1]);
  const targets = argv.filter((value, index) => !flagged.has(index) && !value.startsWith('--'));

  return {
    outDir: (outIndex === -1 ? undefined : argv[outIndex + 1]) ?? 'captures',
    strategy: (strategy as PsiStrategy | undefined) ?? DEFAULT_PSI_STRATEGY,
    targets: targets.length > 0 ? targets : DEFAULT_TARGETS,
  };
}

/** A file name that a human can match to a target without opening it. */
function slugify(target: string, strategy: PsiStrategy): string {
  const slug = target
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
    .toLowerCase();

  return `${slug}.${strategy}.json`;
}

/**
 * A depth-limited key tree with types and lengths — never values.
 *
 * The point is to stay ignorant of what PSI means. Printing values would make
 * this job an unreviewed parser, and a 500 kB payload in a workflow log is not
 * readable anyway; printing the shape is what lets a session write the Zod
 * schema before the artefact has been opened.
 */
function outline(value: unknown, depth: number, path = ''): string[] {
  if (depth === 0) return [];

  if (Array.isArray(value)) {
    const lines = [`${path}[] (${String(value.length)})`];
    if (value.length > 0) lines.push(...outline(value[0], depth - 1, `${path}[0]`));
    return lines;
  }

  if (value === null || typeof value !== 'object') {
    return [`${path}: ${value === null ? 'null' : typeof value}`];
  }

  return Object.entries(value).flatMap(([key, child]) =>
    outline(child, depth - 1, path === '' ? key : `${path}.${key}`),
  );
}

interface CaptureResult {
  readonly target: string;
  readonly strategy: PsiStrategy;
  readonly httpStatus: number;
  readonly bytes: number;
  readonly elapsedMs: number;
  readonly file: string;
}

/**
 * One request, one file.
 *
 * Plain `fetch`, not the guarded client of `src/lib/fetch/`: the address dialled
 * here is Google's, hard-coded above, and the guard exists for URLs a directory
 * handed us. The *target* is third-party, but we are not the ones fetching it —
 * that is the whole reason this measurement is bought from PSI.
 */
async function capture(
  target: string,
  apiKey: string,
  args: JobArguments,
  logger: Logger,
): Promise<CaptureResult> {
  const requestUrl = buildPsiRequestUrl({ url: target, apiKey, strategy: args.strategy });
  const startedAt = Date.now();

  logger.info('requesting', { target, strategy: args.strategy });

  const response = await fetch(requestUrl, {
    headers: { 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await response.text();
  const elapsedMs = Date.now() - startedAt;

  const file = slugify(target, args.strategy);
  writeFileSync(join(args.outDir, file), body, 'utf8');

  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    parsed = { unparsable: body.slice(0, 200) };
  }

  logger.info('captured', {
    target,
    strategy: args.strategy,
    httpStatus: response.status,
    bytes: body.length,
    elapsedMs,
    file,
  });
  // Printed as lines rather than as a log field: an outline is read by a human
  // scrolling a workflow log, and NDJSON with three hundred keys in one field
  // is not read at all.
  for (const line of outline(parsed, 5)) process.stdout.write(`  ${file} | ${line}\n`);

  return {
    target,
    strategy: args.strategy,
    httpStatus: response.status,
    bytes: body.length,
    elapsedMs,
    file,
  };
}

/** We announce ourselves on every outgoing request (CLAUDE.md §7). */
const USER_AGENT = 'observatoire-web PSI capture (+https://github.com/DamienGR/observatoire-web)';

/** PSI takes tens of seconds on a heavy home page, and minutes on a bad one. */
const REQUEST_TIMEOUT_MS = 150_000;

/** The brief measures the real throughput at about one request a second (§4). */
const PAUSE_BETWEEN_REQUESTS_MS = 2_000;

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

async function main(): Promise<void> {
  const logger = createLogger({
    sink: (line) => {
      process.stdout.write(`${line}\n`);
    },
  });

  const args = parseArguments(process.argv.slice(2));
  const apiKey = requireEnv(serverEnv(), 'PSI_API_KEY');

  mkdirSync(args.outDir, { recursive: true });
  logger.info('capturing PageSpeed Insights payloads', {
    targets: args.targets.length,
    strategy: args.strategy,
    outDir: args.outDir,
    // The one place the request URL is ever printed, and it goes through the
    // redactor (CLAUDE.md §7): the key travels in the query string because the
    // API offers no header form.
    example: redactPsiKey(buildPsiRequestUrl({ url: 'https://example.org/', apiKey })),
  });

  const results: CaptureResult[] = [];
  let failures = 0;

  for (const [index, target] of args.targets.entries()) {
    if (index > 0) await wait(PAUSE_BETWEEN_REQUESTS_MS);

    try {
      results.push(await capture(target, apiKey, args, logger));
    } catch (error) {
      failures += 1;
      // A transport failure on one target must not lose the five captures that
      // already succeeded: from a session, this artefact is the only window.
      logger.error('capture failed', {
        target,
        strategy: args.strategy,
        error: redactPsiKey(describeErrorChain(error)),
      });
    }
  }

  writeFileSync(
    join(args.outDir, `index.${args.strategy}.json`),
    `${JSON.stringify({ capturedAt: new Date().toISOString(), results }, null, 2)}\n`,
    'utf8',
  );

  logger.info('done', { captured: results.length, failed: failures });

  // A capture that reached nothing is a red job. A capture that reached most of
  // its targets is the normal case — some of them are chosen precisely because
  // they are broken.
  if (results.length === 0) process.exitCode = 1;
}

await main();
