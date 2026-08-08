/**
 * What the parsers may and may not conclude from a result set.
 *
 * Each assertion here answers a question of the form "the record does not say
 * X; what does this server report". The answer is always the same in shape: a
 * null, an empty list, or a statement naming what is missing. It is never a
 * value that looks like an answer.
 */

import { describe, expect, it } from "vitest";
import type { SparqlResults } from "../../src/bnf/http.js";
import {
  idFromIri,
  readStatus,
  toAuthorDetail,
  toAuthorSummaries,
  toDigitisedLinks,
  toEditions,
  toWorkDetail,
  toWorkSummaries,
} from "../../src/bnf/parse.js";
import { fixture } from "./helpers.js";

const results = (name: string) => fixture(name) as SparqlResults;

describe("identifiers read off an address", () => {
  it("reads an ARK and a provisional digest, and refuses anything else", () => {
    expect(idFromIri("http://data.bnf.fr/ark:/12148/cb119219976#about")).toBe("cb119219976");
    expect(idFromIri("http://data.bnf.fr/ark:/12148/CB119219976")).toBe("cb119219976");
    expect(idFromIri("http://data.bnf.fr/temp-work/22d7f68c1a4bdd081ad7ca791fd3b730/#about")).toBe(
      "temp-work/22d7f68c1a4bdd081ad7ca791fd3b730",
    );
    // An address naming nothing this dataset addresses yields null rather than a
    // guess: an identifier that does not resolve sends the next call to a record
    // that does not exist, and that answer reads as an absence.
    expect(idFromIri("http://data.bnf.fr/date/1873/")).toBeNull();
    expect(idFromIri("http://dewey.info/class/800/")).toBeNull();
  });
});

describe("a page of people", () => {
  it("returns every record rather than choosing among them", () => {
    const page = toAuthorSummaries(results("authors-search"), 10);
    expect(page.rows.map((row) => row.id)).toEqual(["cb100000001", "cb100000002", "cb100000003"]);
    // Two of them carry one name, which is exactly what the caller has to see.
    expect(page.rows.filter((row) => row.name === "Camille Ardouin")).toHaveLength(2);
  });

  it("leaves a year the record does not carry as null, never as zero", () => {
    const page = toAuthorSummaries(results("authors-search"), 10);
    const second = page.rows.find((row) => row.id === "cb100000002")!;
    expect(second.birthYear).toBeNull();
    expect(second.deathYear).toBeNull();
    expect(second.role).toBeNull();
  });

  it("reads the row beyond the page as more existing, and does not show it", () => {
    const page = toAuthorSummaries(results("authors-search-overflow"), 2);
    expect(page.rows).toHaveLength(2);
    expect(page.hasMore).toBe(true);
  });

  it("reports an exact page as holding no more", () => {
    const page = toAuthorSummaries(results("authors-search"), 3);
    expect(page.rows).toHaveLength(3);
    expect(page.hasMore).toBe(false);
  });

  it("returns an empty page for an empty result set", () => {
    const page = toAuthorSummaries(results("empty"), 10);
    expect(page.rows).toEqual([]);
    expect(page.hasMore).toBe(false);
  });
});

