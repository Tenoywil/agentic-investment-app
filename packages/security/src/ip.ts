/**
 * IP address parsing and public/private classification.
 *
 * The SSRF guard resolves a hostname and must reject any address that could reach
 * infrastructure rather than the public internet — loopback, RFC1918 private space,
 * link-local (which includes the 169.254.169.254 cloud metadata endpoint), CGNAT,
 * multicast and reserved ranges. Pure: no network, no clock.
 */

export type IpVersion = 4 | 6;
export type ParsedIp = { version: IpVersion; bytes: Uint8Array };

/** Parse a dotted-quad IPv4 address. Rejects leading zeros (octal ambiguity). */
function parseIpv4(text: string): Uint8Array | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    const part = parts[i] as string;
    if (!/^\d{1,3}$/.test(part)) return null;
    // "01" and "010" are ambiguous (octal in some resolvers) — reject outright.
    if (part.length > 1 && part.startsWith('0')) return null;
    const value = Number(part);
    if (value > 255) return null;
    bytes[i] = value;
  }
  return bytes;
}

/** Parse an IPv6 address, including `::` compression and IPv4-mapped tails. */
function parseIpv6(text: string): Uint8Array | null {
  let input = text;
  // Strip a zone index (fe80::1%eth0) — scoped addresses are never routable anyway.
  const zone = input.indexOf('%');
  if (zone !== -1) input = input.slice(0, zone);
  if (input.includes(':::')) return null;

  // A trailing dotted-quad (::ffff:192.168.0.1) becomes the last four bytes.
  let tail: Uint8Array | null = null;
  const lastColon = input.lastIndexOf(':');
  const maybeV4 = input.slice(lastColon + 1);
  if (maybeV4.includes('.')) {
    tail = parseIpv4(maybeV4);
    if (!tail) return null;
    input = input.slice(0, lastColon + 1);
    // Re-express the v4 tail as two hextets so the group arithmetic below holds.
    input += `${(((tail[0] as number) << 8) | (tail[1] as number)).toString(16)}:${(((tail[2] as number) << 8) | (tail[3] as number)).toString(16)}`;
  }

  const halves = input.split('::');
  if (halves.length > 2) return null;

  const toGroups = (segment: string): number[] | null => {
    if (segment === '') return [];
    const out: number[] = [];
    for (const piece of segment.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(piece)) return null;
      out.push(Number.parseInt(piece, 16));
    }
    return out;
  };

  const head = toGroups(halves[0] as string);
  if (!head) return null;
  const rest = halves.length === 2 ? toGroups(halves[1] as string) : null;
  if (halves.length === 2 && !rest) return null;

  let groups: number[];
  if (halves.length === 2) {
    const fill = 8 - head.length - (rest as number[]).length;
    if (fill < 1) return null; // `::` must stand for at least one zero group
    groups = [...head, ...new Array(fill).fill(0), ...(rest as number[])];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const group = groups[i] as number;
    bytes[i * 2] = group >> 8;
    bytes[i * 2 + 1] = group & 0xff;
  }
  return bytes;
}

/** Parse a literal IPv4 or IPv6 address. Returns null if the text is not an IP. */
export function parseIp(text: string): ParsedIp | null {
  const trimmed = text.trim();
  // Bracketed IPv6 authority form, e.g. [::1]
  const unwrapped =
    trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1) : trimmed;
  if (unwrapped.includes(':')) {
    const bytes = parseIpv6(unwrapped);
    return bytes ? { version: 6, bytes } : null;
  }
  const bytes = parseIpv4(unwrapped);
  return bytes ? { version: 4, bytes } : null;
}

type Cidr = { bytes: Uint8Array; prefix: number };

function cidr(address: string, prefix: number): Cidr {
  const parsed = parseIp(address);
  if (!parsed) throw new Error(`invalid CIDR base address: ${address}`);
  return { bytes: parsed.bytes, prefix };
}

function inRange(ip: Uint8Array, range: Cidr): boolean {
  if (ip.length !== range.bytes.length) return false;
  const fullBytes = range.prefix >> 3;
  for (let i = 0; i < fullBytes; i++) {
    if (ip[i] !== range.bytes[i]) return false;
  }
  const remainder = range.prefix & 7;
  if (remainder === 0) return true;
  const mask = (0xff << (8 - remainder)) & 0xff;
  return ((ip[fullBytes] as number) & mask) === ((range.bytes[fullBytes] as number) & mask);
}

/** Non-public IPv4 space (RFC 1918/3927/6598/5735/5737 and reserved blocks). */
const BLOCKED_V4: Cidr[] = [
  cidr('0.0.0.0', 8), // "this" network
  cidr('10.0.0.0', 8), // private
  cidr('100.64.0.0', 10), // carrier-grade NAT
  cidr('127.0.0.0', 8), // loopback
  cidr('169.254.0.0', 16), // link-local — includes cloud metadata (169.254.169.254)
  cidr('172.16.0.0', 12), // private
  cidr('192.0.0.0', 24), // IETF protocol assignments
  cidr('192.0.2.0', 24), // TEST-NET-1
  cidr('192.88.99.0', 24), // 6to4 relay anycast
  cidr('192.168.0.0', 16), // private
  cidr('198.18.0.0', 15), // benchmarking
  cidr('198.51.100.0', 24), // TEST-NET-2
  cidr('203.0.113.0', 24), // TEST-NET-3
  cidr('224.0.0.0', 4), // multicast
  cidr('240.0.0.0', 4), // reserved + broadcast
];

/** Non-public IPv6 space (RFC 4193/4291/6666/6890). */
const BLOCKED_V6: Cidr[] = [
  cidr('::', 128), // unspecified
  cidr('::1', 128), // loopback
  cidr('64:ff9b::', 96), // IPv4/IPv6 translation
  cidr('100::', 64), // discard-only
  cidr('2001:db8::', 32), // documentation
  cidr('fc00::', 7), // unique local
  cidr('fe80::', 10), // link-local
  cidr('ff00::', 8), // multicast
];

const V4_MAPPED = cidr('::ffff:0:0', 96);

/**
 * True when the address is globally routable public internet space.
 * IPv4-mapped IPv6 (::ffff:10.0.0.1) is unwrapped and judged as IPv4, so the
 * mapping cannot be used to smuggle a private address past the guard.
 */
export function isPublicIp(ip: ParsedIp): boolean {
  if (ip.version === 4) return !BLOCKED_V4.some((range) => inRange(ip.bytes, range));
  if (inRange(ip.bytes, V4_MAPPED)) {
    return isPublicIp({ version: 4, bytes: ip.bytes.slice(12) });
  }
  return !BLOCKED_V6.some((range) => inRange(ip.bytes, range));
}
