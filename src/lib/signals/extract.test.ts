import { describe, expect, it } from 'vitest';
import { extractSignals } from './extract.js';

const PAGE = `<!DOCTYPE html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="generator" content="TYPO3 CMS" />
    <title>Ville d'Exemple</title>
    <link rel="stylesheet" href="/fileadmin/theme/style.css" />
  </head>
  <body>
    <main><h1>Bienvenue</h1></main>
    <footer>
      <a href="/mentions-legales">Mentions légales</a>
      <a href="/declaration-daccessibilite">Accessibilité&nbsp;: partiellement conforme</a>
      <a href="/politique-de-confidentialite">Politique de confidentialité</a>
      <a href="#tarteaucitron">Gestion des cookies</a>
    </footer>
  </body>
</html>`;

const source = (
  html: string,
  headers: Record<string, string> = {},
): Parameters<typeof extractSignals>[0] => ({
  finalUrl: 'https://www.ville-exemple.fr/',
  headers: new Headers(headers),
  html,
});

describe('extractSignals', () => {
  it('reads the eight signals of a page that carries them all', () => {
    const signals = extractSignals(
      source(PAGE, {
        'strict-transport-security': 'max-age=31536000; includeSubDomains',
        'content-security-policy': "frame-ancestors 'self';",
        'x-content-type-options': 'nosniff, nosniff',
      }),
    );

    expect(signals).toEqual({
      hasAccessibilityStatement: true,
      accessibilityStatementUrl: 'https://www.ville-exemple.fr/declaration-daccessibilite',
      hasLegalNotice: true,
      hasPrivacyPolicy: true,
      hasHsts: true,
      hasCsp: true,
      hasXContentTypeOptions: true,
      cms: 'typo3',
    });
  });

  it('reports absence as absence — false and null, never undefined', () => {
    const signals = extractSignals(
      source('<html lang="fr"><body><a href="/">Accueil</a></body></html>'),
    );

    expect(signals).toEqual({
      hasAccessibilityStatement: false,
      accessibilityStatementUrl: null,
      hasLegalNotice: false,
      hasPrivacyPolicy: false,
      hasHsts: false,
      hasCsp: false,
      hasXContentTypeOptions: false,
      cms: null,
    });
  });

  it('resolves a relative statement link against the URL the redirects landed on', () => {
    // Five of the 41 surveyed sites moved: `www.` dropped, `http` upgraded, one
    // domain changed outright. Resolving against the requested URL would file
    // the statement under an address that answers with a redirect at best.
    const signals = extractSignals({
      finalUrl: 'https://ville-exemple.fr/accueil/',
      headers: new Headers(),
      html: '<a href="../accessibilite">Accessibilité</a>',
    });

    expect(signals.accessibilityStatementUrl).toBe('https://ville-exemple.fr/accessibilite');
  });

  it('does not let a script in the page fabricate a statement', () => {
    const html = `<script>var footer = '<a href="/accessibilite">Accessibilité</a>';</script>`;

    expect(extractSignals(source(html)).hasAccessibilityStatement).toBe(false);
  });
});
