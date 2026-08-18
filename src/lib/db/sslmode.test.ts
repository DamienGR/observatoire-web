import { describe, expect, it } from 'vitest';
import { AMBIGUOUS_SSL_MODES, withVerifiedTls } from './sslmode.js';

/**
 * Written before `sslmode.ts` (CLAUDE.md §5: test-first for pure logic in
 * src/lib/, and this is a security change besides).
 *
 * The defect is in the future and `pg` announces it on every connection:
 *
 *   The SSL modes 'prefer', 'require', and 'verify-ca' are treated as aliases
 *   for 'verify-full'. In the next major version … these modes will adopt
 *   standard libpq semantics, which have weaker security guarantees.
 *
 * Neon writes `sslmode=require` into every connection string it generates.
 * Today `pg` reads that as `verify-full`; under `pg` 9 it will encrypt without
 * verifying the certificate — **and nothing will break**. The connection will
 * work and check less. That is the shape of regression §7 fears most, and it
 * arrives through a version bump nobody would read as a security change
 * (docs/journal.md 022).
 */

describe('withVerifiedTls', () => {
  it('promotes the three modes pg will weaken', () => {
    for (const mode of AMBIGUOUS_SSL_MODES) {
      const promoted = withVerifiedTls(`postgresql://u:p@host.neon.tech/db?sslmode=${mode}`);

      expect(new URL(promoted).searchParams.get('sslmode')).toBe('verify-full');
    }
  });

  it('leaves a connection string that asks for nothing alone', () => {
    // The throwaway Postgres of a session container speaks no TLS at all.
    // Forcing verification there would break every integration run for a
    // reason that has nothing to do with production (docs/journal.md 014).
    const plain = 'postgresql://postgres@127.0.0.1:55432/neondb';

    expect(withVerifiedTls(plain)).toBe(plain);
  });

  it('leaves an explicit `disable` alone', () => {
    // Somebody wrote it on purpose. Silently encrypting is a different bug
    // from silently not verifying, and this module fixes one of them.
    const disabled = 'postgresql://postgres@127.0.0.1:55432/neondb?sslmode=disable';

    expect(withVerifiedTls(disabled)).toBe(disabled);
  });

  it('leaves `verify-full` alone rather than rewriting it to itself', () => {
    const already = 'postgresql://u:p@host.neon.tech/db?sslmode=verify-full';

    expect(withVerifiedTls(already)).toBe(already);
  });

  it('keeps every other parameter, in place', () => {
    const promoted = withVerifiedTls(
      'postgresql://u:p@host.neon.tech/db?sslmode=require&channel_binding=require&application_name=obs',
    );
    const parameters = new URL(promoted).searchParams;

    expect(parameters.get('channel_binding')).toBe('require');
    expect(parameters.get('application_name')).toBe('obs');
  });

  it('preserves a percent-encoded password character for character', () => {
    // The whole value is a credential; a re-encoding that looks harmless is an
    // authentication failure nobody can attribute.
    const encoded = 'postgresql://role:p%40ss%2Fword@host.neon.tech/db?sslmode=require';

    expect(withVerifiedTls(encoded)).toContain('p%40ss%2Fword');
  });

  it('hands back a string it cannot parse, untouched', () => {
    // Failing here would turn a malformed variable into a crash at import,
    // ahead of the connection error that names the real problem. This module
    // is not the one that validates a connection string.
    expect(withVerifiedTls('not a uri')).toBe('not a uri');
  });

  it('never lets the connection string reach an exception', () => {
    expect(() => withVerifiedTls('postgresql://u:secret@h/db?sslmode=require')).not.toThrow();
  });
});
