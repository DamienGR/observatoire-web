import { describe, expect, it } from 'vitest';
import { createDefaultDeps, DEFAULT_USER_AGENT, guardedFetch, SsrfBlockedError } from './index.js';

/**
 * The public surface of the guard. Every other task in the milestone imports
 * from here, so a rename that breaks the barrel should fail a test rather than
 * a build three PRs later.
 */
describe('public surface', () => {
  it('exports the guard, its errors and the user agent', () => {
    expect(typeof guardedFetch).toBe('function');
    expect(SsrfBlockedError.prototype).toBeInstanceOf(Error);
    expect(DEFAULT_USER_AGENT).toContain('observatoire-web');
  });

  it('keeps the user agent to characters an HTTP header can carry', () => {
    // Asserted through the real Headers API rather than a regex: a header value
    // is a ByteString, and the exact rule is the one Headers enforces. A
    // typographic apostrophe here throws at request time, not at review time.
    expect(() => new Headers({ 'user-agent': DEFAULT_USER_AGENT })).not.toThrow();
  });

  it('advertises a contact URL, so a webmaster can find out who we are', () => {
    expect(DEFAULT_USER_AGENT).toMatch(/\+https:\/\/\S+/);
  });
});

describe('createDefaultDeps', () => {
  it('provides a resolver and a transport without touching either', () => {
    // Building the deps must not perform I/O — the unit project's guard would
    // fail this test outright if it did.
    const deps = createDefaultDeps();

    expect(typeof deps.resolve).toBe('function');
    expect(typeof deps.fetch).toBe('function');
  });
});
