import { SHELL_ROUTES, expectedStatus } from '../lib/http/routes.js';
import { describeErrorChain } from '../lib/log/errors.js';
import { createLogger, type Logger } from '../lib/log/index.js';
import {
  WARMUP_PLAN,
  classifyProbe,
  delayBeforeAttempt,
  unavailableMessage,
  wrongAnswerMessage,
  type Probe,
} from '../lib/preview/readiness.js';

/**
 * Wakes every route of a freshly published deployment before anything measures
 * it (issue #46).
 *
 * On 18/8 the `e2e` and `lighthouse` jobs of one pull request went red on a
 * diff that touched neither a template nor the rendering. The chronology of the
 * two job logs left no room for interpretation: Netlify published its commit
 * status at 19:28:44, `e2e` resolved the URL five seconds later, and at
 * 19:28:51 forty-two tests started rendering pages against a preview seven
 * seconds old. Two routes answered 500 and one aborted. Five minutes later
 * production — the code of `main`, without a line of the diff — was timing out
 * on `/accessibilite` at 45 s; five minutes after that both deployments served
 * everything under a second (docs/journal.md 028).
 *
 * The predicate all three jobs share, `scripts/resolve-netlify-url.mjs`, proves
 * that **Netlify published a status**, not that the function is warm. The
 * `deploy` job compensates on its own — `scripts/check-deploy.mjs` retries until
 * the expected heading is really rendered — and it warms exactly one route
 * doing so. This job is that wait, generalised to every route of the shell and
 * made available to the jobs that had no equivalent.
 *
 * Why a job and not a step of the suites, which is the whole point:
 *
 *  - it runs **before** `pnpm test:e2e`, so the waiting is not charged to the
 *    six-minute budget §5 gives that layer — a budget must measure the suite,
 *    not the platform's mood;
 *  - `lighthouse` needs the same warm routes for the same reason, and a
 *    Playwright `globalSetup` would leave it out;
 *  - the routes come from the registry (`src/lib/http/routes.ts`), which a
 *    plain `.mjs` under `scripts/` could not read.
 *
 * It holds no rule of its own — what counts as unavailable, how long to wait,
 * and what to say lives in `src/lib/preview/readiness.ts`, unit tested — so it
 * has no test of its own, like every other job here.
 *
 *   node dist-jobs/jobs/warm-preview.js <base-url>
 */

/**
 * Long enough for a cold function on a bad minute, short enough that a route
 * which will never answer does not hold the whole plan hostage: five attempts
 * at 20 s is a worst case of 115 s per route, and the plan's own waiting is
 * asserted bounded next door.
 */
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * We announce ourselves, as §7 requires of every outgoing request — even to our
 * own deployment, where it is what tells a log line apart from a visitor.
 */
const USER_AGENT = 'observatoire-web-warmup';

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * One request, reduced to what the classifier needs.
 *
 * A transport failure becomes a probe rather than an exception on purpose: the
 * judgement of whether it is a bad moment or a broken address belongs to
 * `classifyProbe`, and a `try` that decided it here would be the second place
 * that rule lives.
 */
async function probeOnce(url: string): Promise<Probe> {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { 'user-agent': USER_AGENT },
    });
    // The body is read and dropped: a function that has streamed a full
    // response is a function that has run its rendering, which is the thing
    // being woken. Leaving it unread wakes the route only halfway.
    await response.arrayBuffer();

    return { status: response.status };
  } catch (error) {
    return { status: 0, error: describeErrorChain(error) };
  }
}

interface RouteOutcome {
  readonly route: string;
  readonly attempts: number;
  readonly ms: number;
}

async function warmRoute(baseUrl: string, route: string, logger: Logger): Promise<RouteOutcome> {
  const expected = expectedStatus(route);
  const startedAt = Date.now();
  let lastReason = 'no response';

  for (let attempt = 1; attempt <= WARMUP_PLAN.attempts; attempt += 1) {
    const delay = delayBeforeAttempt(WARMUP_PLAN, attempt);
    if (delay > 0) await sleep(delay);

    const probedAt = Date.now();
    const probe = await probeOnce(`${baseUrl}${route}`);
    const verdict = classifyProbe(probe, expected);
    const ms = Date.now() - probedAt;

    if (verdict.kind === 'ready') {
      logger.info('route warm', { route, status: probe.status, attempt, ms });
      return { route, attempts: attempt, ms };
    }

    // A definite wrong answer is a defect, and reported now: retrying it four
    // more times would only make the report slower and blame the platform.
    if (verdict.kind === 'wrong') {
      throw new Error(wrongAnswerMessage(route, probe, expected));
    }

    lastReason = verdict.reason;
    logger.warn('route not warm yet', { route, attempt, reason: verdict.reason, ms });
  }

  throw new Error(
    unavailableMessage({
      target: route,
      attempts: WARMUP_PLAN.attempts,
      elapsedMs: Date.now() - startedAt,
      lastReason,
    }),
  );
}

/**
 * Sequentially, and that is not an oversight. Netlify serves the whole site
 * from one function: routes are woken one after another so the numbers in the
 * log read as "this route took this long", and so the warm-up never becomes the
 * burst of parallel cold requests it exists to spare the suites.
 */
async function run(argv: readonly string[], logger: Logger): Promise<void> {
  const baseUrl = argv[0]?.replace(/\/+$/, '');

  if (baseUrl === undefined || baseUrl === '') {
    throw new Error('usage: node dist-jobs/jobs/warm-preview.js <base-url>');
  }

  logger.info('warming the deployment', { baseUrl, routes: SHELL_ROUTES.length });

  const startedAt = Date.now();
  const outcomes: RouteOutcome[] = [];
  for (const route of SHELL_ROUTES) {
    outcomes.push(await warmRoute(baseUrl, route, logger));
  }

  // The measurement issue #46 asks for, in the log of the job that produced it:
  // no session can reach a public URL, so this line is the only place the cost
  // of a cold start is ever observed (docs/journal.md 020).
  logger.info('deployment warm', {
    routes: outcomes.length,
    elapsedMs: Date.now() - startedAt,
    slowestMs: Math.max(...outcomes.map((outcome) => outcome.ms)),
    retried: outcomes.filter((outcome) => outcome.attempts > 1).length,
  });
}

const logger = createLogger({
  sink: (line) => {
    process.stdout.write(`${line}\n`);
  },
});

try {
  await run(process.argv.slice(2), logger);
} catch (error) {
  logger.error('warm-up failed', { error: describeErrorChain(error) });
  process.exitCode = 1;
}
