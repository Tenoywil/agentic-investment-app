/**
 * A small in-memory LRU response cache, keyed on a stable hash of the prompt +
 * inputs. The gateway is not assumed to do prompt-caching, so identical research
 * questions (same system prompt, history, and message) reuse a prior answer
 * instead of paying for another completion. Swappable for a Postgres-backed
 * store behind the same interface.
 */

/** Deterministic JSON with sorted keys, so equal inputs hash identically. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : 1,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/** djb2 — a fast, dependency-free string hash (not cryptographic; a cache key). */
function djb2(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

export class ResponseCache<T> {
  private readonly store = new Map<string, T>();

  constructor(private readonly max = 256) {}

  /** Stable key for any serializable input (prompt parts, tool inputs, …). */
  static key(input: unknown): string {
    return djb2(stableStringify(input));
  }

  get(key: string): T | undefined {
    const value = this.store.get(key);
    if (value === undefined) return undefined;
    // Touch: move to most-recently-used.
    this.store.delete(key);
    this.store.set(key, value);
    return value;
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  set(key: string, value: T): void {
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, value);
    while (this.store.size > this.max) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }

  get size(): number {
    return this.store.size;
  }
}
