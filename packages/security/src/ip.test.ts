import { describe, expect, test } from 'bun:test';
import { isPublicIp, parseIp } from './ip';

const publicIp = (text: string) => {
  const parsed = parseIp(text);
  if (!parsed) throw new Error(`expected ${text} to parse`);
  return isPublicIp(parsed);
};

describe('parseIp', () => {
  test('parses dotted-quad IPv4', () => {
    expect(parseIp('8.8.8.8')).toEqual({ version: 4, bytes: new Uint8Array([8, 8, 8, 8]) });
    expect(parseIp('0.0.0.0')?.version).toBe(4);
    expect(parseIp('255.255.255.255')?.version).toBe(4);
  });

  test('rejects malformed IPv4', () => {
    expect(parseIp('256.0.0.1')).toBeNull();
    expect(parseIp('1.2.3')).toBeNull();
    expect(parseIp('1.2.3.4.5')).toBeNull();
    expect(parseIp('1.2.3.-4')).toBeNull();
    expect(parseIp('example.com')).toBeNull();
    expect(parseIp('')).toBeNull();
  });

  test('rejects leading zeros, which some resolvers read as octal', () => {
    // 0177.0.0.1 would be 127.0.0.1 under an octal-aware parser.
    expect(parseIp('010.0.0.1')).toBeNull();
    expect(parseIp('127.0.0.01')).toBeNull();
  });

  test('parses IPv6 including compression and brackets', () => {
    expect(parseIp('::1')?.version).toBe(6);
    expect(parseIp('[::1]')?.version).toBe(6);
    expect(parseIp('fe80::1')?.version).toBe(6);
    expect(parseIp('2001:4860:4860::8888')?.version).toBe(6);
    const full = parseIp('2001:0db8:0000:0000:0000:0000:0000:0001');
    expect(full?.bytes[0]).toBe(0x20);
    expect(full?.bytes[15]).toBe(1);
  });

  test('parses IPv4-mapped IPv6', () => {
    const mapped = parseIp('::ffff:127.0.0.1');
    expect(mapped?.version).toBe(6);
    expect(mapped?.bytes.slice(12)).toEqual(new Uint8Array([127, 0, 0, 1]));
  });

  test('strips an IPv6 zone index', () => {
    expect(parseIp('fe80::1%eth0')?.version).toBe(6);
  });

  test('rejects malformed IPv6', () => {
    expect(parseIp('::::')).toBeNull();
    expect(parseIp('1::2::3')).toBeNull();
    expect(parseIp('12345::1')).toBeNull();
    expect(parseIp('1:2:3:4:5:6:7')).toBeNull(); // too few groups, no ::
    expect(parseIp('1:2:3:4:5:6:7:8:9')).toBeNull();
  });
});

describe('isPublicIp — public addresses', () => {
  test.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '203.0.114.1'])('%s is public', (ip) => {
    expect(publicIp(ip)).toBe(true);
  });

  test.each(['2001:4860:4860::8888', '2606:4700:4700::1111'])('%s is public', (ip) => {
    expect(publicIp(ip)).toBe(true);
  });
});

describe('isPublicIp — blocked IPv4 ranges', () => {
  test.each([
    ['0.0.0.0', 'this network'],
    ['10.0.0.1', 'private'],
    ['10.255.255.255', 'private upper bound'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['127.0.0.1', 'loopback'],
    ['169.254.169.254', 'cloud metadata endpoint'],
    ['172.16.0.1', 'private'],
    ['172.31.255.255', 'private upper bound'],
    ['192.0.2.1', 'TEST-NET-1'],
    ['192.168.1.1', 'private'],
    ['198.18.0.1', 'benchmarking'],
    ['198.51.100.1', 'TEST-NET-2'],
    ['203.0.113.1', 'TEST-NET-3'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'broadcast'],
  ])('%s is blocked (%s)', (ip) => {
    expect(publicIp(ip)).toBe(false);
  });

  test('boundaries of the 172.16/12 private block', () => {
    expect(publicIp('172.15.255.255')).toBe(true);
    expect(publicIp('172.16.0.0')).toBe(false);
    expect(publicIp('172.31.255.255')).toBe(false);
    expect(publicIp('172.32.0.0')).toBe(true);
  });

  test('boundaries of the 100.64/10 CGNAT block', () => {
    expect(publicIp('100.63.255.255')).toBe(true);
    expect(publicIp('100.64.0.0')).toBe(false);
    expect(publicIp('100.127.255.255')).toBe(false);
    expect(publicIp('100.128.0.0')).toBe(true);
  });
});

describe('isPublicIp — blocked IPv6 ranges', () => {
  test.each([
    ['::', 'unspecified'],
    ['::1', 'loopback'],
    ['fc00::1', 'unique local'],
    ['fd12:3456::1', 'unique local'],
    ['fe80::1', 'link-local'],
    ['ff02::1', 'multicast'],
    ['2001:db8::1', 'documentation'],
    ['64:ff9b::1', 'v4/v6 translation'],
  ])('%s is blocked (%s)', (ip) => {
    expect(publicIp(ip)).toBe(false);
  });

  test('IPv4-mapped addresses are judged by the embedded IPv4', () => {
    // The classic SSRF bypass: smuggle a private v4 address inside a v6 literal.
    expect(publicIp('::ffff:127.0.0.1')).toBe(false);
    expect(publicIp('::ffff:169.254.169.254')).toBe(false);
    expect(publicIp('::ffff:10.0.0.1')).toBe(false);
    expect(publicIp('::ffff:8.8.8.8')).toBe(true);
  });
});
