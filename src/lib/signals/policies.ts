import type { HtmlLink } from './html.js';

/**
 * Which of a page's links is its accessibility statement, its legal notice, or
 * its privacy policy — the three complementary signals of docs/brief.md §4 that
 * a footer, rather than a header, carries.
 *
 * The rule is deliberately conservative, and the reason is in CLAUDE.md §11.5:
 * the observatory publishes these next to a commune's name. Crediting a town
 * hall with a statement it does not publish is a factual error someone will
 * quote; missing one it publishes is an understatement its own footer disproves
 * in one click. Both are wrong, they are not equally wrong.
 *
 * How it works, in one sentence: a link matches when its label or its path
 * *contains the words that name the page* and **nothing else** — every other
 * token has to be in a small vocabulary of French connectives and qualifiers.
 * A blocklist was the obvious alternative and it is the wrong shape: the
 * measured false positives are "Handicap et accessibilité", "Plan
 * d'accessibilité voirie et espace public", "Sécurité et accessibilité - ERP",
 * "ADAP : commerce accessible", "Cours de Pilates accessibles à tous". There is
 * no end to that list, and there is an end to the list of ways to write
 * "Accessibilité : non conforme".
 */

export const POLICY_KINDS = ['accessibility-statement', 'legal-notice', 'privacy-policy'] as const;
export type PolicyKind = (typeof POLICY_KINDS)[number];

/**
 * Spelling variants folded onto one token: plurals, and the elisions the paths
 * write without their apostrophe (`declaration-daccessibilite` is measured, so
 * is `plan-daccessibilite`). A table rather than a stemmer — a stemmer would
 * also fold `accessible` onto `accessibilite`, which is exactly the confusion
 * the false positives above are made of.
 */
const CANONICAL_TOKENS = new Map<string, string>([
  ['daccessibilite', 'accessibilite'],
  ['laccessibilite', 'accessibilite'],
  ['accessibilites', 'accessibilite'],
  ['declarations', 'declaration'],
  ['mentions', 'mention'],
  ['legale', 'legal'],
  ['legales', 'legal'],
  ['legaux', 'legal'],
  ['politiques', 'politique'],
  ['donnees', 'donnee'],
  ['personnels', 'personnelle'],
  ['personnel', 'personnelle'],
  ['personnelles', 'personnelle'],
  ['confidentialites', 'confidentialite'],
  ['cookies', 'cookie'],
  ['conditions', 'condition'],
  ['generales', 'general'],
  ['generale', 'general'],
  ['utilisations', 'utilisation'],
  ['informations', 'information'],
  ['prive', 'privee'],
  ['privees', 'privee'],
]);

/**
 * Lower-cases, folds accents, cuts on everything that is not a letter or a
 * digit, and canonicalises what is left. `NFD` then dropping the combining
 * marks is what turns `Légales` and `LEGALES` into the same token — the
 * surveyed footers write both.
 */
export function tokenize(value: string): string[] {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token !== '')
    .map((token) => CANONICAL_TOKENS.get(token) ?? token);
}

/**
 * Tokens that may accompany the words naming a page without changing what the
 * page is: French connectives, and the qualifiers the RGAA declaration itself
 * prescribes ("partiellement conforme").
 */
const COMMON_CONTEXT = [
  'a',
  'au',
  'aux',
  'ce',
  'd',
  'de',
  'des',
  'du',
  'en',
  'et',
  'l',
  'la',
  'le',
  'les',
  'mes',
  'nos',
  'notre',
  'page',
  'politique',
  'pour',
  'sur',
  'vos',
] as const;

interface PolicyVocabulary {
  readonly kind: PolicyKind;
  /** One group must be present in full for the link to be a candidate. */
  readonly triggers: readonly (readonly string[])[];
  /** What else the label or the path segment is allowed to contain. */
  readonly context: ReadonlySet<string>;
}

const VOCABULARIES: readonly PolicyVocabulary[] = [
  {
    kind: 'accessibility-statement',
    triggers: [['accessibilite']],
    context: new Set([
      ...COMMON_CONTEXT,
      'accessibilite',
      'aide',
      'conforme',
      'conformite',
      'declaration',
      'internet',
      'navigation',
      'non',
      'numerique',
      'partiellement',
      'rgaa',
      'site',
      'totalement',
      'web',
    ]),
  },
  {
    kind: 'legal-notice',
    triggers: [['mention', 'legal']],
    context: new Set([
      ...COMMON_CONTEXT,
      'cgu',
      'cgv',
      'condition',
      'credit',
      'general',
      'information',
      'legal',
      'mention',
      'obligatoire',
      'site',
      'utilisation',
    ]),
  },
  {
    kind: 'privacy-policy',
    triggers: [
      ['confidentialite'],
      ['rgpd'],
      ['donnee', 'personnelle'],
      ['protection', 'donnee'],
      ['vie', 'privee'],
    ],
    context: new Set([
      ...COMMON_CONTEXT,
      'caractere',
      'charte',
      'confidentialite',
      'cookie',
      'donnee',
      'gestion',
      'personnelle',
      'privee',
      'protection',
      'rgpd',
      'traitement',
      'ue',
      'vie',
    ]),
  },
];

const NUMERIC_TOKEN = /^\d+$/;

