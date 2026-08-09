import { createLogger } from '../lib/log/index.js';
import type { StatsSnapshot } from '../lib/stats/snapshot.js';
import { serverEnv } from '../lib/env/runtime.js';
import { connect, type Connection } from './client.js';
import { readStats } from './stats.js';

/**
 * Database access on the request path of the site — the impure half, kept apart
 * from the queries the way `src/lib/env/runtime.ts` is kept apart from
 * `src/lib/env/index.ts`.
 *
 * **Which driver the site uses, and why `pg`.** The question was left open at
 * bootstrap: `@neondatabase/serverless` was installed for a rendering path that
 * did not exist yet, while the jobs spoke plain TCP (docs/roadmap.md). It is
 * settled here, in the pull request that first reads the database from a page,
 * and it is settled on where the code runs: `@astrojs/netlify` deploys the SSR
 * entry point as a Netlify Function — a Node process on AWS Lambda, not an edge
 * runtime — so it can hold a socket, and Neon's pooled endpoint exists exactly
 * for that shape. The serverless driver buys nothing here and would give the
 * repository two drivers, two failure modes and two things to keep upgraded.
 * The dependency is dropped in the same pull request rather than left installed
 * as a decision nobody made.
 *
 * **The pool is memoised and never closed.** A Lambda container serves many
 * requests; opening a connection per render would spend more time connecting
 * than querying, and closing the pool at the end of a render would guarantee
 * it. The container is frozen between invocations and reclaimed by the
 * platform, which is what ends the connections — `max: 1` keeps that footprint
 * to one socket per container, and the pooled endpoint is what makes many
 * containers affordable.
 */
let connection: Connection | undefined;

/**
 * Why a *safe* read rather than a thrown error the framework turns into a 500:
 * the database being unreachable is information this page exists to display,
 * not an accident to hide. The page answers 200 and says the figures cannot be
 * read — and the failure is logged, because a page saying "unavailable" is only
 * honest if somebody can find out why.
 */
export type StatsRead =
  | { readonly ok: true; readonly snapshot: StatsSnapshot }
  /** No `DATABASE_URL` at all: a build with no secrets, a fork's preview. */
  | { readonly ok: false; readonly reason: 'not-configured' }
  /** Configured, but the read failed: unreachable, timed out, schema behind. */
  | { readonly ok: false; readonly reason: 'unavailable' };

const logger = createLogger({
  sink: (line) => {
    process.stdout.write(`${line}\n`);
  },
});

/**
 * The pooled endpoint, not `DATABASE_URL_UNPOOLED`: a page is exactly the
 * short, frequent, connection-cheap workload the pooler is for, whereas the
 * ingestion job takes the direct one for its long transaction.
 */
function siteConnection(url: string): Connection {
  connection ??= connect(url, {
    maxConnections: 1,
    // A visitor waits. Failing in five seconds with a logged reason beats
    // holding the request until the platform kills the function without one.
    connectionTimeoutMs: 5_000,
    statementTimeoutMs: 5_000,
  });

  return connection;
}

export async function loadStats(): Promise<StatsRead> {
  const url = serverEnv().DATABASE_URL;

  if (url === undefined) return { ok: false, reason: 'not-configured' };

  try {
    return { ok: true, snapshot: await readStats(siteConnection(url).db) };
  } catch (error) {
    // The message, never the payload: this log is public on a public
    // repository, and a connection string is never handed to a logger (§7).
    logger.error('stats read failed', {
      error: error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error',
    });

    return { ok: false, reason: 'unavailable' };
  }
}
