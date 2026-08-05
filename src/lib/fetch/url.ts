import { classifyAddress, type AddressVerdict } from './address.js';

/**
 * URL-level half of the SSRF guard (CLAUDE.md §7). Pure: no DNS, no network.
 *
 * Everything decidable from the URL alone is decided here, before any packet
 * moves. What is left — does this hostname resolve to something internal — is
 * the client's job, because only it can ask a resolver.
 */

export type UrlRejectionReason =
  | 'malformed'
  | 'forbidden-scheme'
  | 'embedded-credentials'
  | 'reserved-hostname'
  | 'blocked-address';

export interface UrlCheck {
  readonly ok: boolean;
  readonly url?: URL;
  readonly reason?: UrlRejectionReason;
  readonly detail?: string;
  /** Present when the host was an IP literal and could be judged immediately. */
  readonly address?: AddressVerdict;
}

export interface CheckUrlOptions {
  /**
   * §7 allows http only as an explicit, logged fallback. It is off by default
   * so that reaching for it is a decision someone wrote down.
   */
  readonly allowHttp?: boolean;
}

/**
 * Hostnames reserved by RFC 6761/8375 or by convention for private networks.
 * None of them resolve publicly, so refusing them before DNS costs nothing and
 * removes a class of failures that only ever show up in production.
 */
const RESERVED_SUFFIXES = ['localhost', 'local', 'internal', 'home.arpa', 'localdomain'];

function hasReservedSuffix(hostname: string): boolean {
  const lower = hostname.toLowerCase().replace(/\.$/, '');

  return RESERVED_SUFFIXES.some((suffix) => lower === suffix || lower.endsWith(`.${suffix}`));
}

/** Strips the brackets the URL parser puts around an IPv6 host. */
function unwrapHost(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

export function checkUrl(raw: string, options: CheckUrlOptions = {}): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Deliberately no echo of `raw` in the detail: a malformed URL is exactly
    // the kind of string that turns out to hold a token.
    return { ok: false, reason: 'malformed', detail: 'URL could not be parsed' };
  }

  const allowed = options.allowHttp === true ? ['https:', 'http:'] : ['https:'];
  if (!allowed.includes(url.protocol)) {
    return {
      ok: false,
      reason: 'forbidden-scheme',
      detail: `scheme ${url.protocol} is not allowed`,
    };
  }

  // Refused, not stripped. Stripping would silently send a different request
  // from the one that was asked for.
  if (url.username !== '' || url.password !== '') {
    return {
      ok: false,
      reason: 'embedded-credentials',
      detail: 'URL carries userinfo',
    };
  }

  // No empty-host check: for the special schemes http and https the WHATWG
  // parser treats a missing host as a parse failure, so `new URL` has already
  // rejected it above. A branch that cannot be reached cannot be tested, and
  // an untested branch in a security guard is false assurance, not defence.

  if (hasReservedSuffix(url.hostname)) {
    return {
      ok: false,
      reason: 'reserved-hostname',
      detail: `hostname ${url.hostname} is reserved for private use`,
    };
  }

  // The WHATWG parser normalises 2130706433 and 0x7f000001 into 127.0.0.1
  // before we ever see them, which is why the guard can trust `hostname`.
  const host = unwrapHost(url.hostname);
  const parsedAsAddress = classifyAddress(host);

  if (parsedAsAddress.category !== 'invalid') {
    return parsedAsAddress.allowed
      ? { ok: true, url, address: parsedAsAddress }
      : {
          ok: false,
          reason: 'blocked-address',
          detail: `address ${parsedAsAddress.effectiveAddress} is ${parsedAsAddress.category}`,
          address: parsedAsAddress,
        };
  }

  return { ok: true, url };
}
