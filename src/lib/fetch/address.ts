/**
 * IP address classification for the SSRF guard (CLAUDE.md §7).
 *
 * Pure, no DNS and no network. The caller resolves a hostname and brings the
 * resulting addresses here; this module only answers "may we send a request to
 * this address?".
 *
 * Two design rules carry the weight:
 *
 *  1. **Decode first, judge second.** An address is normalised to a number, any
 *     IPv4 embedded in an IPv6 form is extracted, and only then is a range
 *     matched. Judging the written form instead would let
 *     `::ffff:169.254.169.254` sail past a check that rejects
 *     `169.254.169.254` — the classic bypass, not an exotic one.
 *
 *  2. **Addresses are integers, not byte arrays.** Matching a prefix by walking
 *     bytes means indexing, and indexing under `noUncheckedIndexedAccess`
 *     means either a non-null assertion or a branch that can never be taken —
 *     and an untestable branch in a security guard is false assurance. Working
 *     on a bigint removes the choice, and lets the ranges below be written in
 *     the CIDR notation the RFCs use, parsed by the same parser the guard uses.
 */

export type AddressCategory =
  | 'public'
  | 'invalid'
  | 'unspecified'
  | 'loopback'
  | 'private'
  | 'carrier-grade-nat'
  | 'link-local'
  | 'cloud-metadata'
  | 'unique-local'
  | 'multicast'
  | 'broadcast'
  | 'documentation'
  | 'benchmarking'
  | 'reserved';

/** How an IPv4 address was carried inside an IPv6 one, when it was. */
export type AddressEmbedding = 'ipv4-mapped' | 'nat64' | '6to4';

export interface ParsedIpAddress {
  readonly version: 4 | 6;
  /** 4 bytes for IPv4, 16 for IPv6. */
  readonly bytes: readonly number[];
}

export interface AddressVerdict {
  readonly allowed: boolean;
  readonly category: AddressCategory;
  /**
   * The address the request would actually reach. Differs from the input when
   * an IPv6 form carried an IPv4 address. Logging this rather than the written
   * form is what makes a rejection diagnosable.
   */
  readonly effectiveAddress: string;
  readonly embedding?: AddressEmbedding;
}

const IPV4_BITS = 32;
const IPV6_BITS = 128;

/* -------------------------------------------------------------------------- */
/* Parsing                                                                     */
/* -------------------------------------------------------------------------- */

/** Parses dotted-quad IPv4 into a 32-bit value. Null when malformed. */
function parseIpv4(input: string): bigint | null {
  const parts = input.split('.');
  if (parts.length !== 4) return null;

  let value = 0n;
  for (const part of parts) {
    // Empty, non-digit and leading-zero forms are all refused. A leading zero
    // is read as octal by some resolvers and as decimal by others, and a value
    // two parsers disagree about is a value we refuse to reason about.
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;

    const byte = Number(part);
    if (byte > 255) return null;
    value = (value << 8n) | BigInt(byte);
  }
  return value;
}

/** Parses any IPv6 form, including `::` and a trailing dotted quad. */
function parseIpv6(input: string): bigint | null {
  if (input.includes('.')) {
    // Rewrite the trailing dotted quad as two hextets, then parse normally.
    const lastColon = input.lastIndexOf(':');
    if (lastColon === -1) return null;

    const quad = parseIpv4(input.slice(lastColon + 1));
    if (quad === null) return null;

    const high = (quad >> 16n) & 0xffffn;
    const low = quad & 0xffffn;
    return parseIpv6(`${input.slice(0, lastColon + 1)}${high.toString(16)}:${low.toString(16)}`);
  }

  const doubleColons = input.split('::').length - 1;
  if (doubleColons > 1) return null;

  const [headText = '', tailText = ''] =
    doubleColons === 1 ? input.split('::') : ([input, ''] as const);

  const toHextets = (text: string): bigint[] | null => {
    if (text === '') return [];

    const values: bigint[] = [];
    for (const group of text.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
      values.push(BigInt(Number.parseInt(group, 16)));
    }
    return values;
  };

  const head = toHextets(headText);
  const tail = toHextets(tailText);
  if (head === null || tail === null) return null;

  const present = head.length + tail.length;
  if (doubleColons === 1 ? present > 7 : present !== 8) return null;

  const zeros = new Array<bigint>(8 - present).fill(0n);

  let value = 0n;
  for (const hextet of [...head, ...zeros, ...tail]) {
    value = (value << 16n) | hextet;
  }
  return value;
}

function toBytes(value: bigint, count: number): number[] {
  const bytes: number[] = [];
  for (let shift = (count - 1) * 8; shift >= 0; shift -= 8) {
    bytes.push(Number((value >> BigInt(shift)) & 0xffn));
  }
  return bytes;
}

/** Parses an IPv4 or IPv6 literal into bytes. Returns null when malformed. */
export function parseIpAddress(input: string): ParsedIpAddress | null {
  if (input === '') return null;

  if (input.includes(':')) {
    const value = parseIpv6(input);
    return value === null ? null : { version: 6, bytes: toBytes(value, 16) };
  }

  const value = parseIpv4(input);
  return value === null ? null : { version: 4, bytes: toBytes(value, 4) };
}

/* -------------------------------------------------------------------------- */
/* Ranges                                                                      */
/* -------------------------------------------------------------------------- */

interface Range {
  readonly category: AddressCategory;
  readonly prefix: bigint;
  readonly shift: bigint;
}

