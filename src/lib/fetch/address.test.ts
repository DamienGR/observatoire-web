import { describe, expect, it } from 'vitest';
import { classifyAddress, isAllowedAddress, parseIpAddress } from './address.js';

/**
 * Tabular tests over the rejected ranges, as CLAUDE.md §5 requires (priority 2).
 *
 * The table is the specification. Every entry here is a range someone has
 * actually used to pivot into an internal network, so an entry removed from
 * this table is a decision, not a cleanup.
 */

const BLOCKED: readonly [address: string, category: string, why: string][] = [
  // --- IPv4 -------------------------------------------------------------
  ['0.0.0.0', 'unspecified', 'this host, this network'],
  ['0.1.2.3', 'unspecified', '0.0.0.0/8'],
  ['10.0.0.1', 'private', 'RFC 1918'],
  ['10.255.255.255', 'private', 'RFC 1918 upper bound'],
  ['100.64.0.1', 'carrier-grade-nat', 'RFC 6598 — Alibaba metadata lives here'],
  ['100.100.100.200', 'carrier-grade-nat', 'Alibaba Cloud metadata'],
  ['100.127.255.255', 'carrier-grade-nat', 'RFC 6598 upper bound'],
  ['127.0.0.1', 'loopback', 'localhost'],
  ['127.1.2.3', 'loopback', 'the whole /8 is loopback, not just .0.0.1'],
  ['169.254.0.1', 'link-local', 'RFC 3927'],
  ['169.254.169.254', 'cloud-metadata', 'AWS, GCP, Azure, DigitalOcean metadata'],
  ['172.16.0.1', 'private', 'RFC 1918'],
  ['172.31.255.255', 'private', 'RFC 1918 upper bound'],
  ['192.0.0.1', 'reserved', 'IETF protocol assignments'],
  ['192.0.2.1', 'documentation', 'TEST-NET-1'],
  ['192.168.1.1', 'private', 'RFC 1918'],
  ['198.18.0.1', 'benchmarking', 'RFC 2544'],
  ['198.51.100.1', 'documentation', 'TEST-NET-2'],
  ['203.0.113.1', 'documentation', 'TEST-NET-3'],
  ['224.0.0.1', 'multicast', 'class D'],
  ['239.255.255.255', 'multicast', 'class D upper bound'],
  ['240.0.0.1', 'reserved', 'class E'],
  ['255.255.255.255', 'broadcast', 'limited broadcast'],

  // --- IPv6 -------------------------------------------------------------
  ['::', 'unspecified', 'unspecified address'],
  ['::1', 'loopback', 'IPv6 localhost'],
  ['fc00::1', 'unique-local', 'RFC 4193'],
  ['fd00::1', 'unique-local', 'RFC 4193, the half actually used'],
  ['fe80::1', 'link-local', 'RFC 4291'],
  ['febf::1', 'link-local', 'fe80::/10 upper bound'],
  ['ff02::1', 'multicast', 'all nodes'],
  ['100::1', 'reserved', 'discard-only prefix'],
  ['2001:db8::1', 'documentation', 'RFC 3849'],
];

/**
 * The bypass that matters. Every one of these is a *public-looking* string
 * that reaches a forbidden address once it is decoded. Blocking the plain
 * forms above while accepting these would be security theatre.
 */
const BLOCKED_BY_DECODING: readonly [address: string, effective: string, why: string][] = [
  ['::ffff:127.0.0.1', '127.0.0.1', 'IPv4-mapped IPv6'],
  ['::ffff:169.254.169.254', '169.254.169.254', 'IPv4-mapped cloud metadata'],
  ['::ffff:7f00:1', '127.0.0.1', 'IPv4-mapped written in hex'],
  ['::ffff:a9fe:a9fe', '169.254.169.254', 'IPv4-mapped metadata written in hex'],
  ['64:ff9b::127.0.0.1', '127.0.0.1', 'NAT64 well-known prefix'],
  ['64:ff9b::a9fe:a9fe', '169.254.169.254', 'NAT64 carrying the metadata address'],
  ['2002:7f00:0001::', '127.0.0.1', '6to4 embeds the IPv4 in the prefix'],
  ['2002:a9fe:a9fe::', '169.254.169.254', '6to4 carrying the metadata address'],
];

