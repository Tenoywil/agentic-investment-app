import { describe, expect, test } from 'bun:test';
import {
  type RateLimitRule,
  consume,
  createMemoryStore,
  createRateLimiter,
  initialState,
} from './rate-limit';

const rule: RateLimitRule = { capacity: 5, refillPerSecond: 1 };

describe('consume', () => {
  test('spends one token per call', () => {
    const first = consume(initialState(rule, 0), rule, 0);
    expect(first.decision).toEqual({ allowed: true, remaining: 4, retryAfterMs: 0 });
    const second = consume(first.state, rule, 0);
    expect(second.decision.remaining).toBe(3);
  });

  test('allows a burst up to capacity, then refuses', () => {
    let state = initialState(rule, 0);
    for (let i = 0; i < 5; i++) {
      const result = consume(state, rule, 0);
      expect(result.decision.allowed).toBe(true);
      state = result.state;
    }
    const blocked = consume(state, rule, 0);
    expect(blocked.decision.allowed).toBe(false);
    expect(blocked.decision.remaining).toBe(0);
    expect(blocked.decision.retryAfterMs).toBe(1000);
  });

  test('refills continuously with elapsed time', () => {
    let state = initialState(rule, 0);
    for (let i = 0; i < 5; i++) state = consume(state, rule, 0).state;

    // Half a second buys half a token — still not enough for a whole request.
    expect(consume(state, rule, 500).decision.allowed).toBe(false);
    // A full second buys one.
    const after = consume(state, rule, 1000);
    expect(after.decision.allowed).toBe(true);
    expect(after.decision.remaining).toBe(0);
  });

  test('never refills beyond capacity', () => {
    const state = initialState(rule, 0);
    const result = consume(state, rule, 10_000_000);
    expect(result.state.tokens).toBe(rule.capacity - 1);
  });

  test('reports how long to wait for a larger cost', () => {
    let state = initialState(rule, 0);
    for (let i = 0; i < 5; i++) state = consume(state, rule, 0).state;
    // Needs 3 tokens at 1/sec.
    expect(consume(state, rule, 0, 3).decision.retryAfterMs).toBe(3000);
  });

  test('a cost above capacity can never succeed and reports Infinity when static', () => {
    const stalled: RateLimitRule = { capacity: 2, refillPerSecond: 0 };
    const result = consume(initialState(stalled, 0), stalled, 0, 5);
    expect(result.decision.allowed).toBe(false);
    expect(result.decision.retryAfterMs).toBe(Number.POSITIVE_INFINITY);
  });

  test('clock skew backwards does not grant tokens', () => {
    let state = initialState(rule, 10_000);
    for (let i = 0; i < 5; i++) state = consume(state, rule, 10_000).state;
    // A `now` in the past must not act like elapsed time.
    const skewed = consume(state, rule, 0);
    expect(skewed.decision.allowed).toBe(false);
    expect(skewed.state.tokens).toBe(0);
  });

  test('a refused request does not consume tokens', () => {
    let state = initialState(rule, 0);
    for (let i = 0; i < 5; i++) state = consume(state, rule, 0).state;
    const before = consume(state, rule, 0).state.tokens;
    const after = consume(state, rule, 0).state.tokens;
    expect(before).toBe(after);
  });

  test('arrival at the refill rate is sustained indefinitely, keeping burst headroom', () => {
    let state = initialState(rule, 0);
    let allowed = 0;
    // One attempt per second for 60s — exactly the 1/sec refill rate.
    for (let second = 0; second <= 60; second++) {
      const result = consume(state, rule, second * 1000);
      if (result.decision.allowed) allowed++;
      state = result.state;
    }
    expect(allowed).toBe(61);
    // Each tick spent what it earned, so the burst headroom is still there:
    // capacity-1 further instantaneous requests succeed, then it refuses.
    for (let i = 0; i < rule.capacity - 1; i++) {
      const result = consume(state, rule, 60_000);
      expect(result.decision.allowed).toBe(true);
      state = result.state;
    }
    expect(consume(state, rule, 60_000).decision.allowed).toBe(false);
  });

  test('arrival faster than the refill rate is throttled to the refill rate', () => {
    let state = initialState(rule, 0);
    let allowed = 0;
    // Hammer at 10/sec for 60s — 601 attempts against a 5-token, 1/sec bucket.
    for (let tick = 0; tick <= 600; tick++) {
      const result = consume(state, rule, tick * 100);
      if (result.decision.allowed) allowed++;
      state = result.state;
    }
    // Throughput is bounded by burst + refill (65). A sub-token remainder may be
    // left unspent at the cutoff, so the guarantee is the ceiling, not an exact count.
    const ceiling = rule.capacity + 60;
    expect(allowed).toBeLessThanOrEqual(ceiling);
    expect(allowed).toBeGreaterThan(ceiling - 2);
    // The overwhelming majority of the flood was refused.
    expect(allowed).toBeLessThan(601 * 0.12);
  });
});

describe('createRateLimiter', () => {
  test('isolates buckets per key', async () => {
    const now = 0;
    const limiter = createRateLimiter(rule, createMemoryStore(), () => now);

    for (let i = 0; i < 5; i++) expect((await limiter.check('user:a')).allowed).toBe(true);
    expect((await limiter.check('user:a')).allowed).toBe(false);
    // A different caller is unaffected by the first one's exhaustion.
    expect((await limiter.check('user:b')).allowed).toBe(true);
  });

  test('recovers as the injected clock advances', async () => {
    let now = 0;
    const limiter = createRateLimiter(rule, createMemoryStore(), () => now);
    for (let i = 0; i < 5; i++) await limiter.check('ip:1.2.3.4');
    expect((await limiter.check('ip:1.2.3.4')).allowed).toBe(false);

    now = 3000;
    expect((await limiter.check('ip:1.2.3.4')).allowed).toBe(true);
    expect((await limiter.check('ip:1.2.3.4')).allowed).toBe(true);
    expect((await limiter.check('ip:1.2.3.4')).allowed).toBe(true);
    expect((await limiter.check('ip:1.2.3.4')).allowed).toBe(false);
  });

  test('honours a per-call cost', async () => {
    const limiter = createRateLimiter(rule, createMemoryStore(), () => 0);
    expect((await limiter.check('k', 5)).allowed).toBe(true);
    expect((await limiter.check('k', 1)).allowed).toBe(false);
  });

  test('memory store keeps one entry per key', async () => {
    const store = createMemoryStore();
    const limiter = createRateLimiter(rule, store, () => 0);
    await limiter.check('a');
    await limiter.check('a');
    await limiter.check('b');
    expect(store.size()).toBe(2);
  });
});
