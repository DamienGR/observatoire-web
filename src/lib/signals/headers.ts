/**
 * The three security headers of the complementary signals (docs/brief.md §4),
 * read off the response the guarded client brought back.
 *
 * They are booleans in the schema, and a boolean has to be honest about what it
 * asserts. `has_csp` says a policy is declared, not that the policy is worth
 * anything: six of the fifteen measured policies only set `frame-ancestors`,
 * which restricts framing and nothing else. Grading them would be a scoring
 * decision, and scoring is an open question of docs/brief.md §11 that no
 * extraction module gets to settle by accident.
 */

/** `Headers` satisfies this; a plain object in a test does too. */
export interface HeaderLookup {
  get(name: string): string | null;
}

export interface SecurityHeaders {
  readonly hasHsts: boolean;
  readonly hasCsp: boolean;
  readonly hasXContentTypeOptions: boolean;
}

const MAX_AGE_DIRECTIVE = /(?:^|;)\s*max-age\s*=\s*"?(\d+)"?/i;

/**
 * HSTS counts only with a positive `max-age`.
 *
 * `max-age=0` is not a weak policy, it is the documented way to *withdraw* one:
 * RFC 6797 §6.1.1 makes it the instruction to forget the host. Reading the
 * header's presence alone would credit a commune for the line that switches the
 * protection off.
 */
function declaresHsts(value: string | null): boolean {
  if (value === null) return false;

  const match = MAX_AGE_DIRECTIVE.exec(value);
  if (match === null) return false;

  return Number(match[1]) > 0;
}

/**
 * `nosniff` among the comma-separated values, not equal to it.
 *
 * Measured: one response carries `nosniff, nosniff` — the origin sets the
 * header and so does the CDN in front of it, and `Headers.get` joins repeated
 * headers with a comma. An equality test reads that commune as unprotected.
 */
function declaresNoSniff(value: string | null): boolean {
  if (value === null) return false;

  return value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .includes('nosniff');
}

export function readSecurityHeaders(headers: HeaderLookup): SecurityHeaders {
  // Deliberately not `content-security-policy-report-only`: a report-only
  // policy enforces nothing, and the signal claims enforcement.
  const csp = headers.get('content-security-policy');

  return {
    hasHsts: declaresHsts(headers.get('strict-transport-security')),
    hasCsp: csp !== null && csp.trim() !== '',
    hasXContentTypeOptions: declaresNoSniff(headers.get('x-content-type-options')),
  };
}
