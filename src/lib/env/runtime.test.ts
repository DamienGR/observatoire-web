import { afterEach, describe, expect, it } from 'vitest';
import { EnvValidationError } from './index.js';
import { resetServerEnv, serverEnv } from './runtime.js';

const OPS_TOKEN = process.env.OPS_TOKEN;

afterEach(() => {
  if (OPS_TOKEN === undefined) delete process.env.OPS_TOKEN;
  else process.env.OPS_TOKEN = OPS_TOKEN;
  delete process.env.SENTRY_DSN;
  resetServerEnv();
});

describe('serverEnv', () => {
  it('parses the declared variables of the process environment', () => {
    process.env.OPS_TOKEN = 'from-the-process';
    resetServerEnv();

    expect(serverEnv().OPS_TOKEN).toBe('from-the-process');
  });

  it('parses once and reuses the result', () => {
    process.env.OPS_TOKEN = 'first';
    resetServerEnv();
    expect(serverEnv().OPS_TOKEN).toBe('first');

    process.env.OPS_TOKEN = 'second';

    // The middleware calls this on every request: re-parsing each time would
    // pay Zod's cost per request for a value that only changes when the
    // function is recycled.
    expect(serverEnv().OPS_TOKEN).toBe('first');
  });

  it('throws by name on a malformed variable rather than serving with it', () => {
    process.env.SENTRY_DSN = 'not-a-url';
    resetServerEnv();

    expect(() => serverEnv()).toThrow(EnvValidationError);
  });
});
