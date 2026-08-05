import type { AddressCategory } from './address.js';

/** Base class so a caller can catch every refusal of the guard at once. */
export class FetchGuardError extends Error {
  override readonly name: string = 'FetchGuardError';
}

/** The URL itself is unusable: bad scheme, credentials, malformed, reserved. */
export class UnsafeUrlError extends FetchGuardError {
  override readonly name = 'UnsafeUrlError';
  readonly url: string;

  constructor(message: string, url: string) {
    super(message);
    this.url = url;
  }
}

/** The address behind the hostname is one we must never reach (CLAUDE.md §7). */
export class SsrfBlockedError extends FetchGuardError {
  override readonly name = 'SsrfBlockedError';
  readonly url: string;
  readonly category: AddressCategory;
  readonly effectiveAddress: string;

  constructor(url: string, category: AddressCategory, effectiveAddress: string) {
    super(`Refusing to reach ${effectiveAddress} (${category}) for ${url}.`);
    this.url = url;
    this.category = category;
    this.effectiveAddress = effectiveAddress;
  }
}

export class TooManyRedirectsError extends FetchGuardError {
  override readonly name = 'TooManyRedirectsError';
  readonly chain: readonly string[];

  constructor(chain: readonly string[], limit: number) {
    super(`More than ${String(limit)} redirects starting from ${chain[0] ?? '(unknown)'}.`);
    this.chain = chain;
  }
}

export class ResponseTooLargeError extends FetchGuardError {
  override readonly name = 'ResponseTooLargeError';
  readonly url: string;
  readonly maxBytes: number;

  constructor(url: string, maxBytes: number) {
    super(`Response from ${url} exceeds the ${String(maxBytes)} byte cap.`);
    this.url = url;
    this.maxBytes = maxBytes;
  }
}

export class TimeoutError extends FetchGuardError {
  override readonly name = 'TimeoutError';
  readonly url: string;
  readonly timeoutMs: number;

  constructor(url: string, timeoutMs: number) {
    super(`Gave up on ${url} after ${String(timeoutMs)} ms.`);
    this.url = url;
    this.timeoutMs = timeoutMs;
  }
}
