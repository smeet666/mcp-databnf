/**
 * Questions people actually asked, including the ones they asked badly.
 *
 * Each of these came from putting the server in front of someone with a real
 * question and watching what it said. They are kept as tests because the answer
 * that made a person go wrong is not the answer any other test was checking.
 */

import { describe, expect, it } from "vitest";
import { BnfClient } from "../../src/bnf/client.js";
import { parseEntityId } from "../../src/bnf/sparql.js";
import type { BnfError } from "../../src/errors.js";
import { runGetAuthor } from "../../src/tools/getAuthor.js";
import { runGetWork } from "../../src/tools/getWork.js";
import { runSearchAuthors } from "../../src/tools/searchAuthors.js";
import { runSearchWorks } from "../../src/tools/searchWorks.js";
import { fakeEndpoint, notesOf, silentLogger, testConfig, textOf } from "./helpers.js";
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

describe("Yuki asks about a living writer", () => {
  it("says when someone was born rather than printing a question mark for the death", async () => {
    const { client } = on([{ fixture: "authors-search" }]);
    const result = await runSearchAuthors(client, { name: "Ardouin", limit: 10, page: 1 });

    // A record with a birth year and no death year describes someone the
    // catalogue has not recorded a death for. Writing "1940–?" hands a reader a
    // glyph to interpret, and most read it as a death on an unknown date.
    const { client: living } = on([{ json: livingPerson() }]);
    const answer = await runSearchAuthors(living, { name: "Ernaux", limit: 10, page: 1 });

    expect(textOf(answer)).toContain("born 1940");
    expect(textOf(answer)).not.toContain("?)");
    // A person with both years keeps the span.
    expect(textOf(result)).toContain("(1871–1933)");
  });

  it("says when someone died without inventing a year of birth", async () => {
    const { client } = on([{ json: deathOnlyPerson() }]);
    const result = await runSearchAuthors(client, { name: "Anonyme", limit: 10, page: 1 });
    expect(textOf(result)).toContain("died 1650");
    expect(textOf(result)).not.toContain("?");
  });
});

describe("Nadia pastes an identifier from Gallica", () => {
  it("names it as a Gallica document identifier rather than calling it unreadable", async () => {
    const { client, endpoint } = on([{ fixture: "work-detail" }]);
    const result = await runGetWork(client, {
      work_id: "bpt6k70658c",
      include_depictions: false,
    });

    const text = textOf(result);
    expect(text).toContain("[invalid_input]");
    expect(text).toContain("Gallica");
    // The advice has to name the way out, which is to search for the work.
    expect(text).toContain("search_works");
    expect(endpoint.requests).toHaveLength(0);
  });

  it("recognises the three shapes a Gallica identifier takes", () => {
    for (const ark of ["bpt6k70658c", "btv1b86108277", "bd6t5332094g"]) {
      expect(hintFrom(ark)).toContain("Gallica");
      expect(hintFrom(`https://gallica.bnf.fr/ark:/12148/${ark}`)).toContain("Gallica");
    }
  });
});

describe("Claire pastes the page address she was reading", () => {
  it("reads the human-readable data.bnf.fr address and says what to do with it", async () => {
    const { client, endpoint } = on([{ fixture: "author-detail" }]);
    const result = await runGetAuthor(client, {
      author_id: "https://data.bnf.fr/fr/11907966/marguerite_duras/",
      include_depictions: false,
    });

    const text = textOf(result);
    expect(text).toContain("[invalid_input]");
    // That address is what a browser shows, so refusing it without saying why
    // reads as the server not knowing a record it plainly has.
    expect(text).toContain("11907966");
    expect(text).toContain("search_authors");
    // The name is in the address, so the advice can be specific.
    expect(text).toContain("marguerite duras");
    expect(endpoint.requests).toHaveLength(0);
  });

  it("gives the same reading for a work's page address", () => {
    const hint = hintFrom("https://data.bnf.fr/fr/13516296/le_bateau_ivre/");
    expect(hint).toContain("search_works");
    expect(hint).toContain("le bateau ivre");
  });
});

describe("Léa looks for a work by its whole title", () => {
  it("says that every word of the title was required, short ones included", async () => {
    const { client } = on([{ fixture: "works-search" }]);
    const result = await runSearchWorks(client, {
      title: "une saison en enfer",
      limit: 10,
      page: 1,
    });

    // Writing the title out in full narrows the search rather than sharpening
    // it: "une" and "en" have to appear as well, and a record catalogued under
    // "Saison en enfer" then falls out of the answer.
    const notes = notesOf(result).join(" ");
    expect(notes).toContain('"une"');
    expect(notes).toContain("dropping a word widens the search");
  });

  it("says so when a page holds nothing but provisional records", async () => {
    const { client } = on([{ json: allProvisional() }]);
    const result = await runSearchWorks(client, { title: "saison enfer", limit: 10, page: 1 });

    // A page of studies about a famous work, with the work itself further down,
    // reads as the BnF not holding the work at all.
    const notes = notesOf(result).join(" ");
    expect(notes).toContain("Every row on this page is a provisional record");
  });

  it("says nothing of the sort when the page carries an established record", async () => {
    const { client } = on([{ fixture: "works-search" }]);
    const result = await runSearchWorks(client, { title: "vent octobre", limit: 10, page: 1 });
    expect(notesOf(result).join(" ")).not.toContain("Every row on this page");
  });
});

/** The advice attached to a refused identifier, which is where the help lives. */
function hintFrom(written: string): string {
  try {
    parseEntityId(written);
  } catch (error) {
    return (error as BnfError).details.hint ?? "";
  }
  throw new Error(`"${written}" was accepted as an identifier`);
}

/* ── Result sets these cases need, written here since they exist for one test ── */

const lit = (value: string) => ({ type: "literal" as const, value });
const int = (value: number) => ({
  type: "typed-literal" as const,
  datatype: "http://www.w3.org/2001/XMLSchema#integer",
  value: String(value),
});
const uri = (value: string) => ({ type: "uri" as const, value });

const livingPerson = () => ({
  head: { vars: ["person", "name", "birthYear"] },
  results: {
    bindings: [
      {
        person: uri("http://data.bnf.fr/ark:/12148/cb100000040#about"),
        name: lit("Sidonie Verbeke"),
        birthYear: int(1940),
      },
    ],
  },
});

const deathOnlyPerson = () => ({
  head: { vars: ["person", "name", "deathYear"] },
  results: {
    bindings: [
      {
        person: uri("http://data.bnf.fr/ark:/12148/cb100000041#about"),
        name: lit("Le Sieur de Availles"),
        deathYear: int(1650),
      },
    ],
  },
});

const allProvisional = () => ({
  head: { vars: ["work", "title", "date", "status"] },
  results: {
    bindings: [
      {
        work: uri("http://data.bnf.fr/temp-work/a1b2c3d4e5f60718293a4b5c6d7e8f90/#about"),
        title: lit("Lire « Le vent d'octobre »"),
        status: lit("provisional"),
      },
      {
        work: uri("http://data.bnf.fr/temp-work/b1b2c3d4e5f60718293a4b5c6d7e8f90/#about"),
        title: lit("Autour du « Vent d'octobre »"),
        status: lit("provisional"),
      },
    ],
  },
});
