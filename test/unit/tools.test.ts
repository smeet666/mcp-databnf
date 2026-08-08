/**
 * What each tool says, and what it refuses to say.
 *
 * These run the tools end to end against fixed result sets, so an assertion here
 * is about the answer a caller receives rather than about an internal shape.
 */

import { describe, expect, it } from "vitest";
import { BnfClient } from "../../src/bnf/client.js";
import { runFindDigitised } from "../../src/tools/findDigitised.js";
import { runGetAuthor } from "../../src/tools/getAuthor.js";
import { runGetWork } from "../../src/tools/getWork.js";
import { runListEditions } from "../../src/tools/listEditions.js";
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

describe("search_authors", () => {
  it("returns every record carrying the name and points out that some share it", async () => {
    const { client } = on([{ fixture: "authors-search" }]);
    const result = await runSearchAuthors(client, { name: "Ardouin", limit: 10, page: 1 });

    const authors = payloadOf(result).authors as Array<{ id: string }>;
    expect(authors.map((author) => author.id)).toEqual([
      "cb100000001",
      "cb100000002",
      "cb100000003",
    ]);
    expect(notesOf(result).join(" ")).toContain('2 records are named "camille ardouin"');
  });

  it("says the rows are not ranked", async () => {
    const { client } = on([{ fixture: "authors-search" }]);
    const result = await runSearchAuthors(client, { name: "Ardouin", limit: 10, page: 1 });
    expect(notesOf(result).join(" ")).toContain("does not score how well");
  });

  it("reports the words the index was asked for, once punctuation was set aside", async () => {
    const { client } = on([{ fixture: "authors-search" }]);
    const result = await runSearchAuthors(client, {
      name: "Ardouin, Camille (1871-1933)",
      limit: 10,
      page: 1,
    });
    // The comma and the brackets are separators; the hyphen inside "1871-1933"
    // is not, because it is the same hyphen that holds "Charleville-Mézières"
    // together and nothing distinguishes the two before the index sees them.
    expect(payloadOf(result).words_searched).toEqual(["Ardouin", "Camille", "1871-1933"]);
  });

  it("calls an empty answer an absence and says what would widen it", async () => {
    const { client } = on([{ fixture: "empty" }]);
    const result = await runSearchAuthors(client, { name: "Nobody", limit: 10, page: 1 });

    expect(result.isError).toBeUndefined();
    expect(payloadOf(result).authors).toEqual([]);
    expect(notesOf(result).join(" ")).toContain("A search here reads names");
  });

  it("refuses a name holding no word rather than searching for nothing", async () => {
    const { client, endpoint } = on([{ fixture: "empty" }]);
    const result = await runSearchAuthors(client, { name: "?!?", limit: 10, page: 1 });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("[invalid_input]");
    expect(endpoint.requests).toHaveLength(0);
  });

  it("says more exist rather than reporting a total it did not count", async () => {
    const { client } = on([{ fixture: "authors-search-overflow" }]);
    const result = await runSearchAuthors(client, { name: "Ardouin", limit: 2, page: 1 });

    const payload = payloadOf(result);
    expect(payload.has_more).toBe(true);
    expect(Object.keys(payload)).not.toContain("total");
    expect(notesOf(result).join(" ")).toContain("reports no total");
  });
});

