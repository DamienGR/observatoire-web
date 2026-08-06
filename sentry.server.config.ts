import * as Sentry from '@sentry/astro';
import { serverEnv } from './src/lib/env/runtime.js';
import { scrubEvent } from './src/lib/observability/scrub.js';

/**
 * Server-side Sentry: SSR routes today, jobs and the ops surface from
 * milestone 2 on.
 *
 * "Sentry dès le premier jour — c'est le seul moyen de diagnostiquer la
 * production sans terminal" (docs/brief.md §5). Without a shell, an unreported
 * exception is an incident nobody can investigate after the fact.
 *
 * The DSN is read at request time through `src/lib/env`, never off
 * `process.env` directly (§4).
 */
Sentry.init({
  dsn: serverEnv().SENTRY_DSN,

  // Errors only, as on the client. Tracing on an SSR site of a few pages would
  // spend the free quota on spans nobody reads.
  tracesSampleRate: 0,

  sendDefaultPii: false,
  beforeSend: scrubEvent,
});
