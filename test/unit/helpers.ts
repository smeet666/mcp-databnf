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

/** The address a fetch was called with, whichever of the three shapes it took. */
function addressOf(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return String(input);
}

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
  urls: () => string[];
  /** The query sent on the nth request, counting from zero. */
  query: (index?: number) => string;
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
    const url = addressOf(input);
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

    if ("throws" in reply) {
      throw reply.throws;
    }

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

/**
 * An endpoint that answers from a corpus, the way a SPARQL service answers.
 *
 * A queued reply cannot exercise paging, because it hands back the same rows
 * whatever the query asked for. This one reads the LIMIT and the OFFSET out of
 * the paging subquery and cuts the corpus itself, so a test can walk page after
 * page and see what a caller would see.
 *
 * It holds the one property of SPARQL that paging depends on: a query whose
 * outermost form carries no ORDER BY has no order, and the service is free to
 * send the rows of a solution set in any sequence at all. So the rows of a page
 * come back scrambled unless the query asks for an order, and the scramble is
 * fixed rather than drawn, because a test that only fails sometimes is a test
 * that reports nothing.
 *
 * The subquery's own ORDER BY is honoured, since that is what decides which
 * entities a page is made of.
 */
export interface CatalogueEndpoint extends FakeEndpoint {
  /** Every identifier the corpus holds, in the order the endpoint pages them. */
  corpusOrder: () => string[];
}

export function catalogueEndpoint(entityIris: readonly string[]): CatalogueEndpoint {
  const requests: RecordedRequest[] = [];
  const sorted = [...entityIris].sort();

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = addressOf(input);
    const body = typeof init?.body === "string" ? init.body : "";
    const query = new URLSearchParams(body).get("query") ?? "";
    requests.push({
      url,
      method: init?.method ?? "GET",
      headers: Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>).map(([key, value]) => [
          key.toLowerCase(),
          value,
        ]),
      ),
      query,
      body,
    });

    return new Response(JSON.stringify(answer(sorted, query)), {
      status: 200,
      headers: { "content-type": "application/sparql-results+json" },
    });
  }) as typeof fetch;

  return {
    fetchImpl,
    requests,
    urls: () => requests.map((request) => request.url),
    query: (at = 0) => requests[at]?.query ?? "",
    corpusOrder: () => sorted.map((iri) => iri.replace(/^.*\/([^/#]+)(?:#.*)?$/, "$1")),
  };
}

/** The paging subquery of a listing query, read back off the text sent. */
const PAGING_SUBQUERY = /SELECT DISTINCT \?(\w+)[\s\S]*?LIMIT (\d+) OFFSET (\d+)/;

/**
 * True when the outermost query asks for an order.
 *
 * What follows the last closing brace is what the outer form carries after its
 * WHERE clause, so an ORDER BY there is the one that governs the rows sent.
 */
function outerIsOrdered(query: string): boolean {
  return /ORDER BY/.test(query.slice(query.lastIndexOf("}")));
}

/**
 * The rows of one page, arranged the way the query entitles the service to.
 *
 * The scramble swaps the last two entities of the page. It is the shape the
 * live endpoint produces: the entity a client meant to keep is sent where the
 * entity it meant to drop was expected.
 */
function answer(sorted: readonly string[], query: string): unknown {
  const paging = PAGING_SUBQUERY.exec(query);
  if (!paging) {
    return { head: { vars: [] }, results: { bindings: [] } };
  }

  const [, variable = "entity", limitText = "0", offsetText = "0"] = paging;
  const take = Number(limitText);
  const skip = Number(offsetText);

  const window = sorted.slice(skip, skip + take);
  const arranged = [...window];
  if (!outerIsOrdered(query) && arranged.length >= 2) {
    const last = arranged.length - 1;
    [arranged[last - 1], arranged[last]] = [arranged[last]!, arranged[last - 1]!];
  }

  const bindings: Record<string, { type: string; value: string }>[] = [];
  for (const iri of arranged) {
    const row = {
      [variable]: { type: "uri", value: iri },
      title: { type: "literal", value: `Record ${iri.replace(/^.*\//, "")}` },
      name: { type: "literal", value: `Record ${iri.replace(/^.*\//, "")}` },
    };
    // One entity described by two rows, which is what a record carrying two
    // form codes or two digitised copies sends. A page is a page of entities.
    bindings.push(row, ...(iri === arranged[0] ? [row] : []));
  }

  return { head: { vars: [variable, "title", "name"] }, results: { bindings } };
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
