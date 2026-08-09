/// <reference types="astro/client" />

/**
 * Client-visible environment variables, typed.
 *
 * Vite declares `ImportMetaEnv` with a `string`-keyed `any` fallback, so
 * `import.meta.env.PUBLIC_ANYTHING` typechecks even when nothing sets it.
 * Declaring the ones we actually use narrows them back to `string | undefined`
 * and, more usefully, makes this file the list of what reaches the browser —
 * §9's `PUBLIC_` discipline, visible in one place.
 */
interface ImportMetaEnv {
  /** Sentry DSN used by the browser SDK. Public by nature (CLAUDE.md §9). */
  readonly PUBLIC_SENTRY_DSN?: string;
}

/**
 * What a page may hand to the middleware.
 *
 * One field, and deliberately not a general-purpose bag: the cache policy of a
 * route is declared once in `src/lib/http/routes.ts` (§10), and the only thing
 * a render knows that the registry cannot is that *this* response is a degraded
 * one — a data page that could not read its data. Typed as `CacheDowngrade`, so
 * a page can drop the caching it was granted and never widen it.
 */
declare namespace App {
  interface Locals {
    cacheDowngrade?: import('./lib/http/cache.js').CacheDowngrade;
  }
}
