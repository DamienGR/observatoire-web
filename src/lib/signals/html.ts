/**
 * A bounded scanner over third-party HTML.
 *
 * The complementary signals of docs/brief.md §4 are read from the home page of
 * a town hall — a document CLAUDE.md §7 calls hostile data. It is never
 * rendered, never evaluated, and never reinjected; all this module does is
 * report three things: the anchors, the `generator` meta tags, and whether a
 * literal marker occurs.
 *
 * Hand-written rather than a dependency, and rather than one large regular
 * expression. A parser would bring a transitive tree into the deployed bundle
 * for three questions; a single expression over a 2 MB body is how a scan turns
 * into a job. What follows is a linear walk with an explicit budget on the two
 * things a generated page can inflate: the number of anchors, and the length of
 * one label.
 */

/**
 * The busiest page of the 23 August 2026 survey carried 705 anchors
 * (Fontainebleau, 41 pages measured). The cap is roughly triple that: high
 * enough that no real footer reaches it, low enough that a generated page
 * cannot make the scan the expensive part of a measurement.
 */
export const MAX_SCANNED_LINKS = 2_000;

/**
 * Past this, the text is not a label. Measured, the longest one that carries a
 * signal is 47 characters ("Accessibilité : partiellement conforme à 85,27%").
 * An anchor wrapping a whole news card is not shortened, it is *discarded* —
 * truncating it could remove the very words that disqualify it and turn a
 * teaser about a Pilates class into an accessibility statement.
 */
export const MAX_LINK_TEXT = 300;

export interface HtmlLink {
  /** Verbatim, entities decoded. Resolving it against a base is not our job. */
  readonly href: string;
  /** Tags stripped, entities decoded, whitespace collapsed. */
  readonly text: string;
}

export interface HtmlDocument {
  readonly links: readonly HtmlLink[];
  /** Every `<meta name="generator">`, in document order. */
  readonly generators: readonly string[];
}

/** Elements whose content is code or prose about code, never links. */
const OPAQUE_ELEMENTS = new Set(['script', 'style', 'template', 'noscript']);

/**
 * The named entities the surveyed pages actually contain, plus the five of the
 * HTML core. Anything else is left verbatim: a half-decoded label is worse than
 * an undecoded one, and this list grows when a measurement asks it to.
 */
const NAMED_ENTITIES = new Map<string, string>([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['nbsp', ' '],
  ['eacute', 'é'],
  ['egrave', 'è'],
  ['ecirc', 'ê'],
  ['agrave', 'à'],
  ['ccedil', 'ç'],
  ['ocirc', 'ô'],
  ['icirc', 'î'],
  ['ugrave', 'ù'],
  ['ndash', '–'],
  ['mdash', '—'],
  ['rsquo', '’'],
  ['lsquo', '‘'],
  ['laquo', '«'],
  ['raquo', '»'],
  ['hellip', '…'],
]);

const ENTITY_PATTERN = /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi;

/** Decodes the entities we know and leaves the rest alone, deliberately. */
export function decodeEntities(value: string): string {
  return value.replace(ENTITY_PATTERN, (whole, body: string) => {
    const lower = body.toLowerCase();

    if (lower.startsWith('#x')) {
      const code = Number.parseInt(lower.slice(2), 16);
      return codePointOr(code, whole);
    }
    if (lower.startsWith('#')) {
      return codePointOr(Number.parseInt(lower.slice(1), 10), whole);
    }

    return NAMED_ENTITIES.get(lower) ?? whole;
  });
}

function codePointOr(code: number, fallback: string): string {
  // `Number.isFinite` covers the NaN a malformed numeric entity produces; the
  // range is the one `fromCodePoint` accepts, and going past it throws.
  if (!Number.isFinite(code) || code < 1 || code > 0x10ffff) return fallback;
  return String.fromCodePoint(code);
}

interface Tag {
  readonly name: string;
  readonly closing: boolean;
  readonly attributes: ReadonlyMap<string, string>;
  /** Index just past the closing `>`. */
  readonly end: number;
}

/**
 * `charAt` rather than an index: it answers `''` past the end, where indexing
 * answers `undefined` and forces a `?? ''` that no test can ever reach.
 */
function isWhitespace(char: string): boolean {
  return char !== '' && /\s/.test(char);
}

const TAG_NAME_PATTERN = /[a-zA-Z][a-zA-Z0-9:-]*/y;
const ATTRIBUTE_NAME_PATTERN = /[^\s=/>]+/y;

/**
 * Reads one tag starting at `<`, or returns null when what follows is not a tag
 * — a stray `<` in prose, a doctype, a processing instruction.
 *
 * Attribute values are read with their quoting, so a `>` inside one does not
 * end the tag. That is not a nicety: `<a title="a > b" href="/x">` is valid
 * HTML, and a scanner that stops at the first `>` reads no href at all.
 */
