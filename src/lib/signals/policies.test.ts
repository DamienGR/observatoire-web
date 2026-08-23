import { describe, expect, it } from 'vitest';
import {
  findPolicyLinks,
  pathSegments,
  policyKindsOf,
  resolveLinkUrl,
  tokenize,
} from './policies.js';

/**
 * The tables below are the labels and paths of the 41 town hall home pages
 * surveyed on 23 August 2026 (docs/journal.md 031), copied verbatim. Nothing
 * here is invented: the point of the survey was that a rule written from
 * imagined footers would have declared half a dozen communes free of a legal
 * notice they publish, and credited two others with a statement they do not.
 */

describe('tokenize', () => {
  it('folds accents and case, because the same label is written both ways', () => {
    expect(tokenize('Mentions Légales')).toEqual(['mention', 'legal']);
  });

  it('cuts on the apostrophe as on a space', () => {
    expect(tokenize("Déclaration d'accessibilité")).toEqual(['declaration', 'd', 'accessibilite']);
  });

  it('reads an elided form written without its apostrophe', () => {
    // Measured: `plan-daccessibilite-…` and `declaration-daccessibilite`.
    expect(tokenize('declaration-daccessibilite')).toEqual(['declaration', 'accessibilite']);
  });

  it('brings a plural back to the singular the vocabulary is written in', () => {
    expect(tokenize('politiques de confidentialité')).toEqual([
      'politique',
      'de',
      'confidentialite',
    ]);
  });

  it('keeps a number as a token — paths carry ids', () => {
    expect(tokenize('accessibilite-7')).toEqual(['accessibilite', '7']);
  });

  it('drops empty tokens rather than emitting them', () => {
    expect(tokenize('  --  ')).toEqual([]);
  });
});

describe('pathSegments', () => {
  it.each([
    ['/mentions-legales', ['mentions-legales']],
    ['/20/mentions-legales.htm', ['20', 'mentions-legales']],
    ['./accessibilite.aspx', ['.', 'accessibilite']],
    ['article292.html', ['article292']],
    // The host is dropped: a commune whose domain carried one of these words
    // would otherwise see every one of its links match.
    ['https://accessibilite.example.fr/agenda', ['agenda']],
    ['/accessibilite/?utm_source=footer', ['accessibilite']],
    ['/accessibilite#contenu', ['accessibilite']],
    // Empty segments are dropped rather than carried: a doubled slash and a
    // trailing one are typing, not structure.
    ['//accessibilite//', ['accessibilite']],
    ['/', []],
  ])('reads %s as %j', (href, expected) => {
    expect(pathSegments(href)).toEqual(expected);
  });
});

describe('policyKindsOf — accessibility statement', () => {
  it.each([
    ['Accessibilité', '/accessibilite/'],
    ['Accessibilité : partiellement conforme', '/accessibilite'],
    ['Accessibilité : non conforme', '/accessibilite-numerique'],
    ['Accessibilité : part. conforme', '/declaration-daccessibilite'],
    ['Accessibilité (RGAA)', '/accessibilite-du-site/'],
    ['Accessibilité – (non conforme)', 'https://www.ville-hem.fr/accessibilite/'],
    [
      'Accessibilité : partiellement conforme à 85,27%',
      'https://ville-saint-priest.fr/accessibilite/',
    ],
    ['Déclaration d’accessibilité', 'https://www.noisylesec.fr/accessibilite/'],
    ['Accessibilité et navigation', './accessibilite.aspx'],
    ['Aide et accessibilité', 'article292.html'],
    ['Aide à la navigation', '/accessibilite-7.html'],
    ["Politique d'accessibilté [0]", 'https://www.mairie-chateaubriant.fr/systeme/accessibilite/'],
    ['Accessibilité', '/pages-specifiques-et-fonctionnalites/accessibilite-non-conforme-7.html'],
    ['Accessibilité', '/19/accessibilite.htm'],
  ])('recognises %s → %s', (text, href) => {
    expect(policyKindsOf({ text, href })).toContain('accessibility-statement');
  });

  it.each([
    ['Handicap et accessibilité', '/mon-quotidien/handicap-et-accessibilite-580.html'],
    [
      'Plan d’accessibilité voirie et espace public',
      '/la-ville/grand-projet-ville/plan-daccessibilite-voirie-et-espace-public/',
    ],
    ['Sécurité et accessibilité - ERP', '/services/securite-et-accessibilite-erp-293.html'],
    [
      'ADAP : commerce accessible',
      '/services-demarches/commerce-local/adap-mon-commerce-accessible',
    ],
    ['Cours de Pilates accessibles à tous', '/agenda/cours-de-pilates-accessibles-a-tous-2/'],
    ['Voirie aménagée', '/mes-services-publics/handicap-et-accessibilite/voirie-amenagee/'],
    [
      'Site internet adapté',
      '/mes-services-publics/handicap-et-accessibilite/site-internet-adapte/',
    ],
  ])('refuses %s → %s', (text, href) => {
    expect(policyKindsOf({ text, href })).not.toContain('accessibility-statement');
  });
});

