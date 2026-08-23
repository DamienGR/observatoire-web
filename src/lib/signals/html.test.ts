import { describe, expect, it } from 'vitest';
import { MAX_SCANNED_LINKS, containsMarker, decodeEntities, scanHtml } from './html.js';

/**
 * The scanner is fed the HTML of a town hall's home page, which CLAUDE.md §7
 * calls hostile data. Every case below comes from the 41 pages measured on
 * 23 August 2026 (docs/journal.md 031) unless it says otherwise.
 */

describe('scanHtml — links', () => {
  it('reads the href and the text of an anchor', () => {
    const document = scanHtml('<a href="/accessibilite">Accessibilité</a>');

    expect(document.links).toEqual([{ href: '/accessibilite', text: 'Accessibilité' }]);
  });

  it.each([
    ['double quotes', '<a href="/a">x</a>'],
    ['single quotes', "<a href='/a'>x</a>"],
    ['no quotes', '<a href=/a>x</a>'],
    ['spaces around the equals sign', '<a href = "/a">x</a>'],
    ['an uppercase tag and attribute', '<A HREF="/a">x</A>'],
    ['other attributes first', '<a class="footer__link" href="/a" rel="nofollow">x</a>'],
  ])('reads an href written with %s', (_case, html) => {
    expect(scanHtml(html).links).toEqual([{ href: '/a', text: 'x' }]);
  });

  it('ignores an anchor with no href — it is a target, not a link', () => {
    expect(scanHtml('<a name="haut"></a>').links).toEqual([]);
  });

  it('strips the tags nested inside the text', () => {
    const html = '<a href="/a"><span class="icon"></span> Mentions <b>légales</b></a>';

    expect(scanHtml(html).links).toEqual([{ href: '/a', text: 'Mentions légales' }]);
  });

  it('collapses whitespace, which the source spreads over several lines', () => {
    const html = '<a href="/a">\n      Politique\n      de confidentialité\n    </a>';

    expect(scanHtml(html).links).toEqual([{ href: '/a', text: 'Politique de confidentialité' }]);
  });

  it.each([
    [
      '&nbsp;',
      'Accessibilité&nbsp;: partiellement conforme',
      'Accessibilité : partiellement conforme',
    ],
    ['&#039;', 'Déclaration d&#039;accessibilité', "Déclaration d'accessibilité"],
    ['&amp;', 'Données personnelles &amp; cookies', 'Données personnelles & cookies'],
    ['&eacute;', 'Mentions l&eacute;gales', 'Mentions légales'],
    ['&#x2019;', 'Plus d&#x2019;informations', 'Plus d’informations'],
  ])('decodes the %s entity the pages really use', (_entity, source, expected) => {
    expect(scanHtml(`<a href="/a">${source}</a>`).links[0]?.text).toBe(expected);
  });

  it('leaves an unknown entity alone rather than guessing at it', () => {
    expect(scanHtml('<a href="/a">A &notanentity; B</a>').links[0]?.text).toBe('A &notanentity; B');
  });

  it('decodes the entities of an href too', () => {
    const document = scanHtml('<a href="/a?x=1&amp;y=2">x</a>');

    expect(document.links[0]?.href).toBe('/a?x=1&y=2');
  });

  it('reads a `>` inside an attribute value as text, not as the end of the tag', () => {
    const document = scanHtml('<a title="a > b" href="/a">x</a>');

    expect(document.links).toEqual([{ href: '/a', text: 'x' }]);
  });

  it('ignores anchors written inside a script — they are strings, not links', () => {
    const html = '<script>var s = \'<a href="/piege">Mentions légales</a>\';</script>';

    expect(scanHtml(html).links).toEqual([]);
  });

  it('ignores anchors inside a style block and inside a comment', () => {
    const html =
      '<style>/* <a href="/a">x</a> */</style><!-- <a href="/b">y</a> --><a href="/c">z</a>';

    expect(scanHtml(html).links).toEqual([{ href: '/c', text: 'z' }]);
  });

  it.each([
    ['a script nobody closed', '<a href="/a">x</a><script>var s = 1;'],
    ['a script whose closing tag is cut off', '<a href="/a">x</a><script>var s = 1;</script'],
    ['a comment nobody closed', '<a href="/a">x</a><!-- <a href="/b">y</a>'],
  ])('stops reading at %s rather than trusting what follows', (_case, html) => {
    expect(scanHtml(html).links).toEqual([{ href: '/a', text: 'x' }]);
  });

  it('recovers from an anchor nobody closed instead of swallowing the rest', () => {
    const document = scanHtml('<a href="/a">Accueil<a href="/b">Mentions légales</a>');

    expect(document.links).toEqual([
      { href: '/a', text: 'Accueil' },
      { href: '/b', text: 'Mentions légales' },
    ]);
  });

  it('reports an unterminated anchor with an empty text rather than dropping it', () => {
    expect(scanHtml('<a href="/a">Mentions légales').links).toEqual([{ href: '/a', text: '' }]);
  });

  it('discards a label longer than the cap instead of truncating it', () => {
    // Truncating could cut away the words that disqualify a candidate, which is
    // how a teaser for a Pilates class becomes an accessibility statement.
    const long = `Accessibilité ${'et de la voirie '.repeat(30)}`;

    expect(scanHtml(`<a href="/a">${long}</a>`).links).toEqual([{ href: '/a', text: '' }]);
  });

  it('reads an attribute that carries no value', () => {
    expect(scanHtml('<a href="/a" download>x</a>').links).toEqual([{ href: '/a', text: 'x' }]);
  });

  it('steps over a stray `=` where an attribute name was expected', () => {
    expect(scanHtml('<a = href="/a">x</a>').links).toEqual([{ href: '/a', text: 'x' }]);
  });

  it.each([
    ['a tag the document ends inside', '<a href="/a"'],
    ['a quote nobody closed', '<a href="/a'],
    ['a tag that ends on a space', '<a '],
  ])('does not hang on %s', (_case, html) => {
    expect(() => scanHtml(html)).not.toThrow();
  });

  it('stops after a bounded number of links', () => {
    // The busiest page of the survey carried 705 anchors (Fontainebleau); the
    // cap is here so that a generated page cannot turn a scan into a job.
    const html = '<a href="/a">x</a>'.repeat(MAX_SCANNED_LINKS + 10);

    expect(scanHtml(html).links).toHaveLength(MAX_SCANNED_LINKS);
  });
});

