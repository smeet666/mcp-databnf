/**
 * What a search is allowed to say about the part of the index it read.
 *
 * A text search reads a fixed window of the index and filters what came back.
 * The window is what bounds the answer, and it is read before the filter, so a
 * page holding a few dozen rows can rest on a window that was filled to its
 * last row. Two answers then look identical from the page alone: one where the
 * index had nothing more to give, and one where it had a great deal more and
 * was never asked.
 *
 * These tests hold the search tools to telling the two apart. The endpoint
 * sends the occupancy of the window alongside the rows of the page, so the fact
 * is in hand at the moment the answer is written and needs no second request.
 */

import { describe, expect, it } from "vitest";
import { BnfClient } from "../../src/bnf/client.js";
import { runSearchAuthors } from "../../src/tools/searchAuthors.js";
import { runSearchWorks } from "../../src/tools/searchWorks.js";
import { fakeEndpoint, notesOf, payloadOf, silentLogger, testConfig, textOf } from "./helpers.js";
import type { Reply } from "./helpers.js";

const on = (replies: Reply[]) => {
  const endpoint = fakeEndpoint(replies);
  return {
    endpoint,
    client: new BnfClient({
      config: testConfig(),
      logger: silentLogger,
      fetchImpl: endpoint.fetchImpl,
    }),
  };
};

describe("a search resting on a window that came back full", () => {
  it("says the window was full rather than letting the page read as the end", async () => {
    const { client } = on([{ fixture: "authors-search-saturated" }]);
    const result = await runSearchAuthors(client, { name: "Marie", limit: 2, page: 1 });

    const payload = payloadOf(result);
    // The page holds every row asked for and the endpoint sent none beyond it,
    // so this is the reading a caller who stops here actually gets.
    expect(payload.has_more).toBe(false);
    expect(payload.index_window_full).toBe(true);
    expect(notesOf(result).join(" ")).toContain("came back full");
  });

  it("says plainly that has_more being false is not the file running out", async () => {
    const { client } = on([{ fixture: "authors-search-saturated" }]);
    const result = await runSearchAuthors(client, { name: "Marie", limit: 2, page: 1 });
    expect(notesOf(result).join(" ")).toContain("'has_more' is false");
  });

  it("warns that another reading of the same search can bring back other rows", async () => {
    const { client } = on([{ fixture: "authors-search-saturated" }]);
    const result = await runSearchAuthors(client, { name: "Marie", limit: 2, page: 1 });
    expect(notesOf(result).join(" ")).toContain("another reading of the same search");
  });

  it("carries the warning into the text block a client may render alone", async () => {
    const { client } = on([{ fixture: "authors-search-saturated" }]);
    const result = await runSearchAuthors(client, { name: "Marie", limit: 2, page: 1 });
    expect(textOf(result)).toContain("came back full");
  });

  it("says it on a title search too, where the filter runs after the window", async () => {
    const { client } = on([{ fixture: "works-search-saturated" }]);
    const result = await runSearchWorks(client, { title: "amour", limit: 10, page: 1 });

    const payload = payloadOf(result);
    expect(payload.index_window_full).toBe(true);
    expect(notesOf(result).join(" ")).toContain("came back full");
  });

  it("reports no total beside the warning", async () => {
    const { client } = on([{ fixture: "works-search-saturated" }]);
    const result = await runSearchWorks(client, { title: "amour", limit: 10, page: 1 });

    const said = `${textOf(result)} ${notesOf(result).join(" ")}`;
    expect(Object.keys(payloadOf(result))).not.toContain("total");
    // The occupancy is a fact about the reading, and it is stated as one. A
    // number of rows printed beside a list of matches would be read as a count
    // of the matches, which this search does not carry.
    expect(said).not.toMatch(/\b400 (?:match|record|work|row)/);
  });

  it("spends one request on the page and its window alike", async () => {
    const { client, endpoint } = on([{ fixture: "authors-search-saturated" }]);
    await runSearchAuthors(client, { name: "Marie", limit: 2, page: 1 });
    expect(endpoint.requests).toHaveLength(1);
  });

  it("asks the endpoint for the occupancy in the query it was already sending", async () => {
    const { client, endpoint } = on([{ fixture: "authors-search-saturated" }]);
    await runSearchAuthors(client, { name: "Marie", limit: 2, page: 1 });
    expect(endpoint.query()).toContain("windowRows");
  });
});

describe("a search whose window had room to spare", () => {
  it("gains no warning, because the index was read to the end of the matches", async () => {
    const { client } = on([{ fixture: "authors-search" }]);
    const result = await runSearchAuthors(client, { name: "Ardouin", limit: 10, page: 1 });

    const said = `${textOf(result)} ${notesOf(result).join(" ")}`;
    expect(payloadOf(result).index_window_full).toBe(false);
    expect(said).not.toContain("came back full");
  });

  it("gains no warning on a title search either", async () => {
    const { client } = on([{ fixture: "works-search" }]);
    const result = await runSearchWorks(client, { title: "vent octobre", limit: 10, page: 1 });

    const said = `${textOf(result)} ${notesOf(result).join(" ")}`;
    expect(payloadOf(result).index_window_full).toBe(false);
    expect(said).not.toContain("came back full");
  });

  it("counts no row of the page against the occupancy the endpoint sent", async () => {
    const { client } = on([{ fixture: "authors-search" }]);
    const result = await runSearchAuthors(client, { name: "Ardouin", limit: 10, page: 1 });

    // The occupancy arrives as a row of its own, naming no record. It is
    // neither a row of the answer nor a row that had to be dropped.
    const authors = payloadOf(result).authors as unknown[];
    expect(authors).toHaveLength(3);
    expect(notesOf(result).join(" ")).not.toContain("could not be read");
  });
});

describe("a full window from which the filter kept nothing", () => {
  it("refuses to call it an absence from the authority file", async () => {
    const { client } = on([{ fixture: "authors-search-saturated-empty" }]);
    const result = await runSearchAuthors(client, { name: "Marie", limit: 10, page: 1 });

    const said = `${textOf(result)} ${notesOf(result).join(" ")}`;
    expect(payloadOf(result).authors).toEqual([]);
    expect(said).not.toContain("No person record in the BnF authority file carries");
    expect(said).toContain("came back full");
  });
});

describe("a page whose window the endpoint said nothing about", () => {
  it("claims neither that the window was full nor that it was not", async () => {
    const { client } = on([{ fixture: "authors-search-overflow" }]);
    const result = await runSearchAuthors(client, { name: "Ardouin", limit: 2, page: 1 });

    const said = `${textOf(result)} ${notesOf(result).join(" ")}`;
    expect(payloadOf(result).index_window_full).toBeNull();
    expect(said).not.toContain("came back full");
  });
});
