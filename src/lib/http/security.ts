/**
 * The security headers CLAUDE.md §7 requires on every response.
 *
 * Pure by construction: it takes what varies (the Sentry DSN) and returns a
 * record of header names to values. The middleware is what puts them on a
 * response — this file can therefore be tested without rendering anything.
 *
 * The policy is deliberately written as "nothing, then exceptions". Every
 * addition to it has to be argued for in a diff, which is the only way a
 * content security policy stays strict for two years.
 */

/** Header names §7 enumerates, lowercase because that is how `Headers` stores them. */
export const SECURITY_HEADER_NAMES = [
  'content-security-policy',
  'strict-transport-security',
  'x-content-type-options',
  'referrer-policy',
  'permissions-policy',
] as const;

export type SecurityHeaderName = (typeof SECURITY_HEADER_NAMES)[number];

export interface SecurityHeaderOptions {
  /**
   * The Sentry DSN in force, when there is one. Only its origin is used: the
   * browser SDK has to be allowed to POST its reports somewhere, and that
   * somewhere must be named rather than covered by a wildcard.
   */
  readonly sentryDsn?: string | undefined;
}

/**
 * Browser features denied to everyone, the site included. Naming a feature is
 * what makes the denial visible in a header inspector; an unnamed feature is
 * governed by whatever the browser defaults to this year.
 */
const DENIED_BROWSER_FEATURES = [
  'accelerometer',
  'autoplay',
  'camera',
  'display-capture',
  'encrypted-media',
  'fullscreen',
  'geolocation',
  'gyroscope',
  'magnetometer',
  'microphone',
  'midi',
  'payment',
  'picture-in-picture',
  'publickey-credentials-get',
  'screen-wake-lock',
  'usb',
  'xr-spatial-tracking',
] as const;

/**
 * The origin a Sentry DSN points at, or null when the value is unusable.
 *
 * The DSN carries a public key (its username) and the project id (its path);
 * neither belongs in a header. Returning null rather than throwing is a
 * deliberate trade: `parseEnv` already rejects a malformed DSN at startup
 * (CLAUDE.md §9), so reaching this branch means error reporting is broken
 * either way — and taking the page down with it would help nobody.
 */
export function sentryIngestOrigin(dsn: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(dsn);
  } catch {
    return null;
  }

  // A non-HTTP URL has the opaque origin "null", which would land in the policy
  // as a source named `null` — accepted by parsers, meaningless to everyone.
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;

  return parsed.origin;
}

/**
 * The content security policy served with every document.
 *
 * `'unsafe-inline'` and `'unsafe-eval'` are excluded by §7, which has a
 * consequence the rest of the codebase has to honour: no inline `<script>` and
 * no inline `<style>` may reach the HTML. That is why `build.inlineStylesheets`
 * is set to `'never'` in astro.config.mjs, and why scripts/check-deploy.mjs
 * asserts the absence of both on the real deployment — a policy nothing
 * verifies is a policy that gets relaxed the first time a page looks broken.
 */
export function contentSecurityPolicy({ sentryDsn }: SecurityHeaderOptions): string {
  const ingestOrigin = sentryDsn === undefined ? null : sentryIngestOrigin(sentryDsn);
  const connectSources = ingestOrigin === null ? ["'self'"] : ["'self'", ingestOrigin];

  const directives: [string, string[]][] = [
    ['default-src', ["'self'"]],
    ['base-uri', ["'none'"]],
    ['object-src', ["'none'"]],
    ['frame-ancestors', ["'none'"]],
    ['form-action', ["'self'"]],
    ['script-src', ["'self'"]],
    ['style-src', ["'self'"]],
    // data: covers inline SVG rasterisation and nothing else here; the site
    // embeds no third-party image.
    ['img-src', ["'self'", 'data:']],
    ['font-src', ["'self'"]],
    ['connect-src', connectSources],
    ['upgrade-insecure-requests', []],
  ];

  return directives.map(([name, sources]) => [name, ...sources].join(' ')).join('; ');
}

/** Every header of §7, ready to be set on a response. */
export function securityHeaders(
  options: SecurityHeaderOptions,
): Record<SecurityHeaderName, string> {
  return {
    'content-security-policy': contentSecurityPolicy(options),
    // A year, subdomains included. No `preload`: that is a submission about a
    // domain whose DNS we do not yet control, and it is reversible only over
    // months.
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': DENIED_BROWSER_FEATURES.map((feature) => `${feature}=()`).join(', '),
  };
}
