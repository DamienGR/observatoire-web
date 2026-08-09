import { describe, expect, it } from 'vitest';
import { planAttempt, rankCandidates } from './attempt.js';

/**
 * Written before `attempt.ts`. Almost every case below is a URL the directory
 * really carries: the counts in the comments were measured on the frozen
 * capture by J1-07 and J1-14, not imagined here.
 */

describe('planAttempt', () => {
  it('plans an ordinary https candidate', () => {
    expect(planAttempt('https://www.curgy.fr/')).toEqual({
      kind: 'attempt',
      url: 'https://www.curgy.fr/',
      insecure: false,
    });
  });

  it('plans the canonical form of the URL, which is what will be fetched', () => {
    // `new URL` normalises the empty path to `/` and lowercases the host. The
    // plan says what the client will actually request, so that the audit trail
    // and the observation talk about the same string.
    expect(planAttempt('https://SAINT-MALO.fr')).toEqual({
      kind: 'attempt',
      url: 'https://saint-malo.fr/',
      insecure: false,
    });
  });

  it('plans an http candidate, flagged as insecure', () => {
    // 154 of the 1 224 candidates of the perimeter are http. §7 allows http
    // only as an explicit, logged fallback: the flag is what forces the caller
    // to opt in and to log it, instead of the guard silently accepting it.
    expect(planAttempt('http://www.baignes-sainte-radegonde.fr')).toEqual({
      kind: 'attempt',
      url: 'http://www.baignes-sainte-radegonde.fr/',
      insecure: true,
    });
  });

  it('plans a deep link as given, without trimming it down to its host', () => {
    // Trimming would fabricate a URL the directory never gave. Which of the two
    // to try first is a question of order (rankCandidates), not of rewriting.
    expect(planAttempt('https://www.conlie.fr/vie-pratique/mes-demarches/rdv-en-ligne/')).toEqual({
      kind: 'attempt',
      url: 'https://www.conlie.fr/vie-pratique/mes-demarches/rdv-en-ligne/',
      insecure: false,
    });
  });

  it('sends a value with no scheme to review rather than repairing it', () => {
    // `www.bajus.fr`, five records in this case. Prefixing `https://` would
    // invent a URL nobody published — and the repaired value would be stored as
    // coming from the directory, which it does not. A repaired candidate is a
    // `heuristique` row somebody decides to create, so this stops at the queue.
    expect(planAttempt('www.bajus.fr')).toEqual({
      kind: 'reject',
      statut: 'a_revoir',
      reason: 'missing-scheme',
    });
  });

  it('rejects a value that is not a URL at all', () => {
    expect(planAttempt('a definir')).toEqual({
      kind: 'reject',
      statut: 'invalide',
      reason: 'malformed-url',
    });
  });

  it('rejects a scheme-less value that could only be repaired into a host name', () => {
    // No dot, so the repair would produce `https://neant` — a hostname that
    // cannot exist publicly. Reviewing it would waste a human's time.
    expect(planAttempt('neant')).toEqual({
      kind: 'reject',
      statut: 'invalide',
      reason: 'malformed-url',
    });
  });

  it('rejects a scheme that is not http or https', () => {
    expect(planAttempt('mailto:mairie@example.fr')).toEqual({
      kind: 'reject',
      statut: 'invalide',
      reason: 'forbidden-scheme',
    });
    expect(planAttempt('ftp://example.fr/')).toEqual({
      kind: 'reject',
      statut: 'invalide',
      reason: 'forbidden-scheme',
    });
  });

  it('rejects a URL carrying credentials instead of stripping them', () => {
    expect(planAttempt('https://user:secret@example.fr/')).toEqual({
      kind: 'reject',
      statut: 'invalide',
      reason: 'embedded-credentials',
    });
  });

  it('rejects a URL pointing inside the network that runs the scan', () => {
    // The SSRF guard (§7) is the authority; this module only turns its verdict
    // into a state. `invalide`, never `a_revoir`: an operator has nothing to
    // arbitrate about a commune whose website is said to be 127.0.0.1.
    for (const url of [
      'https://localhost/',
      'https://127.0.0.1/',
      'https://169.254.169.254/latest/meta-data/',
      'https://intranet.internal/',
    ]) {
      expect(planAttempt(url)).toEqual({
        kind: 'reject',
        statut: 'invalide',
        reason: 'blocked-address',
      });
    }
  });

  it('judges the repaired form of a scheme-less value before offering it for review', () => {
    // `192.168.1.10` would parse as a hostname with dots and look repairable.
    // Sending it to a human as "a URL missing its scheme" would put a private
    // address in the review queue, one operator click away from being fetched.
    expect(planAttempt('192.168.1.10')).toEqual({
      kind: 'reject',
      statut: 'invalide',
      reason: 'blocked-address',
    });
  });
});

describe('rankCandidates', () => {
  it('tries the homepage before a deep link into the same site', () => {
    // The measured case: 138 communes carry several candidates, and the extra
    // one is very often a "mes démarches" page. We measure homepages.
    expect(
      rankCandidates([
        'https://www.conlie.fr/vie-pratique/mes-demarches/rdv-en-ligne/',
        'https://www.conlie.fr/',
      ]),
    ).toEqual([
      'https://www.conlie.fr/',
      'https://www.conlie.fr/vie-pratique/mes-demarches/rdv-en-ligne/',
    ]);
  });

  it('keeps the order the directory gave between equally good candidates', () => {
    // Saint-Malo's three. Nothing distinguishes them but the order of the
    // source, and the first value of the first record is the one the directory
    // presents as *the* website.
    expect(
      rankCandidates([
        'https://www.ville-saint-malo.fr',
        'https://saint-malo.fr',
        'https://www.saint-malo.fr',
      ]),
    ).toEqual([
      'https://www.ville-saint-malo.fr',
      'https://saint-malo.fr',
      'https://www.saint-malo.fr',
    ]);
  });

  it('prefers https to http at equal depth', () => {
    expect(rankCandidates(['http://example.fr/', 'https://example.fr/'])).toEqual([
      'https://example.fr/',
      'http://example.fr/',
    ]);
  });

  it('prefers a bare homepage to one carrying a query string', () => {
    expect(
      rankCandidates(['https://example.fr/?utm_source=annuaire', 'https://example.fr/']),
    ).toEqual(['https://example.fr/', 'https://example.fr/?utm_source=annuaire']);
  });

  it('puts a candidate nothing can fetch last', () => {
    expect(rankCandidates(['www.bajus.fr', 'https://www.bajus.fr/'])).toEqual([
      'https://www.bajus.fr/',
      'www.bajus.fr',
    ]);
  });

  it('returns the candidates it was given, unchanged and unmoved', () => {
    // The ranking decides an order of attempts; it never rewrites a URL — the
    // string that gets stored is the directory's, canonicalisation happens in
    // the plan.
    const candidates = ['https://b.fr/page', 'https://a.fr/'];
    const ranked = rankCandidates(candidates);

    expect(candidates).toEqual(['https://b.fr/page', 'https://a.fr/']);
    expect(ranked.toSorted()).toEqual(candidates.toSorted());
  });
});
