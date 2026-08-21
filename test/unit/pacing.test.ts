/**
 * What this server owes data.bnf.fr, and what it may say about a cached answer.
 *
 * Every assertion about time runs on a pinned clock. A test that measured the
 * wall clock would be a test that passes on a fast machine and fails on a busy
 * one, and the rule it was protecting would quietly be turned off the first time
 * somebody marked it flaky.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BnfClient } from "../../src/bnf/client.js";
import { Cache } from "../../src/bnf/cache.js";
import { RateLimiter } from "../../src/bnf/rateLimiter.js";
import { MIN_ALLOWED_INTERVAL_MS } from "../../src/config.js";
import { fakeEndpoint, silentLogger, testConfig, FIXED_NOW } from "./helpers.js";

beforeEach(() => {
  vi.useFakeTimers({ now: FIXED_NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("one request at a time, spaced out", () => {
  it("waits the full interval between two requests", async () => {
    const limiter = new RateLimiter({ intervalMs: 3000 });
    const at: number[] = [];

    const run = async () => {
      await limiter.beforeRequest();
      at.push(Date.now());
    };

    const first = limiter.schedule(run);
    const second = limiter.schedule(run);
    await vi.runAllTimersAsync();
    await Promise.all([first, second]);

    expect(at).toHaveLength(2);
    expect(at[1]! - at[0]!).toBe(3000);
  });

  it("runs one task at a time, in the order they were queued", async () => {
    const limiter = new RateLimiter({ intervalMs: 1000 });
    const order: string[] = [];

    const task = (name: string) => async () => {
      order.push(`${name} in`);
      await limiter.beforeRequest();
      order.push(`${name} out`);
    };

    const all = Promise.all([
      limiter.schedule(task("a")),
      limiter.schedule(task("b")),
      limiter.schedule(task("c")),
    ]);
    await vi.runAllTimersAsync();
    await all;

    expect(order).toEqual(["a in", "a out", "b in", "b out", "c in", "c out"]);
  });

  it("keeps the queue moving after a task that failed", async () => {
    const limiter = new RateLimiter({ intervalMs: 0 });
    const failing = limiter.schedule(() => Promise.reject(new Error("no")));
    await expect(failing).rejects.toThrow("no");
    await expect(limiter.schedule(() => Promise.resolve("through"))).resolves.toBe("through");
  });

  it("widens the gap when the service pushes back, and narrows it only after a run of calm", () => {
    const limiter = new RateLimiter({ intervalMs: 3000 });
    limiter.pushBack();
    expect(limiter.currentIntervalMs).toBe(6000);
    limiter.pushBack();
    expect(limiter.currentIntervalMs).toBe(12_000);

    // One lucky answer after a rough patch does not undo the caution it earned.
    limiter.succeeded();
    limiter.succeeded();
    expect(limiter.currentIntervalMs).toBe(12_000);
    limiter.succeeded();
    expect(limiter.currentIntervalMs).toBe(6000);
  });

  it("never widens past its ceiling", () => {
    const limiter = new RateLimiter({ intervalMs: 3000, maxIntervalMs: 9000 });
    for (let n = 0; n < 10; n += 1) {
      limiter.pushBack();
    }
    expect(limiter.currentIntervalMs).toBe(9000);
  });

  it("cannot wait longer than one interval, whatever the clock did", async () => {
    const limiter = new RateLimiter({ intervalMs: 3000 });
    // A clock that jumped backwards would otherwise produce an unbounded wait.
    vi.setSystemTime(new Date(FIXED_NOW.getTime() - 3_600_000));
    const promise = limiter.beforeRequest();
    await vi.advanceTimersByTimeAsync(3000);
    await expect(promise).resolves.toBeUndefined();
  });
});

describe("the floor under the spacing", () => {
  it("cannot be lowered through the published client entry point", () => {
    const client = new BnfClient({
      config: testConfig({ minIntervalMs: 1 }),
      logger: silentLogger,
    });
    expect(client.intervalMs).toBe(MIN_ALLOWED_INTERVAL_MS);
  });

  it("cannot be lowered by handing it something that is not a number", () => {
    for (const nonsense of [Number.NaN, undefined, null, "fast", -1, 0]) {
      const client = new BnfClient({
        config: testConfig({ minIntervalMs: nonsense as unknown as number }),
        logger: silentLogger,
      });
      expect(client.intervalMs).toBeGreaterThanOrEqual(MIN_ALLOWED_INTERVAL_MS);
    }
  });

  it("can be widened, because slowing down is always allowed", () => {
    const client = new BnfClient({
      config: testConfig({ minIntervalMs: 20_000 }),
      logger: silentLogger,
    });
    expect(client.intervalMs).toBe(20_000);
  });

  it("keeps the project's contact address in the User-Agent whatever a caller sets", () => {
    const client = new BnfClient({
      config: testConfig({ userAgent: "someone-else/9.9" }),
      logger: silentLogger,
    });
    expect(client.userAgent).toContain("someone-else/9.9");
    expect(client.userAgent).toContain("github.com/smeet666/mcp-databnf");
  });

  it("does not repeat the identifier when a caller already carries it", () => {
    const client = new BnfClient({
      config: testConfig({
        userAgent: "mcp-databnf/1.0.0 (+https://github.com/smeet666/mcp-databnf)",
      }),
      logger: silentLogger,
    });
    // The name appears once, and the address it is followed by carries the
    // same word, so the count is of the product identifier rather than of the
    // string.
    expect(client.userAgent.match(/mcp-databnf\/\d/g)).toHaveLength(1);
  });
});

/**
 * Let a promise run to completion on a pinned clock.
 *
 * Reads are spaced, so a second one waits behind a timer that only fake time
 * advances. Awaiting the promise on its own would hang until the test's own
 * deadline, and reaching for real timers here would trade the hang for a suite
 * whose result depends on how busy the machine is.
 */