describe('policyKindsOf — legal notice', () => {
  it.each([
    ['Mentions légales', '/mentions-legales'],
    ['Mentions Légales', 'https://www.gagny.fr/mentions-legales/'],
    ['Mentions légales – cgu', 'https://ville-saint-priest.fr/mentions-legales-cgu/'],
    ['Mentions légales', '/20/mentions-legales.htm'],
    ['Mentions légales', './mentions_legales.aspx'],
    ['Mentions légales', 'article291.html'],
    ['Mentions légales', '/accueil0/mentions-legales'],
    [
      "Conditions générales d'utilisation",
      '/divers/mentions-legales/conditions-generale-d-utilisations',
    ],
    ['Mentions légales', '/pages-specifiques-et-fonctionnalites/mentions-legales-6.html'],
    // Lunel labels an anchor "Mentions légales" and points it at its privacy
    // policy. Both pages exist and the link says so twice, so it carries both
    // signals — see the pair of assertions below.
    ['Mentions légales', 'https://www.lunel.com/politique-de-confidentialite/'],
  ])('recognises %s → %s', (text, href) => {
    expect(policyKindsOf({ text, href })).toContain('legal-notice');
  });

  it.each([
    ['Affichage légal', '/vie-municipale/affichage-legal'],
    ['Obligations légales', 'https://ville-cayenne.fr/obligations-legales/'],
    [
      'Les Obligations Légales de Débroussaillement',
      '/mes-services/environnement/les-obligations-legales-de-debroussaillement/',
    ],
    [
      'Bac : coup de pouce pour les mentions',
      'https://www.ville-thiais.fr/bac-coup-de-pouce-pour-les-mentions/',
    ],
    [
      'Vidéoprotection',
      '/demarches-et-services/securite-et-prevention/mentions-dinformation-sur-la-videoprotection/',
    ],
    ['Légalisation de signature', '/demarches/legalisation-de-signature'],
    ['Actes administratifs', 'https://www.marquettelezlille.fr/ma-ville/annonces-legales/'],
  ])('refuses %s → %s', (text, href) => {
    expect(policyKindsOf({ text, href })).not.toContain('legal-notice');
  });
});

describe('policyKindsOf — privacy policy', () => {
  it.each([
    ['Politique de confidentialité', '/politique-confidentialite'],
    [
      'Politique de protection des données personnelles',
      'http://www.corbeil-essonnes.fr/politique-de-protection-des-donnees-personnelles/',
    ],
    ['Politique Vie Privée', '/vie-privee'],
    ['Données personnelles &amp; cookies', '/donnees-personnelles-cookies'],
    ['Données personnelles', 'article290.html'],
    ['Politique de gestion des données', '/politique-de-gestion-des-donnees-personnelles-291.html'],
    ['Confidentialité', 'https://www.fortdefrance.fr/confidentialite/'],
    ['Protection des données personnelles', '/protection-des-donnees-personnelles'],
    [
      'Politiques de confidentialité',
      'https://www.tremblay-en-france.fr/18/politiques-de-confidentialite.htm',
    ],
    [
      'En continuant, vous acceptez la politique de confidentialité',
      'https://www.ville-thiais.fr/politique-de-confidentialite/',
    ],
  ])('recognises %s → %s', (text, href) => {
    expect(policyKindsOf({ text, href })).toContain('privacy-policy');
  });

  it.each([
    // A cookie banner is not a privacy policy: 21 of the 41 pages carry one,
    // and counting them would publish a signal that measures a plugin.
    ['Cookies', 'https://www.oyonnax.fr/cookies/'],
    ['Politique de cookies (UE)', '/politique-de-cookies-ue'],
    ['Gestion des cookies', '/17/gestion-des-cookies.htm'],
    ['Politique Cookies', '/fr/cookies'],
    // An opt-out form, not the policy it applies.
    ['Retrait des données personnelles', '/retrait-des-donnees-personnelles'],
  ])('refuses %s → %s', (text, href) => {
    expect(policyKindsOf({ text, href })).not.toContain('privacy-policy');
  });
});

