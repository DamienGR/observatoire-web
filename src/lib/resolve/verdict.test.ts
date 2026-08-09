import { describe, expect, it } from 'vitest';
import { DEFAULT_MAX_ATTEMPTS, isSameHost, judgeObservation, type Observation } from './verdict.js';

/**
 * Written before `verdict.ts`. The table below *is* the specification of what
 * one observation means; the code under it only has to agree.
 */

const REQUESTED = 'https://www.example-commune.fr/';

function response(status: number, finalUrl: string = REQUESTED): Observation {
  return { kind: 'response', requestedUrl: REQUESTED, finalUrl, status };
}

function failure(kind: Extract<Observation, { kind: 'failure' }>['failure']): Observation {
  return { kind: 'failure', requestedUrl: REQUESTED, failure: kind };
}

/** A fresh attempt: nothing has failed yet. */
const FIRST_ATTEMPT = { attempts: 0 };

describe('a response that settles the question', () => {
  it('verifies a site that answers', () => {
    expect(judgeObservation(response(200), FIRST_ATTEMPT)).toEqual({
      decision: 'transition',
      to: 'verifie',
      reason: 'reachable',
      resolvedUrl: REQUESTED,
      movedHost: false,
    });
  });

  it('verifies on any success status, not only 200', () => {
    for (const status of [201, 204, 299]) {
      expect(judgeObservation(response(status), FIRST_ATTEMPT)).toMatchObject({
        to: 'verifie',
        reason: 'reachable',
      });
    }
  });

  it('invalidates a URL the site says does not exist', () => {
    // A 404 on a deep link is a fact about that URL, which is exactly what a
    // `site` row is. The commune's homepage is a different row.
    for (const status of [404, 410]) {
      expect(judgeObservation(response(status), FIRST_ATTEMPT)).toMatchObject({
        to: 'invalide',
        reason: 'not-found',
      });
    }
  });

  it('queues for review a site that refuses us', () => {
    // 401 and 403 usually mean a bot wall, not an absent site. Invalidating
    // would delete a commune from the observatory because its host dislikes
    // crawlers — and we announce ourselves rather than work around it (§7).
    for (const status of [401, 403]) {
      expect(judgeObservation(response(status), FIRST_ATTEMPT)).toMatchObject({
        to: 'a_revoir',
        reason: 'forbidden-by-site',
      });
    }
  });

  it('queues for review a redirect the client could not follow', () => {
    // The guarded client follows redirects itself and only ever returns a 3xx
    // when the response carried no Location header — a broken redirect.
    expect(judgeObservation(response(302), FIRST_ATTEMPT)).toMatchObject({
      to: 'a_revoir',
      reason: 'redirect-without-location',
    });
  });

  it('queues for review any other status rather than guessing', () => {
    for (const status of [100, 400, 405, 418, 451]) {
      expect(judgeObservation(response(status), FIRST_ATTEMPT)).toMatchObject({
        to: 'a_revoir',
        reason: 'unexpected-status',
      });
    }
  });
});

describe('where the response came from', () => {
  it('reports the URL that actually answered', () => {
    expect(
      judgeObservation(response(200, 'https://www.example-commune.fr/accueil'), FIRST_ATTEMPT),
    ).toMatchObject({ resolvedUrl: 'https://www.example-commune.fr/accueil' });
  });

  it('does not call an http to https upgrade a move', () => {
    expect(
      judgeObservation(
        {
          kind: 'response',
          requestedUrl: 'http://example-commune.fr/',
          finalUrl: REQUESTED,
          status: 200,
        },
        FIRST_ATTEMPT,
      ),
    ).toMatchObject({ to: 'verifie', movedHost: false });
  });

  it('flags a site that answered from another host, without judging it', () => {
    // A commune whose site now redirects to its agglomeration is still a
    // measurable site, so this stays `verifie`. The flag is for the operator.
    // No rule is invented here about *when* such a move is suspicious: nothing
    // on the path of a pull request may fetch anything (§5), so the frequency
    // of the case is unmeasured, and a threshold picked without a measurement
    // is exactly what this project refuses to write.
    expect(
      judgeObservation(response(200, 'https://www.agglo-voisine.fr/commune'), FIRST_ATTEMPT),
    ).toMatchObject({ to: 'verifie', movedHost: true });
  });

  it('reports where a failing redirect chain landed too', () => {
    expect(
      judgeObservation(response(404, 'https://www.example-commune.fr/introuvable'), FIRST_ATTEMPT),
    ).toMatchObject({ resolvedUrl: 'https://www.example-commune.fr/introuvable' });
  });
});

