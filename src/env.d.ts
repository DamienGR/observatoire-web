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
