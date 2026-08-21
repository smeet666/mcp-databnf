/**
 * list_works: the works the catalogue credits one person with.
 *
 * The whole difficulty of this tool is what it is not allowed to say. The
 * catalogue links a work to its creator, so the link exists and can be walked;
 * what the catalogue does not carry is a bibliography, a genre in words, or a
 * count of anything. These tests hold the tool to reporting the link and
 * qualifying it, and to telling a page past the last row from a person the
 * catalogue credits with nothing.
 */

import { describe, expect, it } from "vitest";
import { BnfClient } from "../../src/bnf/client.js";
import { listWorksDescription, runListWorks } from "../../src/tools/listWorks.js";
import { fakeEndpoint, notesOf, payloadOf, silentLogger, testConfig, textOf } from "./helpers.js";

const client = (endpoint: ReturnType<typeof fakeEndpoint>) =>
  new BnfClient({
    config: testConfig({ minIntervalMs: 0 }),
    logger: silentLogger,
    fetchImpl: endpoint.fetchImpl,
  });

const ARDOUIN = "cb100000001";

interface Row {
  id: string;
  title: string | null;
  date: string | null;
  year: number | null;
  status: string;
  forms: string[];
  source_url: string;
}

const rowsOf = (result: { structuredContent?: Record<string, unknown> }): Row[] =>
  payloadOf(result).works as Row[];

