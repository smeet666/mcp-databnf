/**
 * Settings, and what happens to one that cannot be read.
 *
 * A typo in one variable must not take away every tool, and it must not take
 * effect either. A value outside its range is refused and named on stderr,
 * rather than clamped: clamping lets a caller believe a setting took effect when
 * the opposite is true.
 */

import process from "node:process";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_INTERVAL_MS,
  DEFAULT_TIMEOUT_MS,
  MAX_ALLOWED_INTERVAL_MS,
  MIN_ALLOWED_INTERVAL_MS,
  createLogger,
  loadConfig,
} from "../../src/config.js";

/** Read settings without letting the process environment leak into a test. */
const load = (env: Record<string, string> = {}) => loadConfig(env as NodeJS.ProcessEnv);

describe("the defaults", () => {
  it("are the ones the documentation names", () => {
    const config = load();
    expect(config.minIntervalMs).toBe(DEFAULT_INTERVAL_MS);
    expect(config.minIntervalMs).toBe(3000);
    expect(config.timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
    expect(config.maxRetries).toBe(3);
    expect(config.cacheTtlMs).toBe(900_000);
    expect(config.cacheMaxEntries).toBe(200);
    expect(config.logLevel).toBe("error");
  });

  it("carry a User-Agent naming the project and an address to reach a person", () => {
    const agent = load().userAgent;
    expect(agent).toMatch(/^mcp-databnf\/\d+\.\d+\.\d+/);
    expect(agent).toContain("https://github.com/smeet666/mcp-databnf");
  });

  it("start at the floor, so the shipped pace is the cautious one", () => {
    expect(DEFAULT_INTERVAL_MS).toBe(MIN_ALLOWED_INTERVAL_MS);
  });
});

describe("a setting that can be read", () => {
  it("is applied", () => {
    const config = load({
      BNF_MIN_INTERVAL_MS: "9000",
      BNF_TIMEOUT_MS: "20000",
      BNF_MAX_RETRIES: "1",
      BNF_CACHE_TTL_MS: "0",
      BNF_LOG_LEVEL: "debug",
    });
    expect(config.minIntervalMs).toBe(9000);
    expect(config.timeoutMs).toBe(20_000);
    expect(config.maxRetries).toBe(1);
    expect(config.cacheTtlMs).toBe(0);
    expect(config.logLevel).toBe("debug");
  });

  it("keeps the project identifier when a caller names themselves", () => {
    const agent = load({ BNF_USER_AGENT: "acme-reader/2.0 (+mailto:a@b.example)" }).userAgent;
    expect(agent).toContain("acme-reader/2.0");
    expect(agent).toContain("https://github.com/smeet666/mcp-databnf");
  });
});

describe("a setting that cannot be read", () => {
  it("falls back rather than taking effect", () => {
    expect(load({ BNF_MIN_INTERVAL_MS: "fast" }).minIntervalMs).toBe(DEFAULT_INTERVAL_MS);
    expect(load({ BNF_MIN_INTERVAL_MS: "3.5" }).minIntervalMs).toBe(DEFAULT_INTERVAL_MS);
    expect(load({ BNF_MAX_RETRIES: "" }).maxRetries).toBe(3);
    expect(load({ BNF_LOG_LEVEL: "verbose" }).logLevel).toBe("error");
  });

  it("refuses a spacing under the floor rather than clamping it", () => {
    // Clamping would leave a caller believing they had set 100ms and been
    // obeyed. The refusal is stated on stderr and the default stands.
    expect(load({ BNF_MIN_INTERVAL_MS: "100" }).minIntervalMs).toBe(DEFAULT_INTERVAL_MS);
    expect(load({ BNF_MIN_INTERVAL_MS: String(MIN_ALLOWED_INTERVAL_MS) }).minIntervalMs).toBe(
      MIN_ALLOWED_INTERVAL_MS,
    );
  });

  it("refuses a spacing so wide the server would look hung", () => {
    expect(load({ BNF_MIN_INTERVAL_MS: String(MAX_ALLOWED_INTERVAL_MS + 1) }).minIntervalMs).toBe(
      DEFAULT_INTERVAL_MS,
    );
  });

  it("does not stop the server over one unreadable value", () => {
    const config = load({ BNF_MIN_INTERVAL_MS: "nonsense", BNF_TIMEOUT_MS: "20000" });
    expect(config.minIntervalMs).toBe(DEFAULT_INTERVAL_MS);
    expect(config.timeoutMs).toBe(20_000);
  });
});

describe("the log", () => {
  it("writes nothing at all when it is silent", () => {
    const written: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      const logger = createLogger("silent");
      logger.error("nothing");
      logger.warn("nothing");
      logger.debug("nothing");
    } finally {
      process.stderr.write = original;
    }
    expect(written).toEqual([]);
  });

  it("lets a warning through at the default level, because a caller has to see it", () => {
    const written: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      const logger = createLogger("error");
      logger.warn("rows were dropped");
      logger.info("routine");
    } finally {
      process.stderr.write = original;
    }
    expect(written.join("")).toContain("rows were dropped");
    expect(written.join("")).not.toContain("routine");
  });
});