/** A group is present, and everything else is vocabulary or an id in a path. */
function matchesVocabulary(tokens: readonly string[], vocabulary: PolicyVocabulary): boolean {
  // No guard on an empty list: every trigger group holds at least one token, so
  // nothing triggers on nothing. The guard that used to be here was dead, and
  // mutation testing is what said so.
  const present = new Set(tokens);
  const triggered = vocabulary.triggers.some((group) => group.every((token) => present.has(token)));
  if (!triggered) return false;

  return tokens.every((token) => vocabulary.context.has(token) || NUMERIC_TOKEN.test(token));
}

const ABSOLUTE_PREFIX = /^[a-z][a-z0-9+.-]*:\/\/[^/]*/i;
const KNOWN_EXTENSION = /\.(?:html?|s?html|php\d?|aspx?|jsp|do|pdf)$/i;

/**
 * The path segments of an href, whatever its form.
 *
 * The scheme and the host are dropped first: a commune whose domain happens to
 * contain one of these words would otherwise see every one of its links match.
 * Each segment is judged on its own — measured, the legal notice is as often at
 * `/mentions-legales` as at `/pages-specifiques-et-fonctionnalites/mentions-legales-6.html`,
 * and joining the segments would drown the second in the words around it.
 */
export function pathSegments(href: string): string[] {
  const path = href.replace(/[?#][\s\S]*$/, '').replace(ABSOLUTE_PREFIX, '');

  return path
    .split('/')
    .map((segment) => segment.replace(KNOWN_EXTENSION, ''))
    .filter((segment) => segment !== '');
}

/**
 * Every signal this link carries — usually one, sometimes two.
 *
 * The label and the path are read as two independent pieces of evidence rather
 * than as a first choice and a fallback, and one measured commune is the whole
 * reason: Lunel labels an anchor "Mentions légales" and points it at
 * `/politique-de-confidentialite/`. Reading the label alone credits the site
 * with a legal notice and misses the privacy policy it publishes; reading the
 * path alone does the opposite. Both pages exist, and the page says so twice.
 */
export function policyKindsOf(link: HtmlLink): PolicyKind[] {
  const labelTokens = tokenize(link.text);
  const segments = pathSegments(link.href).map((segment) => tokenize(segment));

  return VOCABULARIES.filter(
    (vocabulary) =>
      matchesVocabulary(labelTokens, vocabulary) ||
      segments.some((segment) => matchesVocabulary(segment, vocabulary)),
  ).map((vocabulary) => vocabulary.kind);
}

/**
 * The absolute URL a link leads to, or null when it leads nowhere.
 *
 * `#`, `#panneau`, `javascript:…`, `mailto:` and `tel:` are all measured, and
 * they are all the same answer: there is no page at the end of them. Two of the
 * 41 surveyed pages label an anchor "Accessibilité" and point it at `#`, where
 * a cookie panel opens — reading that as a published statement would be the
 * first false claim of the observatory.
 */
export function resolveLinkUrl(href: string, baseUrl: string): string | null {
  const trimmed = href.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return null;

  let resolved: URL;
  try {
    resolved = new URL(trimmed, baseUrl);
  } catch {
    return null;
  }

  if (resolved.protocol !== 'https:' && resolved.protocol !== 'http:') return null;

  return resolved.toString();
}

export interface PolicyLinks {
  readonly accessibilityStatement: string | null;
  readonly legalNotice: string | null;
  readonly privacyPolicy: string | null;
}

const EMPTY_POLICY_LINKS: PolicyLinks = {
  accessibilityStatement: null,
  legalNotice: null,
  privacyPolicy: null,
};

const FIELD_BY_KIND: Readonly<Record<PolicyKind, keyof PolicyLinks>> = {
  'accessibility-statement': 'accessibilityStatement',
  'legal-notice': 'legalNotice',
  'privacy-policy': 'privacyPolicy',
};

/**
 * The three URLs, picked from every link of the page.
 *
 * When several links claim the same kind — 69290 carries two accessibility
 * links, one of them a deep page — the one whose *own* last segment names the
 * page wins, and ties go to document order. Determinism matters more than
 * cleverness here: an operator will ask why a commune got the URL it got, and
 * "the first one, unless another was better placed" is an answer.
 */
export function findPolicyLinks(links: readonly HtmlLink[], baseUrl: string): PolicyLinks {
  const found: Record<string, string | null> = { ...EMPTY_POLICY_LINKS };
  const scores: Partial<Record<PolicyKind, number>> = {};

  for (const link of links) {
    const kinds = policyKindsOf(link);
    if (kinds.length === 0) continue;

    const url = resolveLinkUrl(link.href, baseUrl);
    if (url === null) continue;

    const last = pathSegments(link.href).at(-1);
    const lastTokens = last === undefined ? [] : tokenize(last);

    for (const kind of kinds) {
      const vocabulary = VOCABULARIES.find((entry) => entry.kind === kind);
      const score = vocabulary !== undefined && matchesVocabulary(lastTokens, vocabulary) ? 2 : 1;

      if (score > (scores[kind] ?? 0)) {
        scores[kind] = score;
        found[FIELD_BY_KIND[kind]] = url;
      }
    }
  }

  return {
    accessibilityStatement: found.accessibilityStatement ?? null,
    legalNotice: found.legalNotice ?? null,
    privacyPolicy: found.privacyPolicy ?? null,
  };
}
