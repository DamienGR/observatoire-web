/**
 * The request half of the PageSpeed Insights client: what we ask, and how the
 * question is written down without leaking the key that authorises it.
 *
 * Pure, and unit tested first (CLAUDE.md §5): building a URL is a place where
 * the specification is knowable before the code. What the API *answers* is not,
 * and that half lives in `payload.ts` behind a frozen capture.
 */

/** v5 is the current API. It has no `v6`, and no announced successor. */
export const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

/**
 * The four Lighthouse categories `measurement` has a column for
 * (src/db/schema.ts). Asking for a fifth would download a report we throw away
 * (CLAUDE.md §11.1); asking for fewer would leave a column null for no reason.
 */
export const DEFAULT_PSI_CATEGORIES = [
  'performance',
  'accessibility',
  'best-practices',
  'seo',
] as const;

export type PsiCategory = (typeof DEFAULT_PSI_CATEGORIES)[number];

export const PSI_STRATEGIES = ['mobile', 'desktop'] as const;
export type PsiStrategy = (typeof PSI_STRATEGIES)[number];

/**
 * Mobile, and it is a methodology decision rather than a default accepted in
 * passing.
 *
 * Three reasons, in the order that decided it. It is the emulation the
 * PageSpeed Insights *web page* runs first, so a commune reading its own score
 * on Google's own site sees the number this project published rather than a
 * kinder one. It is the harsher of the two — the same site measured both ways
 * on 23 August 2026 scores lower on mobile — and a published measurement that
 * flatters is worse than one that stings. And it is the majority of the traffic
 * a town hall site actually receives.
 *
 * One consequence to keep in view: `measurement` holds one set of scores, so
 * changing this later changes every number on the site. That makes it a
 * `methodology_version` matter (CLAUDE.md §11.2), not a parameter to flip.
 */
export const DEFAULT_PSI_STRATEGY: PsiStrategy = 'mobile';

export interface PsiRequest {
  /** The page to measure. Absolute, `http:` or `https:`. */
  readonly url: string;
  readonly apiKey: string;
  readonly strategy?: PsiStrategy;
  readonly categories?: readonly PsiCategory[];
}

/**
 * A request we refuse to send, as opposed to one the API refuses to answer.
 *
 * It carries no key and no interpolated target beyond what the caller already
 * has, because the one thing this module must never do is put the key
 * somewhere a log can reach (CLAUDE.md §7).
 */
export class InvalidPsiTargetError extends Error {
  override readonly name = 'InvalidPsiTargetError';

  constructor(reason: string) {
    super(`Refusing to build a PageSpeed Insights request: ${reason}.`);
  }
}

const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

function assertMeasurableTarget(url: string): void {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new InvalidPsiTargetError('the target is not an absolute URL');
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    // Never the value: a `data:` target can be arbitrarily long and a
    // `javascript:` one is somebody's payload. The scheme is what a reader of
    // the log needs, and it is bounded.
    throw new InvalidPsiTargetError(`the target scheme ${parsed.protocol} is not measurable`);
  }
}

/**
 * The URL to fetch, key included.
 *
 * The key travels in the query string because the API offers nowhere else to
 * put it — there is no header form. That is precisely why `redactPsiKey`
 * exists next door and why nothing in this repository logs the return value of
 * this function directly.
 *
 * Parameter order is fixed rather than incidental: two identical requests must
 * produce the same string, so a fixture name, a cache key or a test can be
 * written against it.
 */
export function buildPsiRequestUrl(request: PsiRequest): string {
  if (request.apiKey.trim() === '') {
    // Measured, 18 August 2026: the keyless mode of PSI is not a reduced quota,
    // it is a quota of zero — `HTTP 429, "quota_limit_value": "0"`
    // (docs/journal.md 027). Sending the request anyway would spend a second to
    // learn what is already known.
    throw new InvalidPsiTargetError('no API key was supplied');
  }

  assertMeasurableTarget(request.url);

  const query = new URLSearchParams();
  query.set('url', request.url);
  query.set('strategy', request.strategy ?? DEFAULT_PSI_STRATEGY);
  for (const category of request.categories ?? DEFAULT_PSI_CATEGORIES) {
    query.append('category', category);
  }
  query.set('key', request.apiKey);

  return `${PSI_ENDPOINT}?${query.toString()}`;
}

/**
 * The same URL, safe to log.
 *
 * String surgery rather than `URL` parsing, deliberately: the inputs worth
 * redacting include the ones that failed to parse — an error message quoting
 * the URL it choked on, a stack frame — and a redactor that only works on
 * well-formed URLs is a redactor that fails exactly when something has gone
 * wrong. Hence the word boundary rather than `[?&]`: a key that reached a
 * message as prose is the case that most needs covering, and `\b` still
 * refuses to fire inside `monkey=`.
 */
export function redactPsiKey(text: string): string {
  return text.replace(/\bkey=[^&\s]+/gi, 'key=REDACTED');
}
