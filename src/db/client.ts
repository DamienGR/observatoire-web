import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

/**
 * The database connection used by the jobs (J1-14 and after).
 *
 * `pg` over TCP rather than `@neondatabase/serverless`, and the reason is where
 * the code runs: a job runs in a GitHub Actions runner, a plain long-lived Node
 * process that can hold a socket. The serverless driver exists for edge
 * runtimes where it cannot — that is the site's problem, not a job's. Choosing
 * the standard protocol here also means the same code path can be exercised
 * against any Postgres, which is what lets the integration suite run against a
 * throwaway cluster in a session container (docs/journal.md 014) instead of
 * waiting for a Neon branch to exist.
 *
 * This module is the only place that knows which driver is in use. Everything
 * downstream takes a `Database`.
 */
export type Database = NodePgDatabase<typeof schema>;

export interface Connection {
  readonly db: Database;
  /** Always call it: a job that leaves a pool open never exits. */
  readonly close: () => Promise<void>;
}

export interface ConnectOptions {
  /** A job opens a handful of connections at most; the default of 10 is waste. */
  readonly maxConnections?: number;
  readonly connectionTimeoutMs?: number;
  /**
   * Postgres `statement_timeout`, in milliseconds. Left unset for a job — an
   * ingestion transaction legitimately takes minutes — and set by the site,
   * where a query that hangs holds a visitor's request until the platform kills
   * the function, with no log saying why.
   */
  readonly statementTimeoutMs?: number;
}

/**
 * Opens a pool and hands back a Drizzle instance.
 *
 * The connection string is a parameter rather than read from the environment
 * here: reading it belongs to `src/lib/env` (CLAUDE.md §4), and the job is the
 * one that decides between the pooled and the direct endpoint.
 */
export function connect(connectionString: string, options: ConnectOptions = {}): Connection {
  const pool = new pg.Pool({
    connectionString,
    max: options.maxConnections ?? 2,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 15_000,
    ...(options.statementTimeoutMs === undefined
      ? {}
      : { statement_timeout: options.statementTimeoutMs }),
  });

  return {
    db: drizzle(pool, { schema }),
    close: () => pool.end(),
  };
}
