import { classifyAddress, type AddressCategory } from './address.js';
import {
  ResponseTooLargeError,
  SsrfBlockedError,
  TimeoutError,
  TooManyRedirectsError,
  UnsafeUrlError,
} from './errors.js';
import { checkUrl } from './url.js';

/**
 * The guarded HTTP client every outbound request to an untrusted URL goes
 * through (CLAUDE.md §7).
 *
 * Transport and DNS arrive by injection. That is a testability decision with a
 * hard constraint behind it: the unit project forbids I/O outright (§5), and
 * this is the one module where "we could not unit test it" would be an
 * unacceptable answer. The default wiring lives in `index.ts`.
 */

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface GuardedFetchDeps {
  /** Resolves a hostname to its A and AAAA records. */
  readonly resolve: (hostname: string) => Promise<readonly string[]>;
  readonly fetch: FetchLike;
  /** Injected so the deadline can be exercised without real timers. */
  readonly now?: () => number;
}

export type AuditEvent =
  | { readonly type: 'request'; readonly url: string; readonly hop: number }
  | { readonly type: 'redirect'; readonly from: string; readonly to: string }
  | { readonly type: 'insecure-scheme'; readonly url: string }
  | {
      readonly type: 'blocked';
      readonly url: string;
      readonly category: AddressCategory;
      readonly effectiveAddress: string;
    };

export interface GuardedFetchOptions {
  readonly maxRedirects?: number;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly allowHttp?: boolean;
  readonly headers?: Readonly<Record<string, string>>;
  readonly userAgent?: string;
  /** §7 asks for the http fallback to be logged; this is how it surfaces. */
  readonly onAudit?: (event: AuditEvent) => void;
}

export interface FetchOutcome {
  readonly url: string;
  readonly status: number;
  readonly headers: Headers;
  readonly body: string;
  readonly redirects: readonly string[];
  readonly usedInsecureScheme: boolean;
}

const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 2_000_000;

/**
 * ASCII only, deliberately: an HTTP header value is a ByteString, and a
 * typographic apostrophe throws at request time rather than at review time.
 */
export const DEFAULT_USER_AGENT =
  'observatoire-web/0.1 (automated accessibility measurement; +https://observatoire-web.fr/methodologie)';

/**
 * Never forwarded, and never accepted from a caller either. Silently dropping
 * them would leave a caller believing it had authenticated.
 */
const FORBIDDEN_REQUEST_HEADERS = ['authorization', 'cookie', 'proxy-authorization'];

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function buildHeaders(options: GuardedFetchOptions): Headers {
  const headers = new Headers({
    // We announce ourselves rather than hide (§7).
    'user-agent': options.userAgent ?? DEFAULT_USER_AGENT,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'fr',
  });

  for (const [name, value] of Object.entries(options.headers ?? {})) {
    if (FORBIDDEN_REQUEST_HEADERS.includes(name.toLowerCase())) {
      throw new UnsafeUrlError(`Refusing to send forbidden header ${name}.`, '(request)');
    }
    headers.set(name, value);
  }

  return headers;
}

/** Reads at most `maxBytes`, aborting mid-stream rather than after the fact. */
async function readCappedBody(response: Response, url: string, maxBytes: number): Promise<string> {
  const declared = response.headers.get('content-length');
  if (declared !== null && Number(declared) > maxBytes) {
    // Cheapest possible refusal: no body read at all.
    throw new ResponseTooLargeError(url, maxBytes);
  }

  const stream = response.body;
  if (stream === null) return '';

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      // No undefined check: once `done` is false the reader's result type
      // guarantees a chunk, and a branch TypeScript proves unreachable is a
      // branch no test can cover.
      if (done) break;

      total += value.byteLength;
      if (total > maxBytes) {
        throw new ResponseTooLargeError(url, maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(merged);
}

/** Resolves the hostname and refuses if *any* returned address is blocked. */
async function assertHostReachable(
  url: URL,
  deps: GuardedFetchDeps,
  audit: (event: AuditEvent) => void,
): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, '');

  // An IP literal was already judged by checkUrl; asking a resolver about it
  // would be meaningless.
  if (classifyAddress(host).category !== 'invalid') return;

  const addresses = await deps.resolve(host);

  if (addresses.length === 0) {
    audit({ type: 'blocked', url: url.href, category: 'invalid', effectiveAddress: host });
    throw new SsrfBlockedError(url.href, 'invalid', host);
  }

  // Every address, not just the first: DNS round-robin makes "the first one"
  // a coin toss, and checking one while connecting to another is the bug.
  for (const address of addresses) {
    const verdict = classifyAddress(address);
    if (!verdict.allowed) {
      audit({
        type: 'blocked',
        url: url.href,
        category: verdict.category,
        effectiveAddress: verdict.effectiveAddress,
      });
      throw new SsrfBlockedError(url.href, verdict.category, verdict.effectiveAddress);
    }
  }
}

export async function guardedFetch(
  rawUrl: string,
  deps: GuardedFetchDeps,
  options: GuardedFetchOptions = {},
): Promise<FetchOutcome> {
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const now = deps.now ?? Date.now;
  const audit = options.onAudit ?? ((): void => undefined);

  const headers = buildHeaders(options);
  const deadline = now() + timeoutMs;
  const redirects: string[] = [];

  let current = rawUrl;
  let usedInsecureScheme = false;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const checked = checkUrl(current, { allowHttp: options.allowHttp ?? false });

    if (!checked.ok) {
      if (checked.reason === 'blocked-address' && checked.address !== undefined) {
        audit({
          type: 'blocked',
          url: current,
          category: checked.address.category,
          effectiveAddress: checked.address.effectiveAddress,
        });
        throw new SsrfBlockedError(
          current,
          checked.address.category,
          checked.address.effectiveAddress,
        );
      }
      throw new UnsafeUrlError(checked.detail, current);
    }

    const url = checked.url;

    if (url.protocol === 'http:') {
      usedInsecureScheme = true;
      audit({ type: 'insecure-scheme', url: url.href });
    }

    await assertHostReachable(url, deps, audit);

    const remaining = deadline - now();
    if (remaining <= 0) {
      throw new TimeoutError(url.href, timeoutMs);
    }

    audit({ type: 'request', url: url.href, hop });

    const response = await deps.fetch(url.href, {
      method: 'GET',
      headers,
      // Followed by hand so every hop goes back through the guard above.
      redirect: 'manual',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(remaining),
    });

    const location = response.headers.get('location');

    if (!REDIRECT_STATUSES.has(response.status) || location === null) {
      return {
        url: url.href,
        status: response.status,
        headers: response.headers,
        body: await readCappedBody(response, url.href, maxBytes),
        redirects,
        usedInsecureScheme,
      };
    }

    const next = new URL(location, url).href;
    audit({ type: 'redirect', from: url.href, to: next });
    redirects.push(url.href);
    current = next;
  }

  throw new TooManyRedirectsError([...redirects, current], maxRedirects);
}
