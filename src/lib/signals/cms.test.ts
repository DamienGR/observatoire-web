import { describe, expect, it } from 'vitest';
import { detectCms } from './cms.js';

const evidence = (
  overrides: Partial<{ generators: string[]; headers: Headers; html: string }> = {},
): { generators: readonly string[]; headers: Headers; html: string } => ({
  generators: overrides.generators ?? [],
  headers: overrides.headers ?? new Headers(),
  html: overrides.html ?? '<html lang="fr"></html>',
});

/**
 * Every string below was read off one of the 41 pages surveyed on 23 August
 * 2026 (docs/journal.md 031). The distribution measured there — 21 WordPress,
 * 8 TYPO3, 2 Drupal, 1 Joomla, 1 SPIP, 8 unidentified — is why the table has
 * these five and not the twenty a generic detector would carry.
 */

describe('detectCms — from the generator meta', () => {
  it.each([
    ['WordPress 7.1', 'wordpress'],
    ['WordPress 6.9.4', 'wordpress'],
    ['WP Rocket 3.23.2.1', 'wordpress'],
    ['Elementor 4.1.5; features: additional_custom_breakpoints', 'wordpress'],
    ['Powered by WPBakery Page Builder - drag and drop page builder for WordPress.', 'wordpress'],
    ['TYPO3 CMS', 'typo3'],
    ['Drupal 9 (https://www.drupal.org)', 'drupal'],
    ['SPIP', 'spip'],
    ['Joomla! - Open Source Content Management', 'joomla'],
  ])('reads %s as %s', (generator, expected) => {
    expect(detectCms(evidence({ generators: [generator] }))).toBe(expected);
  });

  it.each([['abc-cms'], ['Moovapps Commerce Studio - http://www.moovapps.com'], ['']])(
    'reports %s as unidentified rather than guessing',
    (generator) => {
      // Two surveyed communes run a product this table does not know. `null`
      // says "no fingerprint recognised", and the page that publishes the
      // signal has to say the same thing.
      expect(detectCms(evidence({ generators: [generator] }))).toBeNull();
    },
  );

  it('takes the platform over the plugin when both declare themselves', () => {
    const generators = [
      'WordPress 7.1',
      'Elementor 4.2.3; features: additional_custom_breakpoints',
    ];

    expect(detectCms(evidence({ generators }))).toBe('wordpress');
  });
});

describe('detectCms — from the headers', () => {
  it('reads the X-Generator header, which is where one surveyed site puts it', () => {
    const headers = new Headers({ 'x-generator': 'Drupal 9 (https://www.drupal.org)' });

    expect(detectCms(evidence({ headers }))).toBe('drupal');
  });

  it('reads a Drupal cache header as Drupal', () => {
    const headers = new Headers({ 'x-drupal-cache': 'HIT' });

    expect(detectCms(evidence({ headers }))).toBe('drupal');
  });

  it.each([['PHP/8.3'], ['ASP.NET'], ['PleskLin']])(
    'reads %s as no CMS at all — a runtime is not a CMS',
    (poweredBy) => {
      expect(
        detectCms(evidence({ headers: new Headers({ 'x-powered-by': poweredBy }) })),
      ).toBeNull();
    },
  );
});

describe('detectCms — from the body', () => {
  it.each([
    ['<link href="/wp-content/themes/mairie/style.css">', 'wordpress'],
    ['<script src="/wp-includes/js/jquery.js"></script>', 'wordpress'],
    ['<link href="https://www.exemple.fr/wp-json/" rel="https://api.w.org/">', 'wordpress'],
    ['<img src="/sites/default/files/logo.png">', 'drupal'],
    [
      '<script type="application/json" data-drupal-selector="drupal-settings-json">{}</script>',
      'drupal',
    ],
    ['<link href="/typo3conf/ext/theme/style.css">', 'typo3'],
    ['<img src="/typo3temp/assets/logo.png">', 'typo3'],
    ['<img src="/fileadmin/user_upload/logo.png">', 'typo3'],
    ['<a href="spip.php?article12">Article</a>', 'spip'],
    ['<link href="/local/cache-css/style.css">', 'spip'],
    ['<script src="/media/jui/js/jquery.min.js"></script>', 'joomla'],
    ['<form action="/index.php?option=com_content&view=article">', 'joomla'],
  ])('reads %s as %s', (html, expected) => {
    expect(detectCms(evidence({ html }))).toBe(expected);
  });

  it('does not read a bare product name in the prose as a fingerprint', () => {
    // Measured, and the reason this rule exists: a WordPress page mentioning
    // "SPIP" in a news item was detected as SPIP by a first pass that matched
    // the bare word. Fingerprints are paths and declarations, never names.
    const html =
      '<p>Le site a migré de SPIP vers un nouvel outil.</p><link href="/wp-content/x.css">';

    expect(detectCms(evidence({ html }))).toBe('wordpress');
  });

  it('reports a page with no fingerprint at all as unidentified', () => {
    expect(detectCms(evidence())).toBeNull();
  });
});

describe('detectCms — precedence', () => {
  it('believes the declaration over the body when they disagree', () => {
    // A Drupal theme borrowing a path that looks like another product's is
    // less likely than a site declaring what it runs. The order is written
    // down so that the answer does not depend on which check runs first.
    const found = detectCms(
      evidence({ generators: ['TYPO3 CMS'], html: '<link href="/wp-content/x.css">' }),
    );

    expect(found).toBe('typo3');
  });
});