describe("get_author", () => {
  it("says what the biographical field actually holds", async () => {
    const { client } = on([{ fixture: "author-detail" }]);
    const result = await runGetAuthor(client, {
      author_id: "cb100000001",
      include_depictions: false,
    });

    expect(notesOf(result).join(" ")).toContain("occupation rather than a life");
    const author = payloadOf(result).author as Record<string, unknown>;
    expect(author.biographical_information).toBe("Poète");
  });

  it("says a missing date of death is a silence rather than a fact", async () => {
    const { client } = on([{ fixture: "author-living" }]);
    const result = await runGetAuthor(client, {
      author_id: "cb100000004",
      include_depictions: false,
    });
    expect(notesOf(result).join(" ")).toContain("has not recorded one");
  });

  it("counts the images without returning them unless asked", async () => {
    const { client } = on([{ fixture: "author-detail" }]);
    const quiet = await runGetAuthor(client, {
      author_id: "cb100000001",
      include_depictions: false,
    });
    expect(payloadOf(quiet).depiction_count).toBe(2);
    expect(payloadOf(quiet).depictions).toBeUndefined();

    const { client: second } = on([{ fixture: "author-detail" }]);
    const full = await runGetAuthor(second, {
      author_id: "cb100000001",
      include_depictions: true,
    });
    expect((payloadOf(full).depictions as unknown[]).length).toBe(2);
  });

  it("points at the alignments as the way to a biography it does not hold", async () => {
    const { client } = on([{ fixture: "author-detail" }]);
    const result = await runGetAuthor(client, {
      author_id: "cb100000001",
      include_depictions: false,
    });
    expect(notesOf(result).join(" ")).toContain("this catalogue does not hold");
  });

  it("names an address the BnF describes as something other than a person", async () => {
    const { client } = on([{ fixture: "work-untitled" }, { fixture: "types-work" }]);
    const result = await runGetAuthor(client, {
      author_id: "cb100000010",
      include_depictions: false,
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("[not_found]");
    expect(textOf(result)).toContain("it is not a person");
    expect(textOf(result)).toContain("get_work");
  });

  it("separates a record that is not there from one that is something else", async () => {
    const { client } = on([{ fixture: "work-untitled" }, { fixture: "types-empty" }]);
    const result = await runGetAuthor(client, {
      author_id: "cb100000099",
      include_depictions: false,
    });
    expect(textOf(result)).toContain("describes nothing at");
  });
});

describe("search_works", () => {
  it("keeps a study and the work it studies side by side, and says which is which", async () => {
    const { client } = on([{ fixture: "works-search" }]);
    const result = await runSearchWorks(client, { title: "vent octobre", limit: 10, page: 1 });

    const works = payloadOf(result).works as Array<{ id: string; status: string }>;
    // The study comes first, which is what the index returned. Reordering it
    // would be this server inventing a judgement the catalogue does not carry.
    expect(works[0]!.status).toBe("provisional");
    expect(works.find((work) => work.id === "cb100000010")!.status).toBe("established");
    expect(notesOf(result).join(" ")).toContain("does not score how well");
  });

  it("explains what a provisional record is when one appears", async () => {
    const { client } = on([{ fixture: "works-search" }]);
    const result = await runSearchWorks(client, { title: "vent octobre", limit: 10, page: 1 });
    expect(notesOf(result).join(" ")).toContain("not yet established as a work of its own");
  });

  it("says every word has to appear when nothing matches", async () => {
    const { client } = on([{ fixture: "empty" }]);
    const result = await runSearchWorks(client, { title: "vent octobre", limit: 10, page: 1 });
    expect(notesOf(result).join(" ")).toContain("dropping one widens the search");
  });
});

describe("get_work", () => {
  it("names the identifier to cite on an established record", async () => {
    const { client } = on([{ fixture: "work-detail" }]);
    const result = await runGetWork(client, { work_id: "cb100000010", include_depictions: false });

    expect(notesOf(result).join(" ")).toContain("That identifier is the one to cite.");
    expect((payloadOf(result).work as Record<string, unknown>).status).toBe("established");
  });

  it("warns that a provisional identifier can change", async () => {
    const { client } = on([{ fixture: "work-provisional" }]);
    const result = await runGetWork(client, {
      work_id: "temp-work/a1b2c3d4e5f60718293a4b5c6d7e8f90",
      include_depictions: false,
    });

    expect(notesOf(result).join(" ")).toContain("identifier can change");
    expect((payloadOf(result).work as Record<string, unknown>).status).toBe("provisional");
  });

  it("keeps expressions from reading as a count of editions", async () => {
    const { client } = on([{ fixture: "work-detail" }]);
    const result = await runGetWork(client, { work_id: "cb100000010", include_depictions: false });
    expect(notesOf(result).join(" ")).toContain("Published editions are a separate count");
  });
});

describe("list_editions", () => {
  it("returns one row per edition, with its imprint", async () => {
    const { client } = on([{ fixture: "editions" }]);
    const result = await runListEditions(client, {
      work_id: "cb100000010",
      limit: 10,
      page: 1,
    });

    const editions = payloadOf(result).editions as Array<{ publisher: string | null }>;
    expect(editions).toHaveLength(3);
    expect(editions[0]!.publisher).toBe("Vve Delarue et fils");
  });

  it("says nothing about whether a digitised copy can be read", async () => {
    const { client } = on([{ fixture: "editions" }]);
    const result = await runListEditions(client, {
      work_id: "cb100000010",
      limit: 10,
      page: 1,
    });

    const notes = notesOf(result).join(" ");
    expect(notes).toContain("cannot say whether a document opens");
    expect(payloadOf(result).digitised_count).toBe(2);
  });

  it("says the order is neither chronological nor an order of importance", async () => {
    const { client } = on([{ fixture: "editions" }]);
    const result = await runListEditions(client, {
      work_id: "cb100000010",
      limit: 10,
      page: 1,
    });
    expect(notesOf(result).join(" ")).toContain("neither chronological");
  });

  it("explains an empty list rather than letting it read as a work with no editions", async () => {
    const { client } = on([{ fixture: "editions-empty" }]);
    const result = await runListEditions(client, {
      work_id: "temp-work/a1b2c3d4e5f60718293a4b5c6d7e8f90",
      limit: 10,
      page: 1,
    });

    expect(payloadOf(result).editions).toEqual([]);
    expect(notesOf(result).join(" ")).toContain("A work record can exist with none");
  });
});

describe("find_digitised", () => {
  it("asks the catalogue what a record is when it was not told", async () => {
    const { client, endpoint } = on([{ fixture: "types-person" }, { fixture: "digitised-person" }]);
    const result = await runFindDigitised(client, { id: "cb100000001", kind: "auto", limit: 20 });

    expect(payloadOf(result).kind).toBe("person");
    expect(endpoint.requests).toHaveLength(2);
  });

  it("spends no query asking what a provisional identifier is", async () => {
    const { client, endpoint } = on([{ fixture: "digitised-empty" }]);
    const result = await runFindDigitised(client, {
      id: "temp-work/a1b2c3d4e5f60718293a4b5c6d7e8f90",
      kind: "auto",
      limit: 20,
    });

    // Only a work is addressed under temp-work, so the question is settled.
    expect(payloadOf(result).kind).toBe("work");
    expect(endpoint.requests).toHaveLength(1);
  });

  it("counts links by role and says what each role means", async () => {
    const { client } = on([{ fixture: "types-person" }, { fixture: "digitised-person" }]);
    const result = await runFindDigitised(client, { id: "cb100000001", kind: "auto", limit: 20 });

    expect(payloadOf(result).counts).toEqual({ reproduction: 1, ocr: 1, depiction: 2 });
    const notes = notesOf(result).join(" ");
    expect(notes).toContain("names that text and does not read it");
    expect(notes).toContain("mentions the subject in passing");
  });

  it("calls an empty answer a statement about the catalogue", async () => {
    const { client } = on([{ fixture: "types-work" }, { fixture: "digitised-empty" }]);
    const result = await runFindDigitised(client, { id: "cb100000010", kind: "auto", limit: 20 });

    expect(payloadOf(result).links).toEqual([]);
    expect(notesOf(result).join(" ")).toContain("digitises a fraction of what it holds");
  });
});

describe("every answer, whichever tool produced it", () => {
  const calls: Array<{
    name: string;
    replies: Reply[];
    run: (client: BnfClient) => Promise<unknown>;
  }> = [
    {
      name: "search_authors",
      replies: [{ fixture: "authors-search" }],
      run: (c) => runSearchAuthors(c, { name: "Ardouin", limit: 10, page: 1 }),
    },
    {
      name: "get_author",
      replies: [{ fixture: "author-detail" }],
      run: (c) => runGetAuthor(c, { author_id: "cb100000001", include_depictions: false }),
    },
    {
      name: "search_works",
      replies: [{ fixture: "works-search" }],
      run: (c) => runSearchWorks(c, { title: "vent octobre", limit: 10, page: 1 }),
    },
    {
      name: "get_work",
      replies: [{ fixture: "work-detail" }],
      run: (c) => runGetWork(c, { work_id: "cb100000010", include_depictions: false }),
    },
    {
      name: "list_editions",
      replies: [{ fixture: "editions" }],
      run: (c) => runListEditions(c, { work_id: "cb100000010", limit: 10, page: 1 }),
    },
    {
      name: "find_digitised",
      replies: [{ fixture: "types-person" }, { fixture: "digitised-person" }],
      run: (c) => runFindDigitised(c, { id: "cb100000001", kind: "auto", limit: 20 }),
    },
  ];

  for (const { name, replies, run } of calls) {
    it(`${name} names the source and the date it was retrieved`, async () => {
      const { client } = on(replies);
      const result = (await run(client)) as {
        content: Array<{ text: string }>;
        structuredContent?: Record<string, unknown>;
      };

      // The licence asks for both, so both are in the block a client renders.
      const text = textOf(result);
      expect(text).toContain("Source: data.bnf.fr (Bibliothèque nationale de France)");
      expect(text).toMatch(/retrieved \d{4}-\d{2}-\d{2}/);
      // And the instant is in the payload, for a caller that formats its own.
      expect(payloadOf(result).retrieved_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it(`${name} carries its notes into the text block`, async () => {
      const { client } = on(replies);
      const result = (await run(client)) as {
        content: Array<{ text: string }>;
        structuredContent?: Record<string, unknown>;
      };
      const notes = notesOf(result);
      const text = textOf(result);
      // A client that renders only text must not lose what qualifies an answer.
      for (const note of notes.slice(0, 1)) {
        expect(text).toContain(note.slice(0, 40));
      }
    });
  }
});
