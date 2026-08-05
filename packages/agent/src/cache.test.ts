import { expect, describe as group, test } from 'bun:test';
import { ResponseCache } from './cache';

group('ResponseCache', () => {
  test('stable key is order-independent for object inputs', () => {
    const a = ResponseCache.key({ system: 's', message: 'hi', history: [] });
    const b = ResponseCache.key({ history: [], message: 'hi', system: 's' });
    expect(a).toBe(b);
  });

  test('different inputs produce different keys', () => {
    expect(ResponseCache.key({ message: 'a' })).not.toBe(ResponseCache.key({ message: 'b' }));
  });

  test('get/set/has round-trip', () => {
    const c = new ResponseCache<string>();
    const k = ResponseCache.key({ q: 'best income deal' });
    expect(c.has(k)).toBe(false);
    c.set(k, 'the GOJ 2032 bond');
    expect(c.has(k)).toBe(true);
    expect(c.get(k)).toBe('the GOJ 2032 bond');
  });

  test('evicts the least-recently-used past the cap', () => {
    const c = new ResponseCache<number>(2);
    c.set('a', 1);
    c.set('b', 2);
    c.get('a'); // touch a → b is now LRU
    c.set('c', 3); // evicts b
    expect(c.has('a')).toBe(true);
    expect(c.has('b')).toBe(false);
    expect(c.has('c')).toBe(true);
    expect(c.size).toBe(2);
  });
});
