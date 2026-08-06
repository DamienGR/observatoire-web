import * as Sentry from '@sentry/astro';
import { scrubEvent } from './src/lib/observability/scrub.js';

/**
 * Browser-side Sentry.
 *
 * This file exists rather than letting the integration generate its own
 * snippet, because that default enables browser tracing and session replay —
 * tens of kilobytes of JavaScript and a recording of the visitor's session, on
 * a site that publishes other people's performance scores and collects no
 * personal data (docs/brief.md §9). Errors, and nothing else.
 *
 * It is bundled only when `PUBLIC_SENTRY_DSN` is set at build time
 * (astro.config.mjs), so a build without it ships no client JavaScript at all.
 */
Sentry.init({
  dsn: import.meta.env.PUBLIC_SENTRY_DSN,

  // No tracing, no replay, no profiling: none of them diagnose an error, and
  // all of them cost bytes on every page.
  tracesSampleRate: 0,
  integrations: [],

  // Nothing about the visitor. §7 forbids personal data outright, and the
  // scrubbing below is what makes that true of the payload rather than of the
  // intention.
  sendDefaultPii: false,
  beforeSend: scrubEvent,
});
