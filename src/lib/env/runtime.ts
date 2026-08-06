import { parseEnv, type Env } from './index.js';

/**
 * The one place that reads the actual process environment.
 *
 * `parseEnv` is pure and takes a record; this is the impure half, kept apart so
 * everything above it stays testable with a fixture. ESLint allows
 * `process.env` here and nowhere else (CLAUDE.md §4).
 *
 * Reading at runtime rather than at build time is deliberate: a Netlify
 * environment variable changed in the console takes effect on the next request,
 * without a redeploy — §10's rule that data never triggers a build applies to
 * configuration too.
 */
let cached: Env | undefined;

/**
 * Parses the environment once per process and reuses it.
 *
 * A malformed variable throws on the first request rather than being ignored,
 * and it throws for every route because the middleware is what calls this. That
 * is the intent: the same variables are set on the deploy preview, so the CI
 * deploy check meets the failure on the pull request, before production does.
 */
export function serverEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Drops the memoised environment. For tests — nothing else needs it. */
export function resetServerEnv(): void {
  cached = undefined;
}