const ALLOWED: readonly [address: string, why: string][] = [
  ['1.1.1.1', 'ordinary public IPv4'],
  ['8.8.8.8', 'ordinary public IPv4'],
  ['185.31.40.1', 'a French hosting range'],
  ['9.255.255.255', 'just below 10.0.0.0/8'],
  ['11.0.0.0', 'just above 10.255.255.255'],
  ['100.63.255.255', 'just below the CGNAT block'],
  ['100.128.0.0', 'just above the CGNAT block'],
  ['126.255.255.255', 'just below loopback'],
  ['128.0.0.1', 'just above loopback'],
  ['169.253.255.255', 'just below link-local'],
  ['169.255.0.0', 'just above link-local'],
  ['172.15.255.255', 'just below 172.16/12'],
  ['172.32.0.0', 'just above 172.31.255.255'],
  ['192.167.255.255', 'just below 192.168/16'],
  ['192.169.0.0', 'just above 192.168/16'],
  ['223.255.255.255', 'just below multicast'],
  ['2606:4700:4700::1111', 'ordinary public IPv6'],
  ['2a01:e0a::1', 'ordinary public IPv6'],
  ['fbff::1', 'just below fc00::/7'],
  ['fe00::1', 'just below fe80::/10'],
  ['fec0::1', 'just above fe80::/10 — site-local, deprecated but routable'],
];

describe('classifyAddress — blocked ranges', () => {
  it.each(BLOCKED)('rejects %s as %s (%s)', (address, category) => {
    const verdict = classifyAddress(address);

    expect(verdict.allowed).toBe(false);
    expect(verdict.category).toBe(category);
  });
});

describe('classifyAddress — addresses that decode to a blocked one', () => {
  it.each(BLOCKED_BY_DECODING)('rejects %s, which reaches %s (%s)', (address, effective) => {
    const verdict = classifyAddress(address);

    expect(verdict.allowed).toBe(false);
    // The verdict must name the address actually reached, not the one written.
    expect(verdict.effectiveAddress).toBe(effective);
  });

  it('reports how the address was embedded, so a log line is diagnosable', () => {
    expect(classifyAddress('::ffff:127.0.0.1').embedding).toBe('ipv4-mapped');
    expect(classifyAddress('64:ff9b::a9fe:a9fe').embedding).toBe('nat64');
    expect(classifyAddress('2002:7f00:0001::').embedding).toBe('6to4');
  });

  it('still allows an embedded address that is genuinely public', () => {
    // The rule is "decode, then judge", not "anything embedded is hostile".
    expect(classifyAddress('::ffff:1.1.1.1').allowed).toBe(true);
    expect(classifyAddress('2002:0808:0808::').allowed).toBe(true);
  });
});

describe('classifyAddress — allowed addresses', () => {
  it.each(ALLOWED)('allows %s (%s)', (address) => {
    const verdict = classifyAddress(address);

    expect(verdict.allowed).toBe(true);
    expect(verdict.category).toBe('public');
  });
});

describe('classifyAddress — malformed input', () => {
  // An address we cannot parse is refused. Anything else means a parser bug
  // becomes an open door.
  it.each([
    ['not-an-ip'],
    [''],
    ['256.0.0.1'],
    ['1.2.3'],
    ['1.2.3.4.5'],
    ['01.2.3.4'],
    ['::ffff:256.0.0.1'],
    ['1::2::3'],
    ['12345::'],
    ['gggg::1'],
    ['1:2:3:4:5:6:7:8:9'],
  ])('refuses %s', (address) => {
    const verdict = classifyAddress(address);

    expect(verdict.allowed).toBe(false);
    expect(verdict.category).toBe('invalid');
  });
});

describe('parseIpAddress', () => {
  it('expands :: and returns 16 bytes for IPv6', () => {
    const parsed = parseIpAddress('::1');

    expect(parsed?.version).toBe(6);
    expect(parsed?.bytes).toHaveLength(16);
    expect(parsed?.bytes[15]).toBe(1);
  });

  it('returns 4 bytes for IPv4', () => {
    expect(parseIpAddress('192.168.1.1')).toEqual({ version: 4, bytes: [192, 168, 1, 1] });
  });

  it('accepts an IPv6 address written in full', () => {
    expect(parseIpAddress('2001:0db8:0000:0000:0000:0000:0000:0001')?.version).toBe(6);
  });

  it('accepts a trailing dotted quad in an IPv6 address', () => {
    const parsed = parseIpAddress('::ffff:192.168.1.1');

    expect(parsed?.bytes.slice(12)).toEqual([192, 168, 1, 1]);
  });

  it('returns null rather than throwing on malformed input', () => {
    expect(parseIpAddress('nope')).toBeNull();
  });
});

describe('isAllowedAddress', () => {
  it('is the yes/no shorthand over classifyAddress', () => {
    expect(isAllowedAddress('1.1.1.1')).toBe(true);
    expect(isAllowedAddress('169.254.169.254')).toBe(false);
  });
});
