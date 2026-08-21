/**
 * A small in-memory store, keyed by the query that produced the value.
 *
 * It exists to keep a conversation that asks the same thing twice from asking
 * the endpoint twice, which matters here because a conversation about one
 * author walks the same records repeatedly: the person, then the works, then
 * the editions of one work, then back to the person.
 *
 * Entries expire, the store is bounded, and it holds only what was successfully
 * read: storing a response nobody could parse would serve that failure back for
 * the rest of its lifetime.
 *
 * Each entry keeps the moment it was read. The licence asks for the date the
 * metadata was retrieved, and a cached answer was retrieved when it entered the
 * store rather than when it was served, so the stored moment is what travels
 * with it.
 */

interface Entry<T> {
  value: T;
  expiresAt: number;
  retrievedAt: number;
}

export interface Hit<T> {
  value: T;
  retrievedAt: number;
}

export class Cache<T> {
  private readonly entries = new Map<string, Entry<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
  ) {}

  get(key: string): Hit<T> | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // Re-inserting marks it as the most recently used, which is what the
    // eviction below reads.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return { value: entry.value, retrievedAt: entry.retrievedAt };
  }

  set(key: string, value: T, retrievedAt: number): void {
    // A lifetime of zero turns the store off rather than expiring at once:
    // nothing is written, so nothing has to be checked on the way out.
    if (this.ttlMs <= 0) {
      return;
    }
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs, retrievedAt });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) {
        break;
      }
      this.entries.delete(oldest.value);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