async function settle<T>(promise: Promise<T>): Promise<T> {
  const running = vi.runAllTimersAsync();
  const value = await promise;
  await running;
  return value;
}

describe("the cache, and the date it hands back", () => {
  it("serves a second identical question without asking the endpoint again", async () => {
    const endpoint = fakeEndpoint([{ fixture: "authors-search" }]);
    const client = new BnfClient({
      config: testConfig(),
      logger: silentLogger,
      fetchImpl: endpoint.fetchImpl,
    });

    const first = await settle(client.searchAuthors("Ardouin", 10, 0));
    const second = await settle(client.searchAuthors("Ardouin", 10, 0));

    expect(endpoint.requests).toHaveLength(1);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
  });

  it("reports the moment the metadata were read, not the moment they were served", async () => {
    const endpoint = fakeEndpoint([{ fixture: "authors-search" }]);
    const client = new BnfClient({
      config: testConfig(),
      logger: silentLogger,
      fetchImpl: endpoint.fetchImpl,
    });

    const first = await settle(client.searchAuthors("Ardouin", 10, 0));
    // Ten minutes later, the same question is answered from the store. The
    // licence asks for the date of retrieval, and this answer was retrieved ten
    // minutes ago rather than now.
    vi.setSystemTime(new Date(FIXED_NOW.getTime() + 600_000));
    const second = await settle(client.searchAuthors("Ardouin", 10, 0));

    expect(second.cached).toBe(true);
    expect(second.retrievedAt).toBe(first.retrievedAt);
    expect(second.retrievedAt).toBe(FIXED_NOW.toISOString());
  });

  it("treats a question asked with a different page size as a different question", async () => {
    const endpoint = fakeEndpoint([{ fixture: "authors-search" }, { fixture: "authors-search" }]);
    const client = new BnfClient({
      config: testConfig(),
      logger: silentLogger,
      fetchImpl: endpoint.fetchImpl,
    });

    await settle(client.searchAuthors("Ardouin", 10, 0));
    await settle(client.searchAuthors("Ardouin", 3, 0));
    expect(endpoint.requests).toHaveLength(2);
  });

  it("stores nothing that could not be parsed", async () => {
    const endpoint = fakeEndpoint([{ status: 200, text: "" }, { fixture: "authors-search" }]);
    const client = new BnfClient({
      config: testConfig(),
      logger: silentLogger,
      fetchImpl: endpoint.fetchImpl,
    });

    await expect(settle(client.searchAuthors("Ardouin", 10, 0))).rejects.toThrow();
    // The failure was not kept, so the next attempt reaches the endpoint.
    const second = await settle(client.searchAuthors("Ardouin", 10, 0));
    expect(second.cached).toBe(false);
    expect(endpoint.requests).toHaveLength(2);
  });

  it("forgets an entry once its lifetime is over", () => {
    const cache = new Cache<string>(1000, 10);
    cache.set("k", "v", Date.now());
    expect(cache.get("k")?.value).toBe("v");
    vi.setSystemTime(new Date(FIXED_NOW.getTime() + 1001));
    expect(cache.get("k")).toBeUndefined();
  });

  it("writes nothing at all when its lifetime is zero", () => {
    const cache = new Cache<string>(0, 10);
    cache.set("k", "v", Date.now());
    expect(cache.size).toBe(0);
  });

  it("drops the least recently read entry once it is full", () => {
    const cache = new Cache<string>(10_000, 2);
    cache.set("a", "1", Date.now());
    cache.set("b", "2", Date.now());
    // Reading 'a' makes 'b' the oldest.
    cache.get("a");
    cache.set("c", "3", Date.now());

    expect(cache.get("a")?.value).toBe("1");
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")?.value).toBe("3");
  });
});
