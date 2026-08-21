/**
 * What paging through a listing is allowed to leave out, and to repeat.
 *
 * Every tool here cuts a page in a subquery and then reads columns off the
 * entities that page holds. The subquery decides which entities a page is made
 * of; the outer query decides the sequence the rows arrive in. A page is built
 * by taking one row more than was asked for, so that the extra row answers
 * whether more exist, and then dropping it. Which row gets dropped is the row
 * that arrived last, so the sequence the endpoint is free to choose decides
 * which entity a caller never sees.
 *
 * These tests walk every page of one listing and hold the walk to two things: a
 * caller reading page after page meets each entity once, and meets all of them.
 * The endpoint they read answers the way SPARQL entitles a service to answer,
 * sending the rows of an unordered query in a sequence of its own.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BnfClient } from "../../src/bnf/client.js";
import { runListEditions } from "../../src/tools/listEditions.js";
import { runListWorks } from "../../src/tools/listWorks.js";
import { runSearchAuthors } from "../../src/tools/searchAuthors.js";
import { runSearchWorks } from "../../src/tools/searchWorks.js";
import type { ToolResult } from "../../src/tools/shared.js";
import { FIXED_NOW, catalogueEndpoint, payloadOf, silentLogger, testConfig } from "./helpers.js";

// Reading page after page costs one interval of the pacing per page, and the
// pacing has a floor no configuration lowers. The clock is driven rather than
// waited on, so the walk runs at the speed of the test and not of the rule.
beforeEach(() => {
  vi.useFakeTimers({ now: FIXED_NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

/** Eleven records, which is two full pages of four and a short third. */
const CORPUS = Array.from(
  { length: 11 },
  (_, index) =>
    `http://data.bnf.fr/ark:/12148/cb2000000${String(index + 1).padStart(2, "0")}#about`,
);

const client = (endpoint: ReturnType<typeof catalogueEndpoint>) =>
  new BnfClient({
    config: testConfig({ minIntervalMs: 0, cacheTtlMs: 0 }),
    logger: silentLogger,
    fetchImpl: endpoint.fetchImpl,
  });

interface Listing {
  name: string;
  /** Where the rows land in the structured payload. */
  key: "authors" | "works" | "editions";
  run: (client: BnfClient, limit: number, page: number) => Promise<ToolResult>;
}

const LISTINGS: Listing[] = [
  {
    name: "search_authors",
    key: "authors",
    run: (bnf, limit, page) => runSearchAuthors(bnf, { name: "ardouin", limit, page }),
  },
  {
    name: "search_works",
    key: "works",
    run: (bnf, limit, page) => runSearchWorks(bnf, { title: "ardouin", limit, page }),
  },
  {
    name: "list_works",
    key: "works",
    run: (bnf, limit, page) => runListWorks(bnf, { author_id: "cb100000001", limit, page }),
  },
  {
    name: "list_editions",
    key: "editions",
    run: (bnf, limit, page) => runListEditions(bnf, { work_id: "cb100000010", limit, page }),
  },
];

const idsOf = (result: ToolResult, key: Listing["key"]): string[] =>
  (payloadOf(result)[key] as Array<{ id: string }>).map((row) => row.id);

/** Every page of one listing, read the way a caller reads them. */
async function walk(listing: Listing, limit: number): Promise<string[]> {
  const endpoint = catalogueEndpoint(CORPUS);
  const bnf = client(endpoint);

  const reading = (async () => {
    const seen: string[] = [];
    for (let page = 1; page <= 20; page += 1) {
      const result = await listing.run(bnf, limit, page);
      expect(result.isError).toBeUndefined();
      seen.push(...idsOf(result, listing.key));
      if (payloadOf(result).has_more !== true) {
        return seen;
      }
    }
    throw new Error(`${listing.name} never reported the end of the listing`);
  })();

  await vi.runAllTimersAsync();
  return reading;
}

describe.each(LISTINGS)("paging through $name", (listing) => {
  it("shows no entity on two pages", async () => {
    const seen = await walk(listing, 4);
    expect(seen).toEqual([...new Set(seen)]);
  });

  it("leaves no entity out of the walk", async () => {
    const endpoint = catalogueEndpoint(CORPUS);
    const seen = await walk(listing, 4);
    expect([...seen].sort()).toEqual(endpoint.corpusOrder());
  });

  it("reaches as many entities as one large page holds", async () => {
    const wholeList = await walk(listing, 50);
    const paged = await walk(listing, 4);
    expect(paged).toHaveLength(wholeList.length);
  });

  it("opens with the same rows whatever the size of the page", async () => {
    const wholeList = await walk(listing, 50);
    const firstOfFour = (await walk(listing, 4)).slice(0, 4);
    expect(firstOfFour).toEqual(wholeList.slice(0, 4));
  });
});

describe.each(LISTINGS)("the query $name sends", (listing) => {
  it("asks for the rows in an order, so the row it drops is the one it means to", async () => {
    const endpoint = catalogueEndpoint(CORPUS);
    const running = listing.run(client(endpoint), 4, 1);
    await vi.runAllTimersAsync();
    await running;

    const query = endpoint.query();
    const afterTheWhereClause = query.slice(query.lastIndexOf("}"));
    expect(afterTheWhereClause).toMatch(/ORDER BY/);
  });
});
