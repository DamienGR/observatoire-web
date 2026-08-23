import { containsMarker } from './html.js';
import type { HeaderLookup } from './headers.js';

/**
 * Which content management system a town hall's site runs on — the last of the
 * complementary signals of docs/brief.md §4, and the one the brief's filterable
 * rankings are built on ("par CMS détecté", §3).
 *
 * Five products, because the survey of 23 August 2026 measured five across 41
 * communes: WordPress 21, TYPO3 8, Drupal 2, Joomla 1, SPIP 1, and 8 sites
 * whose product this table does not know. A longer list copied from a generic
 * detector would carry twenty fingerprints for platforms no French commune
 * runs, each an opportunity for a false positive nobody would ever check.
 *
 * The table grows when a measurement asks it to, and `null` is a real answer in
 * the meantime: "no fingerprint recognised", which the page publishing the
 * signal has to word the same way.
 */

export const KNOWN_CMS = ['wordpress', 'drupal', 'typo3', 'spip', 'joomla'] as const;
export type Cms = (typeof KNOWN_CMS)[number];

interface CmsFingerprint {
  readonly cms: Cms;
  /** Matched against `<meta name="generator">` and the `X-Generator` header. */
  readonly declarations: readonly RegExp[];
  /** Matched against the body. Paths and declarations only — never a name. */
  readonly markers: readonly string[];
  /** Response headers that only this product sets. */
  readonly headers: readonly string[];
}

/**
 * Body markers are paths, not product names, and that is the load-bearing rule.
 * A first pass matched the bare word `SPIP` anywhere in the document and read a
 * WordPress site as SPIP because a news item mentioned a migration. A path like
 * `/wp-content/` is emitted by the software; a name is emitted by anyone.
 */
const FINGERPRINTS: readonly CmsFingerprint[] = [
  {
    cms: 'wordpress',
    // WP Rocket and Elementor name themselves without naming WordPress; the
    // other measured plugin generators (WPBakery, Slider Revolution) spell out
    // "for WordPress" and the first pattern already covers them.
    declarations: [/\bwordpress\b/i, /\bwp rocket\b/i, /\belementor\b/i],
    markers: ['/wp-content/', '/wp-includes/', '/wp-json/'],
    headers: [],
  },
  {
    cms: 'drupal',
    declarations: [/\bdrupal\b/i],
    markers: ['/sites/default/files', 'drupal-settings-json', 'Drupal.settings'],
    headers: ['x-drupal-cache', 'x-drupal-dynamic-cache'],
  },
  {
    cms: 'typo3',
    declarations: [/\btypo3\b/i],
    markers: ['typo3conf', 'typo3temp', '/fileadmin/'],
    headers: [],
  },
  {
    cms: 'spip',
    declarations: [/\bspip\b/i],
    markers: ['spip.php', '/local/cache-'],
    headers: [],
  },
  {
    cms: 'joomla',
    declarations: [/\bjoomla\b/i],
    markers: ['/media/jui/', 'com_content', '/media/system/js/'],
    headers: [],
  },
];

export interface CmsEvidence {
  /** Every `<meta name="generator">` of the page, in document order. */
  readonly generators: readonly string[];
  readonly headers: HeaderLookup;
  readonly html: string;
}

/**
 * The product, or null.
 *
 * Declarations are read before the body on purpose: a site saying what it runs
 * is better evidence than a path that resembles something, and writing the
 * order down means the answer does not depend on which check happens to run
 * first. Within one source, the table's order decides.
 */
export function detectCms(evidence: CmsEvidence): Cms | null {
  const declared = [...evidence.generators, evidence.headers.get('x-generator') ?? ''];

  for (const fingerprint of FINGERPRINTS) {
    if (fingerprint.declarations.some((pattern) => declared.some((value) => pattern.test(value)))) {
      return fingerprint.cms;
    }
  }

  for (const fingerprint of FINGERPRINTS) {
    if (fingerprint.headers.some((name) => evidence.headers.get(name) !== null)) {
      return fingerprint.cms;
    }
  }

  for (const fingerprint of FINGERPRINTS) {
    if (fingerprint.markers.some((marker) => containsMarker(evidence.html, marker))) {
      return fingerprint.cms;
    }
  }

  return null;
}