describe('a failure of the transport', () => {
  it('invalidates a URL the SSRF guard refused', () => {
    // Definitive, and worth a state of its own in the record: a directory URL
    // that resolves inside the network is not something to retry.
    expect(judgeObservation(failure('ssrf-blocked'), FIRST_ATTEMPT)).toMatchObject({
      to: 'invalide',
      reason: 'blocked-address',
      resolvedUrl: null,
    });
  });

  it('invalidates a URL the guard refused to request at all', () => {
    expect(judgeObservation(failure('unsafe-url'), FIRST_ATTEMPT)).toMatchObject({
      to: 'invalide',
      reason: 'unsafe-url',
    });
  });

  it('queues for review a redirect loop', () => {
    expect(judgeObservation(failure('too-many-redirects'), FIRST_ATTEMPT)).toMatchObject({
      to: 'a_revoir',
      reason: 'redirect-loop',
    });
  });

  it('queues for review a response too large to read', () => {
    expect(judgeObservation(failure('response-too-large'), FIRST_ATTEMPT)).toMatchObject({
      to: 'a_revoir',
      reason: 'response-too-large',
    });
  });

  it('retries what is plausibly transient', () => {
    expect(judgeObservation(failure('timeout'), FIRST_ATTEMPT)).toEqual({
      decision: 'retry',
      reason: 'timeout',
    });
    expect(judgeObservation(failure('network'), FIRST_ATTEMPT)).toEqual({
      decision: 'retry',
      reason: 'network-error',
    });
    expect(judgeObservation(response(503), FIRST_ATTEMPT)).toEqual({
      decision: 'retry',
      reason: 'server-error',
    });
    expect(judgeObservation(response(429), FIRST_ATTEMPT)).toEqual({
      decision: 'retry',
      reason: 'rate-limited',
    });
  });
});

describe('when retrying stops being reasonable', () => {
  it('keeps retrying while attempts remain', () => {
    expect(judgeObservation(response(500), { attempts: DEFAULT_MAX_ATTEMPTS - 1 })).toMatchObject({
      decision: 'retry',
    });
  });

  it('sends a URL that never answered to review rather than looping', () => {
    // Not `invalide`: a site that timed out three times may be down for a week,
    // and nothing observed says it does not exist. `a_revoir` is what stops the
    // scan from burning its quota on it every run without deciding anything.
    expect(judgeObservation(response(500), { attempts: DEFAULT_MAX_ATTEMPTS })).toEqual({
      decision: 'transition',
      to: 'a_revoir',
      reason: 'attempts-exhausted',
      resolvedUrl: REQUESTED,
      movedHost: false,
    });
  });

  it('honours a stricter policy from the caller', () => {
    expect(judgeObservation(failure('timeout'), { attempts: 1, maxAttempts: 1 })).toMatchObject({
      to: 'a_revoir',
      reason: 'attempts-exhausted',
    });
  });

  it('never turns a settled verdict into a retry, however many attempts were spent', () => {
    expect(judgeObservation(response(404), { attempts: DEFAULT_MAX_ATTEMPTS + 10 })).toMatchObject({
      to: 'invalide',
      reason: 'not-found',
    });
  });
});

describe('isSameHost', () => {
  it('ignores a www prefix on either side', () => {
    expect(isSameHost('https://x.fr/a', 'https://www.x.fr/b')).toBe(true);
    expect(isSameHost('https://www.x.fr/a', 'https://x.fr/b')).toBe(true);
  });

  it('ignores the scheme, the port and the case of the host', () => {
    expect(isSameHost('http://X.fr/', 'https://x.fr:443/')).toBe(true);
  });

  it('treats another subdomain as another host', () => {
    // Deliberately not a public-suffix comparison: `mairie.x.fr` and `x.fr` may
    // well be the same organisation, but saying so needs a rule about who
    // publishes what, and this module only knows strings.
    expect(isSameHost('https://mairie.x.fr/', 'https://x.fr/')).toBe(false);
  });

  it('says nothing rather than something wrong about an unparseable URL', () => {
    expect(isSameHost('www.x.fr', 'https://www.x.fr/')).toBe(false);
  });
});