describe('decodeEntities', () => {
  it.each([
    ['&#0;', 'a code point no character has'],
    ['&#x110000;', 'a code point past the last plane'],
    [`&#${'9'.repeat(400)};`, 'a number so long it parses to Infinity'],
  ])('leaves %s alone — %s', (entity) => {
    // `String.fromCodePoint` throws on all three. A label is decoded on a best
    // effort; a scan is not allowed to fail because a page is malformed.
    expect(decodeEntities(entity)).toBe(entity);
  });
});

describe('scanHtml — generators', () => {
  it('reads the generator meta tag', () => {
    expect(scanHtml('<meta name="generator" content="TYPO3 CMS" />').generators).toEqual([
      'TYPO3 CMS',
    ]);
  });

  it('reads it whatever the case of the attribute value — Drupal writes `Generator`', () => {
    expect(
      scanHtml('<meta name="Generator" content="Drupal 9 (https://www.drupal.org)" />').generators,
    ).toEqual(['Drupal 9 (https://www.drupal.org)']);
  });

  it('reads it when `content` comes before `name`, as one surveyed page writes it', () => {
    expect(
      scanHtml('<meta content="Moovapps Commerce Studio" name="generator" />').generators,
    ).toEqual(['Moovapps Commerce Studio']);
  });

  it('keeps every generator: WordPress declares one per plugin', () => {
    const html =
      '<meta name="generator" content="WordPress 7.1" />' +
      '<meta name="generator" content="Elementor 4.2.3; features: additional_custom_breakpoints">';

    expect(scanHtml(html).generators).toEqual([
      'WordPress 7.1',
      'Elementor 4.2.3; features: additional_custom_breakpoints',
    ]);
  });

  it('ignores a meta tag that is not a generator', () => {
    expect(scanHtml('<meta name="description" content="Ville de X" />').generators).toEqual([]);
  });

  it('ignores a generator with no content', () => {
    expect(scanHtml('<meta name="generator" />').generators).toEqual([]);
  });
});

describe('containsMarker', () => {
  it('finds a marker whatever the case of the page', () => {
    expect(containsMarker('<link href="/WP-CONTENT/themes/x.css">', '/wp-content/')).toBe(true);
  });

  it('does not find what is not there', () => {
    expect(containsMarker('<link href="/assets/x.css">', '/wp-content/')).toBe(false);
  });
});
