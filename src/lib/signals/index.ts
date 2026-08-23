/**
 * The complementary signals of docs/brief.md §4, read from one direct fetch of
 * a town hall's home page: accessibility statement, legal notice, privacy
 * policy, three security headers, and the CMS behind the site.
 *
 * They are the half of a measurement PageSpeed Insights does not give. Where
 * PSI answers "how well is this page built", these answer "does this commune
 * publish what the law asks it to publish" — and unlike a Lighthouse score,
 * they are read from the document itself, so the rules that read them are the
 * measurement. That is why they live here in full, in pure functions with the
 * vocabulary written down, rather than as a handful of regular expressions
 * inside a job nobody can test.
 *
 *  - `html`     — a bounded scanner over hostile HTML: anchors, generators, markers.
 *  - `policies` — which link is the statement, the notice, the policy.
 *  - `headers`  — HSTS, CSP and `nosniff`, and what each boolean really asserts.
 *  - `cms`      — five fingerprints, measured, and `null` as a real answer.
 *  - `extract`  — the eight fields, named as the columns of `measurement`.
 *  - `collect`  — the one fetch, through the guard, and what a failure means.
 *
 * Everything but `collect` is pure. `collect` takes its transport by injection
 * and decides nothing the others could have decided.
 */

export {
  MAX_LINK_TEXT,
  MAX_SCANNED_LINKS,
  containsMarker,
  decodeEntities,
  scanHtml,
} from './html.js';
export type { HtmlDocument, HtmlLink } from './html.js';

export {
  POLICY_KINDS,
  policyKindsOf,
  findPolicyLinks,
  pathSegments,
  resolveLinkUrl,
  tokenize,
} from './policies.js';
export type { PolicyKind, PolicyLinks } from './policies.js';

export { readSecurityHeaders } from './headers.js';
export type { HeaderLookup, SecurityHeaders } from './headers.js';

export { KNOWN_CMS, detectCms } from './cms.js';
export type { Cms, CmsEvidence } from './cms.js';

export { extractSignals } from './extract.js';
export type { SignalSource, SiteSignals } from './extract.js';

export { SIGNAL_ERROR_CODES, collectSignals } from './collect.js';
export type {
  CollectSignalsOptions,
  SignalErrorCode,
  SignalsCollection,
  SignalsFailure,
  SignalsSuccess,
} from './collect.js';