function parseTag(html: string, start: number): Tag | null {
  let index = start + 1;
  const closing = html[index] === '/';
  if (closing) index += 1;

  TAG_NAME_PATTERN.lastIndex = index;
  const nameMatch = TAG_NAME_PATTERN.exec(html);
  if (nameMatch === null) return null;

  const name = nameMatch[0].toLowerCase();
  index = TAG_NAME_PATTERN.lastIndex;

  const attributes = new Map<string, string>();

  while (index < html.length) {
    while (isWhitespace(html.charAt(index))) index += 1;

    const char = html.charAt(index);
    if (char === '') break;
    // `>` ends the tag, and that covers `/>` too: a `/` where an attribute
    // name is expected matches nothing below and is stepped over, so the next
    // turn of the loop finds the `>`. The explicit self-closing branch that
    // used to sit here was removed after mutation testing showed no test could
    // tell it apart from its absence — because nothing can.
    if (char === '>') return { name, closing, attributes, end: index + 1 };

    ATTRIBUTE_NAME_PATTERN.lastIndex = index;
    const attributeMatch = ATTRIBUTE_NAME_PATTERN.exec(html);
    if (attributeMatch === null) {
      // A `/` or `=` where a name was expected: step over it rather than spin.
      index += 1;
      continue;
    }

    const attributeName = attributeMatch[0].toLowerCase();
    index = ATTRIBUTE_NAME_PATTERN.lastIndex;

    while (isWhitespace(html.charAt(index))) index += 1;

    if (html.charAt(index) !== '=') {
      attributes.set(attributeName, '');
      continue;
    }

    index += 1;
    while (isWhitespace(html.charAt(index))) index += 1;

    const quote = html.charAt(index);
    if (quote === '"' || quote === "'") {
      const close = html.indexOf(quote, index + 1);
      if (close === -1) break;
      attributes.set(attributeName, html.slice(index + 1, close));
      index = close + 1;
      continue;
    }

    let stop = index;
    while (stop < html.length && !/[\s>]/.test(html.charAt(stop))) stop += 1;
    attributes.set(attributeName, html.slice(index, stop));
    index = stop;
  }

  // Unterminated tag: the document ends inside it, and there is nothing after.
  return { name, closing, attributes, end: html.length };
}

/** Where the content of an opaque element ends, so the walk can jump it. */
function skipOpaqueElement(html: string, tag: Tag): number {
  const pattern = new RegExp(`</${tag.name}\\b`, 'i');
  pattern.lastIndex = tag.end;
  const rest = pattern.exec(html.slice(tag.end));
  if (rest === null) return html.length;

  const close = html.indexOf('>', tag.end + rest.index);
  return close === -1 ? html.length : close + 1;
}

/**
 * Either the anchor closes, or another one opens: both end the label. An
 * unclosed anchor at the end of the document yields an empty text rather than
 * whatever follows — the guarded client caps a body at 2 MB, so that shape is
 * most often a truncated page, and half a label is not a label.
 */
const LINK_BOUNDARY_PATTERN = /<\/a\b|<a[\s/>]/gi;

function readLinkText(html: string, from: number): string {
  LINK_BOUNDARY_PATTERN.lastIndex = from;
  const boundary = LINK_BOUNDARY_PATTERN.exec(html);
  if (boundary === null) return '';
  if (boundary.index - from > MAX_LINK_TEXT) return '';

  return decodeEntities(html.slice(from, boundary.index))
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Walks the document once and reports the three things we read from it. */
export function scanHtml(html: string): HtmlDocument {
  const links: HtmlLink[] = [];
  const generators: string[] = [];
  let index = 0;

  while (index < html.length && links.length < MAX_SCANNED_LINKS) {
    const next = html.indexOf('<', index);
    if (next === -1) break;

    if (html.startsWith('<!--', next)) {
      const close = html.indexOf('-->', next + 4);
      index = close === -1 ? html.length : close + 3;
      continue;
    }

    const tag = parseTag(html, next);
    if (tag === null) {
      index = next + 1;
      continue;
    }

    if (!tag.closing && OPAQUE_ELEMENTS.has(tag.name)) {
      index = skipOpaqueElement(html, tag);
      continue;
    }

    if (!tag.closing && tag.name === 'a') {
      const href = tag.attributes.get('href');
      if (href !== undefined && href.trim() !== '') {
        links.push({ href: decodeEntities(href.trim()), text: readLinkText(html, tag.end) });
      }
    }

    if (!tag.closing && tag.name === 'meta') {
      const content = tag.attributes.get('content');
      if (tag.attributes.get('name')?.toLowerCase() === 'generator' && content !== undefined) {
        generators.push(decodeEntities(content.trim()));
      }
    }

    index = tag.end;
  }

  return { links, generators };
}

const REGEXP_SPECIALS = /[.*+?^${}()|[\]\\]/g;

/**
 * Whether a literal marker occurs, case-insensitively.
 *
 * A regular expression rather than `toLowerCase().includes()` on purpose: the
 * bodies are up to 2 MB and the callers ask several markers each, so lowering a
 * copy per question is megabytes of garbage per page for no benefit.
 */
export function containsMarker(html: string, marker: string): boolean {
  return new RegExp(marker.replace(REGEXP_SPECIALS, '\\$&'), 'i').test(html);
}