describe('policyKindsOf — a link that carries two signals', () => {
  it('reads the label and the path as two pieces of evidence, not as a fallback', () => {
    expect(
      policyKindsOf({
        text: 'Mentions légales',
        href: 'https://www.lunel.com/politique-de-confidentialite/',
      }),
    ).toEqual(['legal-notice', 'privacy-policy']);
  });
});

describe('policyKindsOf — neither', () => {
  it.each([
    ['Accueil', '/'],
    ['Agenda', '/agenda/'],
    ['', '#'],
    ['Contact', '/contact'],
  ])('reports nothing for %s', (text, href) => {
    expect(policyKindsOf({ text, href })).toEqual([]);
  });
});

describe('resolveLinkUrl', () => {
  const base = 'https://www.ville-exemple.fr/';

  it.each([
    ['/accessibilite', 'https://www.ville-exemple.fr/accessibilite'],
    ['./accessibilite.aspx', 'https://www.ville-exemple.fr/accessibilite.aspx'],
    ['article292.html', 'https://www.ville-exemple.fr/article292.html'],
    ['https://autre.fr/accessibilite', 'https://autre.fr/accessibilite'],
    // The directory hands out http URLs, and so do some footers (§7 keeps the
    // fallback explicit for what we *fetch*; recording one is not fetching it).
    ['http://www.ville-exemple.fr/a', 'http://www.ville-exemple.fr/a'],
  ])('resolves %s against the page it was read on', (href, expected) => {
    expect(resolveLinkUrl(href, base)).toBe(expected);
  });

  it.each([
    ['#'],
    ['#nova-cookies'],
    ['javascript:tarteaucitron.userInterface.openPanel();'],
    ['mailto:mairie@ville-exemple.fr'],
    ['tel:+33100000000'],
    ['   '],
    ['http://['],
  ])('refuses %s, which leads to no page', (href) => {
    expect(resolveLinkUrl(href, base)).toBeNull();
  });
});

describe('findPolicyLinks', () => {
  const base = 'https://www.ville-exemple.fr/';

  it('returns the three signals of a complete footer', () => {
    const links = [
      { text: 'Accueil', href: '/' },
      { text: 'Accessibilité : non conforme', href: '/accessibilite' },
      { text: 'Mentions légales', href: '/mentions-legales' },
      { text: 'Politique de confidentialité', href: '/politique-de-confidentialite' },
    ];

    expect(findPolicyLinks(links, base)).toEqual({
      accessibilityStatement: 'https://www.ville-exemple.fr/accessibilite',
      legalNotice: 'https://www.ville-exemple.fr/mentions-legales',
      privacyPolicy: 'https://www.ville-exemple.fr/politique-de-confidentialite',
    });
  });

  it('reports null for a signal the page does not carry', () => {
    expect(findPolicyLinks([{ text: 'Accueil', href: '/' }], base)).toEqual({
      accessibilityStatement: null,
      legalNotice: null,
      privacyPolicy: null,
    });
  });

  it('does not count a label whose link leads nowhere', () => {
    // Two of the 41 pages label an anchor "Accessibilité" and point it at `#`,
    // where a cookie panel opens. There is no statement to read, so there is
    // nothing to publish: a measurement says what it saw.
    const found = findPolicyLinks([{ text: 'Accessibilité', href: '#' }], base);

    expect(found.accessibilityStatement).toBeNull();
  });

  it('keeps a labelled link whose path says nothing at all', () => {
    // A footer that names its legal notice and points it at the home page is
    // broken, but it still names it. The label is the evidence here, so the
    // signal is present and the URL is the one the link gives.
    expect(findPolicyLinks([{ text: 'Mentions légales', href: '/' }], base).legalNotice).toBe(
      'https://www.ville-exemple.fr/',
    );
  });

  it('prefers the candidate whose own path says what the page is', () => {
    const links = [
      { text: 'Déclaration d’accessibilité', href: '/systeme/accessibilite/page-2' },
      { text: 'Accessibilité', href: '/accessibilite' },
    ];

    expect(findPolicyLinks(links, base).accessibilityStatement).toBe(
      'https://www.ville-exemple.fr/accessibilite',
    );
  });

  it('keeps the first candidate when none is better placed than another', () => {
    const links = [
      { text: 'Accessibilité', href: '/accessibilite' },
      { text: 'Déclaration d’accessibilité', href: '/declaration-daccessibilite' },
    ];

    expect(findPolicyLinks(links, base).accessibilityStatement).toBe(
      'https://www.ville-exemple.fr/accessibilite',
    );
  });
});