describe("what list_works reads off the catalogue", () => {
  it("returns one row per work, whatever the number of rows the endpoint sent", async () => {
    const endpoint = fakeEndpoint([{ fixture: "author-works" }]);
    const result = await runListWorks(client(endpoint), {
      author_id: ARDOUIN,
      limit: 10,
      page: 1,
    });

    const works = rowsOf(result);
    expect(works.map((work) => work.id)).toEqual([
      "cb100000010",
      "cb100000013",
      "temp-work/b7c1d2e3f405162738495a6b7c8d9e0f",
    ]);
  });

  it("gathers the form codes of a work that carries several", async () => {
    const endpoint = fakeEndpoint([{ fixture: "author-works" }]);
    const result = await runListWorks(client(endpoint), {
      author_id: ARDOUIN,
      limit: 10,
      page: 1,
    });

    const works = rowsOf(result);
    expect(works[0]?.forms).toEqual(["te", "poesi"]);
    // A work the catalogue records no form for holds an empty list, which says
    // the genre is unrecorded rather than that the work has none.
    expect(works[1]?.forms).toEqual([]);
  });

  it("carries the date and the year the record gives the work", async () => {
    const endpoint = fakeEndpoint([{ fixture: "author-works" }]);
    const result = await runListWorks(client(endpoint), {
      author_id: ARDOUIN,
      limit: 10,
      page: 1,
    });

    expect(rowsOf(result)[0]).toMatchObject({ date: "1902", year: 1902 });
  });

  it("says which rows the BnF has settled and which it holds provisionally", async () => {
    const endpoint = fakeEndpoint([{ fixture: "author-works" }]);
    const result = await runListWorks(client(endpoint), {
      author_id: ARDOUIN,
      limit: 10,
      page: 1,
    });

    expect(rowsOf(result).map((work) => work.status)).toEqual([
      "established",
      "established",
      "provisional",
    ]);
    expect(notesOf(result).join(" ")).toContain("provisional record");
  });

  it("ends its text block with the source and the date of retrieval", async () => {
    const endpoint = fakeEndpoint([{ fixture: "author-works" }]);
    const result = await runListWorks(client(endpoint), {
      author_id: ARDOUIN,
      limit: 10,
      page: 1,
    });

    expect(textOf(result)).toContain("Source: data.bnf.fr (Bibliothèque nationale de France)");
    expect(textOf(result)).toMatch(/retrieved \d{4}-\d{2}-\d{2}/);
    expect(payloadOf(result).retrieved_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("what list_works refuses to claim", () => {
  it("reports no total, and offers the next page instead", async () => {
    const endpoint = fakeEndpoint([{ fixture: "author-works" }]);
    const result = await runListWorks(client(endpoint), { author_id: ARDOUIN, limit: 2, page: 1 });

    const payload = payloadOf(result);
    expect(Object.keys(payload)).not.toContain("total");
    expect(payload.has_more).toBe(true);
    expect(notesOf(result).join(" ")).toContain("page 2");
  });

  it("says the list holds what the catalogue links, and is not a bibliography", async () => {
    const endpoint = fakeEndpoint([{ fixture: "author-works" }]);
    const result = await runListWorks(client(endpoint), {
      author_id: ARDOUIN,
      limit: 10,
      page: 1,
    });

    const notes = notesOf(result).join(" ");
    expect(notes).toContain("as the creator");
    expect(notes).toContain("not a bibliography");
  });

  it("says the form codes carry no label, and that a work carrying none has an unstated form", async () => {
    const endpoint = fakeEndpoint([{ fixture: "author-works" }]);
    const result = await runListWorks(client(endpoint), {
      author_id: ARDOUIN,
      limit: 10,
      page: 1,
    });

    const notes = notesOf(result).join(" ");
    expect(notes).toContain("no label");
    // What a missing code means is the claim the catalogue supports: a work
    // stating no form is a work whose form is unstated, so selecting on a code
    // reaches the works that declare it and no others.
    expect(notes).toContain("does not state");
    expect(notes).toContain("never all the works of that form");
    // Some of the terms are words a reader can read, so denying that any of
    // them can be read says more than the vocabulary does.
    expect(notes).not.toContain("cannot be narrowed");
    expect(listWorksDescription).not.toContain("cannot be narrowed to a genre");
    expect(listWorksDescription).toContain("never all the works of that form");
  });

  it("says where a date comes from and what it dates", async () => {
    const endpoint = fakeEndpoint([{ fixture: "author-works" }]);
    const result = await runListWorks(client(endpoint), {
      author_id: ARDOUIN,
      limit: 10,
      page: 1,
    });

    const notes = notesOf(result).join(" ");
    expect(notes).toContain("date of the work");
    expect(notes).toContain("list_editions");
  });

  it("says the order is the catalogue's and is neither chronological nor by importance", async () => {
    const endpoint = fakeEndpoint([{ fixture: "author-works" }]);
    const result = await runListWorks(client(endpoint), {
      author_id: ARDOUIN,
      limit: 10,
      page: 1,
    });

    const notes = notesOf(result).join(" ");
    expect(notes).toContain("neither chronological nor an order of importance");
  });

  it("counts a row it could not read, so a short page is not read as a small catalogue", async () => {
    const endpoint = fakeEndpoint([{ fixture: "author-works" }]);
    const result = await runListWorks(client(endpoint), {
      author_id: ARDOUIN,
      limit: 10,
      page: 1,
    });

    expect(notesOf(result).join(" ")).toContain("could not be read");
  });
});

describe("a page of list_works holding no row", () => {
  it("tells a person the catalogue credits with nothing from a record it does not describe", async () => {
    const endpoint = fakeEndpoint([{ fixture: "author-works-empty" }, { fixture: "types-person" }]);
    const result = await runListWorks(client(endpoint), {
      author_id: ARDOUIN,
      limit: 10,
      page: 1,
    });

    expect(result.isError).toBeUndefined();
    expect(rowsOf(result)).toEqual([]);
    const notes = notesOf(result).join(" ");
    expect(notes).toContain("links no work");
    // The absence belongs to the link, not to the person's writing life.
    expect(notes).toContain("as the creator");
  });

  it("points at the other authority records a person can hold", async () => {
    const endpoint = fakeEndpoint([{ fixture: "author-works-empty" }, { fixture: "types-person" }]);
    const result = await runListWorks(client(endpoint), {
      author_id: ARDOUIN,
      limit: 10,
      page: 1,
    });

    // The link hangs off a record, and the BnF keeps more than one record for
    // some people. An empty list on one of them says nothing about the others,
    // so the answer names the way to find them.
    const notes = notesOf(result).join(" ");
    expect(notes).toContain("more than one authority record");
    expect(notes).toContain("search_authors");
  });

  it("answers an identifier the BnF describes nowhere with an absence", async () => {
    const endpoint = fakeEndpoint([{ fixture: "author-works-empty" }, { fixture: "types-empty" }]);
    const result = await runListWorks(client(endpoint), {
      author_id: "cb100000404",
      limit: 10,
      page: 1,
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("[not_found]");
    expect(textOf(result)).toContain("describes nothing");
  });

  it("says what a record is when it is not a person, rather than reporting no works", async () => {
    const endpoint = fakeEndpoint([{ fixture: "author-works-empty" }, { fixture: "types-work" }]);
    const result = await runListWorks(client(endpoint), {
      author_id: "cb100000010",
      limit: 10,
      page: 1,
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("[not_found]");
    expect(textOf(result)).toContain("not a person");
    expect(textOf(result)).toContain("list_editions");
  });

  it("tells a page past the last row from a person credited with nothing", async () => {
    const endpoint = fakeEndpoint([{ fixture: "author-works-empty" }, { fixture: "author-works" }]);
    const result = await runListWorks(client(endpoint), { author_id: ARDOUIN, limit: 10, page: 4 });

    expect(result.isError).toBeUndefined();
    const notes = notesOf(result).join(" ");
    expect(notes).toContain("past the last row");
    expect(notes).toContain("page=1");
    expect(notes).not.toContain("links no work");
  });

  it("says so when reading the first page to find out why did not answer", async () => {
    const endpoint = fakeEndpoint([
      { fixture: "author-works-empty" },
      { text: "the endpoint answered with something that is not a result set" },
    ]);
    const result = await runListWorks(client(endpoint), { author_id: ARDOUIN, limit: 10, page: 3 });

    expect(result.isError).toBeUndefined();
    expect(notesOf(result).join(" ")).toContain("could not be read");
    expect(notesOf(result).join(" ")).toContain("page=1");
  });
});

describe("the query list_works sends", () => {
  it("pages over works rather than over rows, in an order that holds between pages", async () => {
    const endpoint = fakeEndpoint([{ fixture: "author-works" }]);
    await runListWorks(client(endpoint), { author_id: ARDOUIN, limit: 10, page: 3 });

    const query = endpoint.query();
    expect(query).toContain("SELECT DISTINCT ?work");
    expect(query).toContain("ORDER BY ?work");
    expect(query).toContain("LIMIT 11 OFFSET 20");
  });

  it("binds the person by an address it rebuilt from the identifier", async () => {
    const endpoint = fakeEndpoint([{ fixture: "author-works" }]);
    await runListWorks(client(endpoint), {
      author_id: "https://data.bnf.fr/ark:/12148/CB100000001",
      limit: 10,
      page: 1,
    });

    expect(endpoint.query()).toContain("<http://data.bnf.fr/ark:/12148/cb100000001#about>");
  });

  it("refuses an identifier that is not one rather than putting it in a query", async () => {
    const endpoint = fakeEndpoint([{ fixture: "author-works" }]);
    const result = await runListWorks(client(endpoint), {
      author_id:
        "cb100000001> ?p ?o } INSERT { <http://evil.example/> <http://evil.example/> 1 } #",
      limit: 10,
      page: 1,
    });

    expect(textOf(result)).toContain("[invalid_input]");
    expect(endpoint.requests).toHaveLength(0);
  });

  it("asks data.bnf.fr and nowhere else", async () => {
    const endpoint = fakeEndpoint([{ fixture: "author-works" }]);
    await runListWorks(client(endpoint), { author_id: ARDOUIN, limit: 10, page: 1 });

    for (const url of endpoint.urls()) {
      expect(url).toBe("https://data.bnf.fr/sparql");
    }
  });
});
