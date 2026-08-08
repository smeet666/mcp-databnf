/**
 * What this endpoint does instead of saying 429.
 *
 * data.bnf.fr rarely refuses with a status. When it will spend no more on a
 * caller it answers HTTP 200 and either an empty body or a plain-text runtime
 * error, so the moment the spacing most needs to widen looks, at the level of
 * the status line, exactly like success.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BnfClient } from "../../src/bnf/client.js";
import { runQuery } from "../../src/bnf/http.js";
import { RateLimiter } from "../../src/bnf/rateLimiter.js";
import { fakeEndpoint, silentLogger, testConfig, FIXED_NOW } from "./helpers.js";

const attempt = (endpoint: ReturnType<typeof fakeEndpoint>, limiter: RateLimiter) => ({
  query: "SELECT ?s WHERE { ?s ?p ?o } LIMIT 1",
  userAgent: "mcp-databnf/test",
  timeoutMs: 5000,
  maxRetries: 0,
  limiter,
  logger: silentLogger,
  fetchImpl: endpoint.fetchImpl,
});

/**
 * Let a request finish on a pinned clock.
 *
 * A widened gap is a real wait, and waiting it out on the wall clock would make
 * this file take a minute and make its result depend on the machine.
 */
async function settle<T>(promise: Promise<T>): Promise<T> {
  const running = vi.runAllTimersAsync();
  try {
    return await promise;
  } finally {
    await running;
  }
}

describe("a query the endpoint gave up on", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: FIXED_NOW });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("widens the gap rather than counting as a calm answer", async () => {
    const limiter = new RateLimiter({ intervalMs: 3000 });
    const endpoint = fakeEndpoint([{ status: 200, text: "" }]);

    await expect(runQuery(attempt(endpoint, limiter))).rejects.toThrow();
    expect(limiter.currentIntervalMs).toBe(6000);
  });

  it("does the same for a runtime error carried in a 200", async () => {
    const limiter = new RateLimiter({ intervalMs: 3000 });
    const endpoint = fakeEndpoint([
      { status: 200, text: "Virtuoso 42000 Error The estimated execution time exceeds the limit" },
    ]);

    await expect(runQuery(attempt(endpoint, limiter))).rejects.toThrow();
    expect(limiter.currentIntervalMs).toBe(6000);
  });

  it("never narrows the gap on a body it could not read", async () => {
    const limiter = new RateLimiter({ intervalMs: 3000 });
    limiter.pushBack();
    limiter.pushBack();
    expect(limiter.currentIntervalMs).toBe(12_000);

    for (let n = 0; n < 3; n += 1) {
      const endpoint = fakeEndpoint([{ status: 200, text: "" }]);
      await expect(settle(runQuery(attempt(endpoint, limiter)))).rejects.toThrow();
    }
    // Three answers this client could not read are not three calm answers.
    expect(limiter.currentIntervalMs).toBeGreaterThanOrEqual(12_000);
  });

  it("still narrows the gap on a run of answers it could read", async () => {
    const limiter = new RateLimiter({ intervalMs: 3000 });
    limiter.pushBack();
    expect(limiter.currentIntervalMs).toBe(6000);

    for (let n = 0; n < 3; n += 1) {
      const endpoint = fakeEndpoint([{ fixture: "empty" }]);
      await settle(runQuery(attempt(endpoint, limiter)));
    }
    expect(limiter.currentIntervalMs).toBe(3000);
  });

  it("reads a server error as the service asking for room", async () => {
    const limiter = new RateLimiter({ intervalMs: 3000 });
    const endpoint = fakeEndpoint([{ status: 500, text: "internal" }]);

    await expect(runQuery(attempt(endpoint, limiter))).rejects.toThrow();
    expect(limiter.currentIntervalMs).toBe(6000);
  });
});

describe("what the published client entry point cannot be talked into", () => {
  it("bounds the retry budget, so one call cannot become two hundred requests", async () => {
    vi.useFakeTimers({ now: FIXED_NOW });
    try {
      const endpoint = fakeEndpoint([{ status: 502, text: "bad gateway" }]);
      const client = new BnfClient({
        config: testConfig({ maxRetries: 200 }),
        logger: silentLogger,
        fetchImpl: endpoint.fetchImpl,
      });

      const running = vi.runAllTimersAsync();
      await expect(client.searchAuthors("Ardouin", 10, 0)).rejects.toThrow();
      await running;

      // The environment path already refuses anything above eight. A caller
      // assembling a configuration object owes the BnF the same ceiling.
      expect(endpoint.requests.length).toBeLessThanOrEqual(9);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds the deadline, so a caller cannot hold the one request slot for an hour", () => {
    const client = new BnfClient({
      config: testConfig({ timeoutMs: 3_600_000 }),
      logger: silentLogger,
    });
    expect(client.timeoutMs).toBeLessThanOrEqual(300_000);
  });

  it("keeps the cache switched on when handed a size that would empty it", async () => {
    const endpoint = fakeEndpoint([{ fixture: "authors-search" }]);
    const client = new BnfClient({
      config: testConfig({ cacheMaxEntries: 0 }),
      logger: silentLogger,
      fetchImpl: endpoint.fetchImpl,
    });

    // A store that evicts what it just wrote turns off the caching that the
    // three-second floor is justified by.
    await client.searchAuthors("Ardouin", 10, 0);
    const second = await client.searchAuthors("Ardouin", 10, 0);
    expect(second.cached).toBe(true);
    expect(endpoint.requests).toHaveLength(1);
  });
});

describe("two callers asking the same question at once", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: FIXED_NOW });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("costs the endpoint one query rather than two", async () => {
    const endpoint = fakeEndpoint([{ fixture: "authors-search" }]);
    const client = new BnfClient({
      config: testConfig(),
      logger: silentLogger,
      fetchImpl: endpoint.fetchImpl,
    });

    const running = vi.runAllTimersAsync();
    const [first, second] = await Promise.all([
      client.searchAuthors("Ardouin", 10, 0),
      client.searchAuthors("Ardouin", 10, 0),
    ]);
    await running;

    expect(endpoint.requests).toHaveLength(1);
    expect(first.data).toEqual(second.data);
    expect(first.retrievedAt).toBe(second.retrievedAt);
  });

  it("lets a second caller ask again once the first one failed", async () => {
    const endpoint = fakeEndpoint([{ status: 200, text: "" }, { fixture: "authors-search" }]);
    const client = new BnfClient({
      config: testConfig(),
      logger: silentLogger,
      fetchImpl: endpoint.fetchImpl,
    });

    const running = vi.runAllTimersAsync();
    const both = await Promise.allSettled([
      client.searchAuthors("Ardouin", 10, 0),
      client.searchAuthors("Ardouin", 10, 0),
    ]);
    await running;

    expect(both.every((outcome) => outcome.status === "rejected")).toBe(true);

    // A failure shared between two callers must not be remembered as one.
    const after = vi.runAllTimersAsync();
    const retried = await client.searchAuthors("Ardouin", 10, 0);
    await after;
    expect(retried.cached).toBe(false);
  });
});
