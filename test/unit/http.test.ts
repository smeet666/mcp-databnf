/**
 * What each way of failing is called.
 *
 * The endpoint has three ways of saying no and they mean different things. It
 * answers 400 with a compiler message when it cannot read the query. It answers
 * 200 with a plain-text runtime message when it started the query and gave it
 * up. And it answers 200 with an empty body when it abandoned the query part
 * way through, which looks exactly like a result set holding no rows and means
 * the opposite.
 *
 * That last one is the reason this file exists. Reading an empty body as an
 * empty result would let this server report "the BnF describes none of these"
 * on the strength of a query nobody ever finished.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BnfError } from "../../src/errors.js";
import { parseResults, parseRetryAfter, readEngineError, runQuery } from "../../src/bnf/http.js";
import { RateLimiter } from "../../src/bnf/rateLimiter.js";
import { fakeEndpoint, fixtureText, silentLogger, FIXED_NOW } from "./helpers.js";

const options = (endpoint: ReturnType<typeof fakeEndpoint>, maxRetries = 0) => ({
  query: "SELECT ?s WHERE { ?s ?p ?o } LIMIT 1",
  userAgent: "mcp-databnf/test",
  timeoutMs: 5000,
  maxRetries,
  limiter: new RateLimiter({ intervalMs: 0 }),
  logger: silentLogger,
  fetchImpl: endpoint.fetchImpl,
});

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
    return "no error";
  } catch (error) {
    return error instanceof BnfError ? error.code : `not a BnfError: ${String(error)}`;
  }
};

describe("reading a body that arrived with a success status", () => {
  it("refuses an empty body rather than reading it as no results", async () => {
    expect(() => parseResults("")).toThrowError(/empty body/i);
    expect(() => parseResults("   \n ")).toThrowError(/empty body/i);
    const endpoint = fakeEndpoint([{ status: 200, text: "" }]);
    expect(await codeOf(runQuery(options(endpoint)))).toBe("parse_failure");
  });

  it("reads a result set holding no rows as an absence, which is a real answer", () => {
    const parsed = parseResults(fixtureText("empty"));
    expect(parsed.results.bindings).toEqual([]);
  });

  it("tells a compiler refusal from a query the engine gave up on", () => {
    expect(readEngineError("Virtuoso 37000 Error SP031: SPARQL compiler: bad")).toEqual({
      kind: "compile",
      text: "SP031: SPARQL compiler: bad",
    });
    expect(readEngineError("Virtuoso 42000 Error The estimated execution time exceeds")).toEqual({
      kind: "runtime",
      text: "The estimated execution time exceeds",
    });
    expect(readEngineError('{ "head": {} }')).toBeNull();
  });

  it("calls a query the engine could not read an invalid input", async () => {
    const endpoint = fakeEndpoint([
      { status: 200, text: "Virtuoso 37000 Error SP031: SPARQL compiler: bad" },
    ]);
    expect(await codeOf(runQuery(options(endpoint)))).toBe("invalid_input");
  });

  it("calls a query the engine gave up on a timeout, since asking again may work", async () => {
    const endpoint = fakeEndpoint([
      { status: 200, text: "Virtuoso 42000 Error The estimated execution time exceeds the limit" },
    ]);
    expect(await codeOf(runQuery(options(endpoint)))).toBe("timeout");
  });

  it("refuses JSON that is not a result set", async () => {
    expect(() => parseResults(fixtureText("not-a-result-set"))).toThrowError(
      /not a SPARQL result/i,
    );
    expect(() => parseResults("not json at all")).toThrowError(/not JSON/i);
    expect(() => parseResults("null")).toThrowError(/not a SPARQL result/i);
  });
});

describe("statuses", () => {
  it("calls a refused query an invalid input rather than a network failure", async () => {
    const endpoint = fakeEndpoint([{ status: 400, text: "Virtuoso 37000 Error SP030: syntax" }]);
    expect(await codeOf(runQuery(options(endpoint)))).toBe("invalid_input");
  });

  it("calls a push-back a rate limit, and says nothing about what was asked for", async () => {
    const endpoint = fakeEndpoint([{ status: 429 }]);
    try {
      await runQuery(options(endpoint));
      expect.unreachable();
    } catch (error) {
      const known = error as BnfError;
      expect(known.code).toBe("rate_limited");
      expect(known.details.hint).toMatch(/says nothing about whether/i);
    }
  });

  it("reports a wait longer than it is willing to sleep through, rather than sleeping", async () => {
    const endpoint = fakeEndpoint([{ status: 503, headers: { "retry-after": "3600" } }]);
    try {
      await runQuery(options(endpoint, 3));
      expect.unreachable();
    } catch (error) {
      expect((error as BnfError).code).toBe("rate_limited");
      expect((error as BnfError).message).toContain("3600 seconds");
    }
    // One attempt, and no hour spent holding the single request slot.
    expect(endpoint.requests).toHaveLength(1);
  });

  it("calls any other refusal a network failure", async () => {
    const endpoint = fakeEndpoint([{ status: 418, text: "no" }]);
    expect(await codeOf(runQuery(options(endpoint)))).toBe("network_error");
  });
});

describe("retries", () => {
  it("tries again on a busy service, up to the budget", async () => {
    const endpoint = fakeEndpoint([
      { status: 502, text: "bad gateway" },
      { status: 502, text: "bad gateway" },
      { fixture: "empty" },
    ]);
    const parsed = await runQuery(options(endpoint, 3));
    expect(parsed.results.bindings).toEqual([]);
    expect(endpoint.requests).toHaveLength(3);
  });

  it("does not try again on an answer the service meant", async () => {
    const endpoint = fakeEndpoint([{ status: 400, text: "Virtuoso 37000 Error SP030: syntax" }]);
    await codeOf(runQuery(options(endpoint, 3)));
    expect(endpoint.requests).toHaveLength(1);
  });

  it("obeys the wait a refusal names rather than guessing one", () => {
    const now = FIXED_NOW.getTime();
    expect(parseRetryAfter("12")).toBe(12_000);
    expect(parseRetryAfter("0")).toBe(0);
    expect(parseRetryAfter(new Date(now + 5000).toUTCString(), now)).toBe(5000);
    // A date already past asks for no wait at all rather than a negative one.
    expect(parseRetryAfter(new Date(now - 5000).toUTCString(), now)).toBe(0);
    expect(parseRetryAfter("soon")).toBeNull();
    expect(parseRetryAfter(null)).toBeNull();
  });
});

describe("what goes out", () => {
  it("sends the query in the body of a POST, not in the address", async () => {
    const endpoint = fakeEndpoint([{ fixture: "empty" }]);
    await runQuery(options(endpoint));
    const request = endpoint.requests[0]!;

    expect(request.method).toBe("POST");
    expect(request.url).toBe("https://data.bnf.fr/sparql");
    expect(new URL(request.url).search).toBe("");
    expect(request.query).toContain("SELECT");
  });

  it("asks for the result format in the request as well as in the header", async () => {
    // The endpoint answers in XML when only the header asks for JSON.
    const endpoint = fakeEndpoint([{ fixture: "empty" }]);
    await runQuery(options(endpoint));
    const request = endpoint.requests[0]!;
    expect(new URLSearchParams(request.body).get("format")).toBe("application/sparql-results+json");
    expect(request.headers.accept).toBe("application/sparql-results+json");
  });

  it("carries the User-Agent it was given", async () => {
    const endpoint = fakeEndpoint([{ fixture: "empty" }]);
    await runQuery(options(endpoint));
    expect(endpoint.requests[0]!.headers["user-agent"]).toBe("mcp-databnf/test");
  });
});

describe("a deadline", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: FIXED_NOW });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives up on silence and calls it a timeout", async () => {
    const abortError = Object.assign(new Error("aborted"), { name: "AbortError" });
    const endpoint = fakeEndpoint([{ throws: abortError }]);
    // codeOf wraps the call before the clock moves. Advancing it first would let
    // the rejection land while nothing is watching, which Node reports as an
    // unhandled rejection and vitest counts against the run.
    const code = codeOf(runQuery(options(endpoint, 0)));
    await vi.runAllTimersAsync();
    expect(await code).toBe("timeout");
  });

  it("repeats a query that never answered at most once", async () => {
    const abortError = Object.assign(new Error("aborted"), { name: "AbortError" });
    const endpoint = fakeEndpoint([{ throws: abortError }]);
    const code = codeOf(runQuery(options(endpoint, 5)));
    await vi.runAllTimersAsync();
    await code;
    // Repeating a query the planner is struggling with adds the same load again.
    expect(endpoint.requests).toHaveLength(2);
  });
});
