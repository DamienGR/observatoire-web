import { describe, expect, it } from 'vitest';
import {
  assertNoPublicPrefixedSecrets,
  EnvValidationError,
  MissingEnvError,
  parseEnv,
  publicEnvSchema,
  requireEnv,
  serverEnvSchema,
} from './index.js';

describe('parseEnv', () => {
  it('accepts an entirely empty environment', () => {
    expect(parseEnv({})).toEqual({});
  });

  it('keeps declared variables and drops undeclared ones', () => {
    const env = parseEnv({
      SITE_URL: 'https://observatoire-web.fr',
      PSI_API_KEY: 'abc',
      SOMETHING_ELSE: 'ignored',
    });

    expect(env).toEqual({
      SITE_URL: 'https://observatoire-web.fr',
      PSI_API_KEY: 'abc',
    });
  });

  it('treats an empty or whitespace-only value as absent', () => {
    // Netlify and GitHub Actions both surface an unset variable as "".
    const env = parseEnv({ PSI_API_KEY: '', OPS_TOKEN: '   ', NEON_API_KEY: undefined });

    expect(env.PSI_API_KEY).toBeUndefined();
    expect(env.OPS_TOKEN).toBeUndefined();
    expect(env.NEON_API_KEY).toBeUndefined();
  });

  it('trims surrounding whitespace, a routine copy-paste artefact', () => {
    expect(parseEnv({ OPS_TOKEN: '  t0ken \n' }).OPS_TOKEN).toBe('t0ken');
  });

  it('rejects a malformed URL and names the offending variable', () => {
    expect(() => parseEnv({ SITE_URL: 'observatoire-web.fr' })).toThrow(EnvValidationError);
    expect(() => parseEnv({ SITE_URL: 'observatoire-web.fr' })).toThrow(/SITE_URL/);
  });

  it('reports every invalid variable at once, not just the first', () => {
    try {
      parseEnv({ SITE_URL: 'nope', SENTRY_DSN: 'also-nope' });
      expect.unreachable('parseEnv should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as EnvValidationError).issues).toHaveLength(2);
    }
  });

  it('never leaks a value into the error message', () => {
    // CLAUDE.md §7: never log a secret, not even to explain why it is invalid.
    const secret = 's3cret-token-value';
    try {
      parseEnv({ SENTRY_DSN: secret });
      expect.unreachable('parseEnv should have thrown');
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
    }
  });
});

describe('requireEnv', () => {
  it('returns the value when the variable is set', () => {
    const env = parseEnv({ DATABASE_URL: 'postgres://user@host/db' });
    expect(requireEnv(env, 'DATABASE_URL')).toBe('postgres://user@host/db');
  });

  it('throws a named error when the variable is absent', () => {
    expect(() => requireEnv(parseEnv({}), 'DATABASE_URL')).toThrow(MissingEnvError);
    expect(() => requireEnv(parseEnv({}), 'DATABASE_URL')).toThrow(/DATABASE_URL/);
  });

  it('carries the key on the error so a caller can react to it', () => {
    try {
      requireEnv(parseEnv({}), 'OPS_TOKEN');
      expect.unreachable('requireEnv should have thrown');
    } catch (error) {
      expect((error as MissingEnvError).key).toBe('OPS_TOKEN');
    }
  });
});

describe('PUBLIC_ prefix discipline', () => {
  it('keeps every server-only variable out of the client bundle', () => {
    expect(() => {
      assertNoPublicPrefixedSecrets();
    }).not.toThrow();
  });

  it('fails, naming the offender, if a secret ever gains the PUBLIC_ prefix', () => {
    expect(() => {
      assertNoPublicPrefixedSecrets(['DATABASE_URL', 'PUBLIC_OPS_TOKEN']);
    }).toThrow(/PUBLIC_OPS_TOKEN/);
  });

  it('declares public variables with the PUBLIC_ prefix', () => {
    for (const key of Object.keys(publicEnvSchema.shape)) {
      expect(key).toMatch(/^PUBLIC_/);
    }
  });

  it('declares no variable in both schemas', () => {
    const publicKeys = Object.keys(publicEnvSchema.shape);
    const serverKeys = Object.keys(serverEnvSchema.shape);

    expect(publicKeys.filter((key) => serverKeys.includes(key))).toEqual([]);
  });
});
