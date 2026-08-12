import { z } from 'zod';

/**
 * Typed access to the environment variables documented in CLAUDE.md §9.
 *
 * Everything here is pure: it takes a plain record and returns a value. The
 * caller decides where the record comes from (`process.env`, `import.meta.env`,
 * a fixture), which is what keeps this testable with zero I/O.
 *
 * Two rules are encoded rather than trusted:
 *
 *  1. An empty string means *absent*. Netlify and GitHub Actions both surface
 *     an unset variable as `""`, and a `""` that reaches a Postgres driver
 *     produces a connection error nobody can attribute to a missing secret.
 *  2. No server-only variable may carry the `PUBLIC_` prefix. Under Astro that
 *     prefix ships the value to the browser (§9), so the mistake is silent and
 *     expensive. `assertNoPublicPrefixedSecrets` fails the build instead.
 */

/** Variables Astro is allowed to expose to the client. Public by nature. */
export const publicEnvSchema = z.object({
  PUBLIC_SENTRY_DSN: z.url().optional(),
});

/** Variables that must never leave the server. */
export const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1).optional(),
  DATABASE_URL_UNPOOLED: z.string().min(1).optional(),
  PSI_API_KEY: z.string().min(1).optional(),
  OPS_TOKEN: z.string().min(1).optional(),
  SENTRY_DSN: z.url().optional(),
  SENTRY_AUTH_TOKEN: z.string().min(1).optional(),
  NEON_API_KEY: z.string().min(1).optional(),
  NEON_PROJECT_ID: z.string().min(1).optional(),
  NETLIFY_AUTH_TOKEN: z.string().min(1).optional(),
  SITE_URL: z.url().optional(),
});

export const envSchema = publicEnvSchema.extend(serverEnvSchema.shape);

export type PublicEnv = z.infer<typeof publicEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type Env = z.infer<typeof envSchema>;
export type EnvKey = keyof Env;

/** A variable is declared but malformed — a wrong URL, a bad shape. */
export class EnvValidationError extends Error {
  override readonly name = 'EnvValidationError';
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(
      `Invalid environment variables:\n${issues.map((issue) => `  - ${issue}`).join('\n')}\n` +
        'See CLAUDE.md §9 and .env.example.',
    );
    this.issues = issues;
  }
}

/** A variable a feature needs is absent. Named, so the fix is obvious. */
export class MissingEnvError extends Error {
  override readonly name = 'MissingEnvError';
  readonly key: EnvKey;

  constructor(key: EnvKey) {
    super(
      `Missing required environment variable ${key}.\n` +
        'Declare it in .env.example (without a value) and set it in the ' +
        'GitHub Actions secrets or the Netlify environment (CLAUDE.md §9).',
    );
    this.key = key;
  }
}

/**
 * Every variable is optional at this layer, on purpose: a feature that needs
 * one declares that need at its own call site through `requireEnv`. A schema
 * that required everything up front would make the site unbuildable for a
 * contributor working on a page.
 */
export function parseEnv(source: Readonly<Record<string, string | undefined>>): Env {
  const normalized: Record<string, string> = {};

  for (const key of Object.keys(envSchema.shape)) {
    const raw = source[key];
    if (raw === undefined) continue;

    const trimmed = raw.trim();
    if (trimmed === '') continue; // rule 1: empty means absent

    normalized[key] = trimmed;
  }

  const result = envSchema.safeParse(normalized);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new EnvValidationError(issues);
  }

  return result.data;
}

/** Reads a variable a feature cannot run without. Throws by name if absent. */
export function requireEnv<K extends EnvKey>(env: Env, key: K): NonNullable<Env[K]> {
  const value = env[key];
  if (value === undefined) {
    throw new MissingEnvError(key);
  }
  return value;
}

/**
 * Rule 2, as a check rather than a convention. Called by the test suite so a
 * future session cannot rename a secret into the client bundle by accident.
 *
 * The key list is a parameter so the failing path is reachable from a test —
 * a guard whose alarm has never been heard is not a guard.
 */
export function assertNoPublicPrefixedSecrets(
  serverKeys: readonly string[] = Object.keys(serverEnvSchema.shape),
): void {
  const leaked = serverKeys.filter((key) => key.startsWith('PUBLIC_'));

  if (leaked.length > 0) {
    throw new Error(
      `Server-only variables must not use the PUBLIC_ prefix: ${leaked.join(', ')}.\n` +
        'Astro exposes every PUBLIC_ variable to the browser (CLAUDE.md §9).',
    );
  }
}
