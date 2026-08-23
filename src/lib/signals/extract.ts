import { detectCms, type Cms } from './cms.js';
import { readSecurityHeaders, type HeaderLookup } from './headers.js';
import { scanHtml, type HtmlDocument } from './html.js';
import { findPolicyLinks } from './policies.js';

/**
 * The complementary signals of docs/brief.md §4, read from one response.
 *
 * Pure: it takes a document and gives back the eight fields, named exactly as
 * the columns of `measurement` (src/db/schema.ts) so the writer of J2-04 has
 * nothing to translate — a mapping layer between two identical shapes is a
 * place for a field to be dropped in silence.
 *
 * Nothing here is optional. `false` and `null` mean *measured and absent*,
 * which is only true because the caller does not call this at all when the
 * fetch failed: the schema keeps the distinction between "absent" and "not
 * measured", and `collect.ts` is where the second case is produced.
 */

export interface SignalSource {
  /** Where the redirects landed — relative links are resolved against it. */
  readonly finalUrl: string;
  readonly headers: HeaderLookup;
  readonly html: string;
}

export interface SiteSignals {
  readonly hasAccessibilityStatement: boolean;
  readonly accessibilityStatementUrl: string | null;
  readonly hasLegalNotice: boolean;
  readonly hasPrivacyPolicy: boolean;
  readonly hasHsts: boolean;
  readonly hasCsp: boolean;
  readonly hasXContentTypeOptions: boolean;
  readonly cms: Cms | null;
}

/**
 * The document is a parameter with a default so that `collect.ts`, which has
 * already scanned the body to see whether it holds a single link, does not scan
 * two megabytes a second time to answer the same question.
 */
export function extractSignals(
  source: SignalSource,
  document: HtmlDocument = scanHtml(source.html),
): SiteSignals {
  const policies = findPolicyLinks(document.links, source.finalUrl);
  const security = readSecurityHeaders(source.headers);

  return {
    hasAccessibilityStatement: policies.accessibilityStatement !== null,
    accessibilityStatementUrl: policies.accessibilityStatement,
    hasLegalNotice: policies.legalNotice !== null,
    hasPrivacyPolicy: policies.privacyPolicy !== null,
    hasHsts: security.hasHsts,
    hasCsp: security.hasCsp,
    hasXContentTypeOptions: security.hasXContentTypeOptions,
    cms: detectCms({
      generators: document.generators,
      headers: source.headers,
      html: source.html,
    }),
  };
}
