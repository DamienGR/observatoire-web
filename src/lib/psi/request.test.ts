import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PSI_CATEGORIES,
  DEFAULT_PSI_STRATEGY,
  InvalidPsiTargetError,
  PSI_ENDPOINT,
  buildPsiRequestUrl,
  redactPsiKey,
} from './request.js';

const KEY = 'AIzaSyExampleKeyNotReal000000000000000000';

describe('buildPsiRequestUrl', () => {
  it('asks the documented endpoint', () => {
    const built = new URL(buildPsiRequestUrl({ url: 'https://ville.fr/', apiKey: KEY }));

    expect(`${built.origin}${built.pathname}`).toBe(PSI_ENDPOINT);
  });

  it('carries the target, the key and the strategy', () => {
    const params = new URL(buildPsiRequestUrl({ url: 'https://ville.fr/', apiKey: KEY })).searchParams;

    expect(params.get('url')).toBe('https://ville.fr/');
    expect(params.get('key')).toBe(KEY);
    expect(params.get('strategy')).toBe(DEFAULT_PSI_STRATEGY);
  });

  it('asks for the four categories the measurement stores, and no other', () => {
    const params = new URL(buildPsiRequestUrl({ url: 'https://ville.fr/', apiKey: KEY })).searchParams;

    expect(params.getAll('category')).toEqual([...DEFAULT_PSI_CATEGORIES]);
  });

  it('repeats `category` rather than joining it, which is how the API reads it', () => {
    const query = buildPsiRequestUrl({ url: 'https://ville.fr/', apiKey: KEY });

    expect(query).toContain('category=performance&category=accessibility');
  });

  it('takes the strategy from the caller', () => {
    const params = new URL(
      buildPsiRequestUrl({ url: 'https://ville.fr/', apiKey: KEY, strategy: 'desktop' }),
    ).searchParams;

    expect(params.get('strategy')).toBe('desktop');
  });

  it('takes a narrower category list from the caller', () => {
    const params = new URL(
      buildPsiRequestUrl({ url: 'https://ville.fr/', apiKey: KEY, categories: ['accessibility'] }),
    ).searchParams;

    expect(params.getAll('category')).toEqual(['accessibility']);
  });

  it('orders its parameters deterministically, so two identical requests are one string', () => {
    const first = buildPsiRequestUrl({ url: 'https://ville.fr/', apiKey: KEY });
    const second = buildPsiRequestUrl({ apiKey: KEY, url: 'https://ville.fr/' });

    expect(first).toBe(second);
  });

  it('encodes a target carrying a query of its own', () => {
    const target = 'https://ville.fr/page?a=1&category=nonsense';
    const params = new URL(buildPsiRequestUrl({ url: target, apiKey: KEY })).searchParams;

    expect(params.get('url')).toBe(target);
    expect(params.getAll('category')).toEqual([...DEFAULT_PSI_CATEGORIES]);
  });

  it.each([
    ['a relative path', '/accueil'],
    ['a scheme-less host', 'ville.fr'],
    ['a file URL', 'file:///etc/passwd'],
    ['a data URL', 'data:text/html,<h1>hi</h1>'],
    ['a javascript URL', 'javascript:alert(1)'],
    ['nothing at all', ''],
  ])('refuses %s as a target', (_case, url) => {
    expect(() => buildPsiRequestUrl({ url, apiKey: KEY })).toThrow(InvalidPsiTargetError);
  });

  it('accepts an http target, which 4 957 directory records still carry', () => {
    const params = new URL(
      buildPsiRequestUrl({ url: 'http://ville.fr/', apiKey: KEY }),
    ).searchParams;

    expect(params.get('url')).toBe('http://ville.fr/');
  });

  it('refuses an empty key rather than sending a request that will 429', () => {
    expect(() => buildPsiRequestUrl({ url: 'https://ville.fr/', apiKey: '' })).toThrow(
      InvalidPsiTargetError,
    );
  });

  it('never names the key in the error it throws about the target', () => {
    let message = '';
    try {
      buildPsiRequestUrl({ url: 'not a url', apiKey: KEY });
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }

    expect(message).not.toContain(KEY);
  });
});

describe('redactPsiKey', () => {
  it('removes the key from a built request URL', () => {
    const redacted = redactPsiKey(buildPsiRequestUrl({ url: 'https://ville.fr/', apiKey: KEY }));

    expect(redacted).not.toContain(KEY);
    expect(redacted).toContain('key=REDACTED');
  });

  it('leaves every other parameter readable, which is the point of logging it', () => {
    const redacted = redactPsiKey(buildPsiRequestUrl({ url: 'https://ville.fr/', apiKey: KEY }));

    expect(redacted).toContain('url=https%3A%2F%2Fville.fr%2F');
    expect(redacted).toContain('strategy=mobile');
  });

  it('is a no-op on a URL that carries no key', () => {
    expect(redactPsiKey('https://www.googleapis.com/x?url=https%3A%2F%2Fville.fr')).toBe(
      'https://www.googleapis.com/x?url=https%3A%2F%2Fville.fr',
    );
  });

  it('redacts a key even when the string is not a parsable URL', () => {
    expect(redactPsiKey(`garbage key=${KEY}&more`)).toBe('garbage key=REDACTED&more');
  });
});
