/**
 * Keeps this client to one request at a time, spaced out.
 *
 * data.bnf.fr is a query service a public institution runs at its own cost, and
 * a SPARQL endpoint answers an expensive question per request rather than
 * serving a file. Serialising also means a burst of tool calls cannot turn into
 * a burst of concurrent queries on one planner.
 *
 * The spacing widens when the service pushes back and narrows again on a run of
 * quiet successes, so a slow patch does not become the permanent speed.
 */

export interface RateLimiterOptions {
  /** Spacing between requests when nothing has gone wrong. */
  intervalMs: number;
  /** The widest the spacing may become under push-back. */
  maxIntervalMs?: number;
}

export class RateLimiter {
  private readonly baseIntervalMs: number;
  private readonly maxIntervalMs: number;
  private intervalMs: number;
  private lastStartedAt = 0;
  private queue: Promise<void> = Promise.resolve();
  private calmStreak = 0;

  constructor(options: RateLimiterOptions) {
    this.baseIntervalMs = options.intervalMs;
    this.maxIntervalMs = options.maxIntervalMs ?? options.intervalMs * 8;
    this.intervalMs = options.intervalMs;
  }

  /** The spacing in force, which callers report rather than guess. */
  get currentIntervalMs(): number {
    return this.intervalMs;
  }

  /**
   * Run `task` with nothing else in flight.
   *
   * This only serialises. Spacing is claimed per attempt through
   * `beforeRequest`, because a task that retries makes several requests and
   * each of them owes the service the same gap.
   */
  schedule<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** Wait until enough time has passed since the previous request began. */
  async beforeRequest(): Promise<void> {
    const elapsed = Date.now() - this.lastStartedAt;
    // Capped at one whole interval, so a clock that moved backwards cannot
    // produce a wait longer than the spacing itself.
    const wait = Math.min(this.intervalMs, this.intervalMs - elapsed);
    if (wait > 0) await sleep(wait);
    this.lastStartedAt = Date.now();
  }

  /** Called when the service asks for room: double the gap, up to the ceiling. */
  pushBack(): void {
    this.calmStreak = 0;
    this.intervalMs = Math.min(this.maxIntervalMs, this.intervalMs * 2);
  }

  /**
   * Called on a clean answer. Recovery takes several in a row, so one lucky
   * response after a rough patch does not undo the caution that earned it.
   */
  succeeded(): void {
    if (this.intervalMs === this.baseIntervalMs) return;
    this.calmStreak += 1;
    if (this.calmStreak < 3) return;
    this.calmStreak = 0;
    this.intervalMs = Math.max(this.baseIntervalMs, Math.round(this.intervalMs / 2));
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
