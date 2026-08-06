import type { MiddlewareHandler } from 'astro';
import { serverEnv } from './lib/env/runtime.js';
import { applyPolicyHeaders } from './lib/http/index.js';

/**
 * Every response of this site passes through here, which is the only way §7's
 * security headers and §10's cache policy can be stated once instead of being
 * repeated — and forgotten — page by page.
 *
 * It is deliberately this short: what it decides is decided in src/lib/http/,
 * where it is unit tested without a server. Static assets do not go through
 * Astro at all; their headers are declared in netlify.toml.
 *
 * The Sentry DSN is read here, at request time, while the browser SDK receives
 * it at build time through `import.meta.env`. The two therefore agree unless
 * the variable is changed without a redeploy, in which case the policy names
 * the new ingest origin and the bundled client still posts to the old one.
 */
export const onRequest: MiddlewareHandler = async (context, next) => {
  const response = await next();

  return applyPolicyHeaders(response, {
    pathname: context.url.pathname,
    sentryDsn: serverEnv().PUBLIC_SENTRY_DSN,
  });
};
