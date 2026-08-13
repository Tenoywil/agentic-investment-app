/**
 * Token-bucket rate limiting.
 *
 * The arithmetic is a pure function of (previous state, rule, now) so it can be
 * tested exhaustively and reused over any store — an in-memory map for a single
 * process, or a Postgres row for the real multi-instance deployment. Time is
 * injected; nothing here reads a clock.
 *
 * A bucket holds `capacity` tokens and refills continuously at `refillPerSecond`.
 * Bursts up to the capacity are allowed, sustained throughput settles at the refill
 * rate — the behaviour you want for `agent-chat`, `orders` and auth, where a user
 * legitimately clicks a few times in a row but must not hammer the endpoint.
 */

export type RateLimitRule = {
  /** Maximum tokens (the largest instantaneous burst). */
  capacity: number;
  /** Tokens restored per second. */
  refillPerSecond: number;
};

export type BucketState = {
  /** Tokens available as of `updatedAt`. */
  tokens: number;
  /** Epoch milliseconds the token count was computed at. */
  updatedAt: number;
};

export type RateLimitDecision = {
  allowed: boolean;
  /** Whole tokens left after this decision. */
  remaining: number;
  /** Milliseconds until the request could succeed. 0 when allowed. */
  retryAfterMs: number;
};

export type ConsumeResult = { state: BucketState; decision: RateLimitDecision };

/** A fresh, full bucket. */
export function initialState(rule: RateLimitRule, now: number): BucketState {
  return { tokens: rule.capacity, updatedAt: now };
}

/**
 * Refill for elapsed time, then attempt to take `cost` tokens.
 * Clock skew (a `now` earlier than `updatedAt`) never grants tokens.
 */
export function consume(
  state: BucketState,
  rule: RateLimitRule,
  now: number,
  cost = 1,
): ConsumeResult {
  const elapsedMs = Math.max(0, now - state.updatedAt);
  const refilled = Math.min(
    rule.capacity,
    state.tokens + (elapsedMs / 1000) * rule.refillPerSecond,
  );

  if (refilled >= cost) {
    const tokens = refilled - cost;
    return {
      state: { tokens, updatedAt: now },
      decision: { allowed: true, remaining: Math.floor(tokens), retryAfterMs: 0 },
    };
  }

  // Not enough: keep the refilled balance and report when `cost` becomes available.
  const deficit = cost - refilled;
  const retryAfterMs =
    rule.refillPerSecond > 0
      ? Math.ceil((deficit / rule.refillPerSecond) * 1000)
      : Number.POSITIVE_INFINITY;
  return {
    state: { tokens: refilled, updatedAt: now },
    decision: { allowed: false, remaining: Math.floor(refilled), retryAfterMs },
  };
}

/** Persistence for buckets. Implementations must be atomic per key. */
export type RateLimitStore = {
  /** Read-modify-write a bucket under `key`, returning the decision. */
  update(
    key: string,
    apply: (previous: BucketState | undefined) => ConsumeResult,
  ): Promise<RateLimitDecision>;
};

/** Single-process store. Fine for tests and dev; use the Postgres store in prod. */
export function createMemoryStore(): RateLimitStore & { size(): number; clear(): void } {
  const buckets = new Map<string, BucketState>();
  return {
    async update(key, apply) {
      const { state, decision } = apply(buckets.get(key));
      buckets.set(key, state);
      return decision;
    },
    size: () => buckets.size,
    clear: () => buckets.clear(),
  };
}

export type RateLimiter = {
  /** Charge `cost` against `key`. Never throws on refusal — inspect `allowed`. */
  check(key: string, cost?: number): Promise<RateLimitDecision>;
};

/** Bind a rule, a store and a clock into a limiter for one route class. */
export function createRateLimiter(
  rule: RateLimitRule,
  store: RateLimitStore,
  now: () => number,
): RateLimiter {
  return {
    check(key, cost = 1) {
      const at = now();
      return store.update(key, (previous) =>
        consume(previous ?? initialState(rule, at), rule, at, cost),
      );
    },
  };
}