/**
 * Ranges are declared in CIDR notation and parsed at module load by the same
 * parser the guard uses. A typo therefore throws on import rather than
 * silently widening what we are willing to reach.
 *
 * Ordered most specific first: 169.254.169.254/32 must win over
 * 169.254.0.0/16, otherwise cloud metadata is reported as ordinary link-local
 * and the log line loses the only detail worth having.
 */
function toRanges(
  totalBits: number,
  parse: (input: string) => bigint | null,
  entries: readonly (readonly [cidr: string, category: AddressCategory])[],
): readonly Range[] {
  return entries.map(([cidr, category]) => {
    const [network = '', prefixLength = ''] = cidr.split('/');
    const base = parse(network);
    const bits = Number(prefixLength);

    if (base === null || !Number.isInteger(bits) || bits < 0 || bits > totalBits) {
      throw new Error(`Malformed CIDR range in the SSRF guard: ${cidr}`);
    }

    const shift = BigInt(totalBits - bits);
    return { category, prefix: base >> shift, shift };
  });
}

const IPV4_RANGES = toRanges(IPV4_BITS, parseIpv4, [
  ['169.254.169.254/32', 'cloud-metadata'], // AWS, GCP, Azure, DigitalOcean
  ['255.255.255.255/32', 'broadcast'],
  ['0.0.0.0/8', 'unspecified'],
  ['10.0.0.0/8', 'private'],
  ['100.64.0.0/10', 'carrier-grade-nat'], // Alibaba metadata lives here
  ['127.0.0.0/8', 'loopback'],
  ['169.254.0.0/16', 'link-local'],
  ['172.16.0.0/12', 'private'],
  ['192.0.0.0/24', 'reserved'],
  ['192.0.2.0/24', 'documentation'],
  ['192.88.99.0/24', 'reserved'],
  ['192.168.0.0/16', 'private'],
  ['198.18.0.0/15', 'benchmarking'],
  ['198.51.100.0/24', 'documentation'],
  ['203.0.113.0/24', 'documentation'],
  ['224.0.0.0/4', 'multicast'],
  ['240.0.0.0/4', 'reserved'],
]);

const IPV6_RANGES = toRanges(IPV6_BITS, parseIpv6, [
  ['::/128', 'unspecified'],
  ['::1/128', 'loopback'],
  ['100::/64', 'reserved'],
  ['2001:db8::/32', 'documentation'],
  ['fc00::/7', 'unique-local'],
  ['fe80::/10', 'link-local'],
  ['ff00::/8', 'multicast'],
]);

/** Prefixes that carry an IPv4 address inside an IPv6 one. */
const EMBEDDINGS: readonly (readonly [
  cidr: string,
  embedding: AddressEmbedding,
  extractShift: bigint,
])[] = [
  ['::ffff:0:0/96', 'ipv4-mapped', 0n],
  ['64:ff9b::/96', 'nat64', 0n],
  ['2002::/16', '6to4', 80n], // 6to4 carries the IPv4 right after the prefix
];

const EMBEDDING_RANGES = EMBEDDINGS.map(([cidr, embedding, extractShift]) => {
  const [range] = toRanges(IPV6_BITS, parseIpv6, [[cidr, 'public']]);
  if (range === undefined) throw new Error(`Malformed embedding range: ${cidr}`);
  return { embedding, extractShift, prefix: range.prefix, shift: range.shift };
});

/* -------------------------------------------------------------------------- */
/* Classification                                                              */
/* -------------------------------------------------------------------------- */

function categorise(value: bigint, ranges: readonly Range[]): AddressCategory {
  for (const range of ranges) {
    if (value >> range.shift === range.prefix) {
      return range.category;
    }
  }
  return 'public';
}

function formatIpv4(value: bigint): string {
  return toBytes(value, 4).join('.');
}

function formatIpv6(value: bigint): string {
  const hextets: string[] = [];
  for (let shift = 112n; shift >= 0n; shift -= 16n) {
    hextets.push(((value >> shift) & 0xffffn).toString(16));
  }
  return hextets.join(':');
}

/**
 * Decides whether a request may be sent to this address.
 *
 * Anything that cannot be parsed is refused: a parser that fails open turns
 * every parsing bug into an open door.
 */
export function classifyAddress(input: string): AddressVerdict {
  const trimmed = input.trim();

  if (trimmed !== '' && !trimmed.includes(':')) {
    const value = parseIpv4(trimmed);
    if (value === null) return { allowed: false, category: 'invalid', effectiveAddress: input };

    const category = categorise(value, IPV4_RANGES);
    return { allowed: category === 'public', category, effectiveAddress: formatIpv4(value) };
  }

  const value = trimmed === '' ? null : parseIpv6(trimmed);
  if (value === null) return { allowed: false, category: 'invalid', effectiveAddress: input };

  for (const embedding of EMBEDDING_RANGES) {
    if (value >> embedding.shift === embedding.prefix) {
      const ipv4 = (value >> embedding.extractShift) & 0xffffffffn;
      const category = categorise(ipv4, IPV4_RANGES);

      return {
        allowed: category === 'public',
        category,
        effectiveAddress: formatIpv4(ipv4),
        embedding: embedding.embedding,
      };
    }
  }

  const category = categorise(value, IPV6_RANGES);
  return { allowed: category === 'public', category, effectiveAddress: formatIpv6(value) };
}

/** Convenience wrapper for callers that only need the yes/no. */
export function isAllowedAddress(input: string): boolean {
  return classifyAddress(input).allowed;
}