describe("one person", () => {
  const author = () =>
    toAuthorDetail(
      results("author-detail"),
      "cb100000001",
      "https://data.bnf.fr/ark:/12148/cb100000001",
    );

  it("reads both halves of the record: the person and the authority heading", () => {
    const detail = author();
    // From the person.
    expect(detail.name).toBe("Camille Ardouin");
    expect(detail.birthDate).toBe("1871-03-04");
    // From the authority record, which is a different subject.
    expect(detail.label).toBe("Camille Ardouin (1871-1933)");
    expect(detail.recordModified).toBe("2023-11-02");
  });

  it("keeps the biographical field as the one word the record holds", () => {
    expect(author().biographicalInformation).toBe("Poète");
  });

  it("reduces a vocabulary address to its term rather than reporting a URL", () => {
    const detail = author();
    expect(detail.languages).toEqual(["fre"]);
    expect(detail.countries).toEqual(["fr"]);
    expect(detail.deweyClasses).toEqual(["800"]);
    expect(detail.fields).toEqual(["Littératures"]);
  });

  it("groups alignments by file and drops the ones pointing back at the record", () => {
    const sameAs = author().sameAs;
    expect(sameAs.viaf).toEqual(["http://viaf.org/viaf/900000001"]);
    expect(sameAs.idref).toEqual(["http://www.idref.fr/090000001/id"]);
    expect(sameAs.wikidata).toEqual(["http://wikidata.org/entity/Q90000001"]);
    // The record aligns itself with itself; that says nothing about anywhere else.
    expect(JSON.stringify(sameAs)).not.toContain("cb100000001#foaf:Person");
  });

  it("writes the ISNI the record states as a number into an address", () => {
    expect(author().sameAs.isni).toEqual(["https://isni.org/isni/0000000100000001"]);
  });

  it("keeps only Gallica addresses among the images, with the rendering stripped off the ARK", () => {
    const depictions = author().depictions;
    // The record also carries an illustration held on Wikimedia Commons, which
    // is not a digitised BnF document and must not arrive labelled as one.
    expect(depictions).toHaveLength(2);
    expect(depictions.map((link) => link.ark)).toEqual(["btv1b90000001", "btv1b90000002"]);
    // The address is carried through as published: it is what a person opens.
    expect(depictions[0]!.url).toContain(".thumbnail");
    expect(depictions.every((link) => link.role === "depiction")).toBe(true);
  });

  it("leaves a living person's date of death null rather than filling it", () => {
    const detail = toAuthorDetail(results("author-living"), "cb100000004", "https://data.bnf.fr/x");
    expect(detail.deathDate).toBeNull();
    expect(detail.deathYear).toBeNull();
    expect(detail.birthYear).toBe(1964);
  });

  it("carries the other headings with the language each is written in", () => {
    const names = author().otherNames;
    expect(names).toContainEqual({ label: "Kamiru Arudouan (1871-1933)", language: "ja" });
  });
});

describe("how settled a record is", () => {
  it("reads the statement the record makes", () => {
    expect(readStatus("fully established", "http://data.bnf.fr/ark:/12148/cb1#about")).toBe(
      "established",
    );
    expect(readStatus("provisional", "http://data.bnf.fr/ark:/12148/cb1#about")).toBe(
      "provisional",
    );
  });

  it("falls back to the shape of the address when the record states nothing", () => {
    expect(readStatus(null, "http://data.bnf.fr/temp-work/abc/#about")).toBe("provisional");
    expect(readStatus(null, "http://data.bnf.fr/ark:/12148/cb1#about")).toBe("established");
  });

  it("lets the statement govern, since a record can be settled before it is re-addressed", () => {
    expect(readStatus("fully established", "http://data.bnf.fr/temp-work/abc/#about")).toBe(
      "established",
    );
  });
});

describe("a page of works", () => {
  it("counts one work once however many creators it carries", () => {
    const page = toWorkSummaries(results("works-search"), 10);
    const ids = page.rows.map((row) => row.id);
    expect(ids.filter((id) => id === "cb100000010")).toHaveLength(1);
    const work = page.rows.find((row) => row.id === "cb100000010")!;
    expect(work.creators.map((creator) => creator.name)).toEqual([
      "Camille Ardouin",
      "Yvonne Trélat",
    ]);
  });

  it("says which rows are provisional rather than hiding or mixing them", () => {
    const page = toWorkSummaries(results("works-search"), 10);
    const study = page.rows.find((row) => row.id.startsWith("temp-work/"))!;
    expect(study.status).toBe("provisional");
    expect(page.rows.find((row) => row.id === "cb100000010")!.status).toBe("established");
  });

  it("leaves the creators of an uncredited work as an empty list", () => {
    const page = toWorkSummaries(results("works-search"), 10);
    expect(page.rows.find((row) => row.id === "cb100000012")!.creators).toEqual([]);
  });
});

