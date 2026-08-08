/**
 * What the unit tests use instead of the network.
 *
 * Nothing here reaches data.bnf.fr. A test that did would be a test whose result
 * depends on a catalogue changing, on a service being up, and on a public
 * institution being willing to answer a test suite.
 *
 * The fake records every request it is handed, so a test can assert not only
 * what came back but what went out: which address was called, what the
 * User-Agent said, and what the query actually asked for. Several of the rules
 * this server holds are about the request rather than the answer, and this is
 * the only place they can be checked.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import type { Config } from "../../src/config.js";
import { loadConfig } from "../../src/config.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "..", "fixtures");

export function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixtureDir, `${name}.json`), "utf8"));
}

export function fixtureText(name: string): string {
  return readFileSync(join(fixtureDir, `${name}.json`), "utf8");
}

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** The query as it left this server, which is what an injection test reads. */
  query: string;
  body: string;
}

export interface FakeEndpoint {
  fetchImpl: typeof fetch;
  requests: RecordedRequest[];
  /** Every address this server tried to call, in order. */
  urls(): string[];
  /** The query sent on the nth request, counting from zero. */
  query(index?: number): string;
}

export type Reply =
  | { fixture: string }
  | { json: unknown }
  | { text: string; status?: number; headers?: Record<string, string> }
  | { status: number; headers?: Record<string, string>; text?: string }
  | { throws: Error };

/**
 * A fake endpoint answering a queued list of replies.
 *
 * The queue is consumed in order, and the last reply repeats once the queue is
 * empty, so a test exercising a retry does not have to spell out the same
 * answer three times.
 */
export function fakeEndpoint(replies: Reply[]): FakeEndpoint {
  const requests: RecordedRequest[] = [];
  let index = 0;

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : String(input);
    const body = typeof init?.body === "string" ? init.body : "";
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>).map(([key, value]) => [
        key.toLowerCase(),
        value,
      ]),
    );
    requests.push({
      url,
      method: init?.method ?? "GET",
      headers,
      query: new URLSearchParams(body).get("query") ?? "",
      body,
    });

    const reply = replies[Math.min(index, replies.length - 1)] ?? {
      json: { head: {}, results: { bindings: [] } },
    };
    index += 1;

    if ("throws" in reply) throw reply.throws;

    if ("fixture" in reply) {
      return new Response(fixtureText(reply.fixture), {
        status: 200,
        headers: { "content-type": "application/sparql-results+json" },
      });
    }
    if ("json" in reply) {
      return new Response(JSON.stringify(reply.json), {
        status: 200,
        headers: { "content-type": "application/sparql-results+json" },
      });
    }
    return new Response(reply.text ?? "", {
      status: reply.status ?? 200,
      headers: { "content-type": "text/plain", ...(reply.headers ?? {}) },
    });
  }) as typeof fetch;

  return {
    fetchImpl,
    requests,
    urls: () => requests.map((request) => request.url),
    query: (at = 0) => requests[at]?.query ?? "",
  };
}

/** Settings a test runs with, which are the shipped defaults unless overridden. */
export function testConfig(overrides: Partial<Config> = {}): Config {
  return { ...loadConfig({}), logLevel: "silent", ...overrides };
}

/** A logger that says nothing, so a test run stays readable. */
export const silentLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** The text block of a tool result, which is what many clients render. */
export function textOf(result: { content: Array<{ text: string }> }): string {
  return result.content[0]?.text ?? "";
}

/** The structured payload, asserted present so a test reads without a cast. */
export function payloadOf(result: {
  structuredContent?: Record<string, unknown>;
}): Record<string, unknown> {
  expect(result.structuredContent).toBeDefined();
  return result.structuredContent as Record<string, unknown>;
}

/** The notes a tool attached, which is where its qualifications live. */
export function notesOf(result: { structuredContent?: Record<string, unknown> }): string[] {
  return (payloadOf(result).notes ?? []) as string[];
}

/** An epoch every test that touches time is pinned to. */
export const FIXED_NOW = new Date("2026-03-14T09:15:00.000Z");