describe("one work", () => {
  const work = () =>
    toWorkDetail(
      results("work-detail"),
      "cb100000010",
      "http://data.bnf.fr/ark:/12148/cb100000010#about",
      "https://data.bnf.fr/ark:/12148/cb100000010",
    );

  it("counts expressions and names them as expressions", () => {
    expect(work().expressionCount).toBe(2);
  });

  it("reads the creator's name off the same row as the creator", () => {
    expect(work().creators).toEqual([{ id: "cb100000001", name: "Camille Ardouin" }]);
  });

  it("repeats what the record states about how settled it is", () => {
    const detail = work();
    expect(detail.status).toBe("established");
    expect(detail.statusStatement).toBe("fully established");
  });

  it("reads a provisional record as provisional from both signals", () => {
    const detail = toWorkDetail(
      results("work-provisional"),
      "temp-work/a1b2c3d4e5f60718293a4b5c6d7e8f90",
      "http://data.bnf.fr/temp-work/a1b2c3d4e5f60718293a4b5c6d7e8f90/#about",
      "https://data.bnf.fr/temp-work/a1b2c3d4e5f60718293a4b5c6d7e8f90/",
    );
    expect(detail.status).toBe("provisional");
    expect(detail.statusStatement).toBe("provisional");
  });
});

describe("editions", () => {
  it("counts one edition once, however many rows the join produced", () => {
    const page = toEditions(results("editions"), 10);
    expect(page.rows.map((row) => row.id)).toEqual(["cb100000030", "cb100000031", "cb100000032"]);
  });

  it("gathers the digitised copies of one edition onto that edition", () => {
    const page = toEditions(results("editions"), 10);
    const first = page.rows[0]!;
    expect(first.digitised.map((link) => link.ark)).toEqual(["bpt6k90000030", "btv1b90000030"]);
    expect(first.digitised.every((link) => link.role === "reproduction")).toBe(true);
  });

  it("keeps a machine-read text apart from a digitised copy", () => {
    const page = toEditions(results("editions"), 10);
    const reprint = page.rows.find((row) => row.id === "cb100000031")!;
    expect(reprint.digitised).toHaveLength(1);
    expect(reprint.digitised[0]!.role).toBe("ocr");
  });

  it("reports an edition with no digitised copy as carrying none", () => {
    const page = toEditions(results("editions"), 10);
    expect(page.rows.find((row) => row.id === "cb100000032")!.digitised).toEqual([]);
  });

  it("keeps a date the record wrote as a phrase, and leaves the year null", () => {
    const page = toEditions(results("editions"), 10);
    const undated = page.rows.find((row) => row.id === "cb100000032")!;
    expect(undated.date).toBe("[s.d.]");
    expect(undated.year).toBeNull();
  });

  it("leaves an absent edition statement or ISBN null", () => {
    const page = toEditions(results("editions"), 10);
    const first = page.rows[0]!;
    expect(first.editionStatement).toBeNull();
    expect(first.isbn).toBeNull();
    expect(page.rows[1]!.editionStatement).toBe("2e édition revue");
    expect(page.rows[1]!.isbn).toBe("2-87042-000-1");
  });
});

describe("digitised documents", () => {
  it("keeps one document once, however many paths reached it", () => {
    const page = toDigitisedLinks(results("digitised-person"), 20);
    const arks = page.rows.map((row) => row.ark);
    expect(new Set(arks).size).toBe(arks.length);
    expect(arks).toContain("bpt6k90000030");
  });

  it("keeps the three roles apart", () => {
    const page = toDigitisedLinks(results("digitised-person"), 20);
    expect(page.rows.filter((row) => row.role === "reproduction")).toHaveLength(1);
    expect(page.rows.filter((row) => row.role === "ocr")).toHaveLength(1);
    expect(page.rows.filter((row) => row.role === "depiction")).toHaveLength(2);
  });

  it("reads more as existing from the rows the endpoint sent, not from what survived deduplication", () => {
    // Five rows arrived and four addresses survived. A page of four asked for
    // five, so the fifth row is the endpoint saying there is more; reading only
    // the survivors would report a page with room to spare.
    const page = toDigitisedLinks(results("digitised-person"), 4);
    expect(page.rows).toHaveLength(4);
    expect(page.hasMore).toBe(true);
  });

  it("returns nothing at all for a record that points nowhere", () => {
    const page = toDigitisedLinks(results("digitised-empty"), 20);
    expect(page.rows).toEqual([]);
    expect(page.hasMore).toBe(false);
  });
});
