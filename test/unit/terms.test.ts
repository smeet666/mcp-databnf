/**
 * How the text a caller writes becomes the terms the index requires.
 *
 * Every term is mandatory, so the reading that turns a name into terms decides
 * what the answer can be. A reading that invents a term answers with an absence
 * nobody established, and a reading that drops a character silently leaves a
 * caller comparing their own words against an answer built from other ones.
 */

import { describe, expect, it } from "vitest";
import { BnfClient } from "../../src/bnf/client.js";
import { toSearchWords } from "../../src/bnf/sparql.js";
import { runSearchAuthors } from "../../src/tools/searchAuthors.js";
import { runSearchWorks } from "../../src/tools/searchWorks.js";
import { fakeEndpoint, notesOf, payloadOf, silentLogger, testConfig } from "./helpers.js";
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

describe("characters that mark nothing on a screen", () => {
  it("do not cut one word into two", () => {
    // A control character, a zero-width space and a soft hyphen each occupy a
    // position in the string and none of them separates two words.
    expect(toSearchWords("Rimb\u0001aud")).toEqual(["Rimbaud"]);
    expect(toSearchWords("Rimb\u200baud")).toEqual(["Rimbaud"]);
    expect(toSearchWords("Rimb\u00adaud")).toEqual(["Rimbaud"]);
    expect(toSearchWords("Rimbaud\ufeff")).toEqual(["Rimbaud"]);
  });

  it("still leave a space, a tab and a line break separating words", () => {
    expect(toSearchWords("Arthur Rimbaud")).toEqual(["Arthur", "Rimbaud"]);
    expect(toSearchWords("Arthur\tRimbaud")).toEqual(["Arthur", "Rimbaud"]);
    expect(toSearchWords("Arthur\nRimbaud")).toEqual(["Arthur", "Rimbaud"]);
  });

  it("do not make search_authors require two terms where a caller wrote one", async () => {
    const { client, endpoint } = on([{ fixture: "authors-search" }]);
    const result = await runSearchAuthors(client, {
      name: "Ardo\u0001uin",
      limit: 10,
      page: 1,
    });

    expect(payloadOf(result).words_searched).toEqual(["Ardouin"]);
    expect(endpoint.query(0)).toContain("'Ardouin'");
    expect(endpoint.query(0)).not.toContain("'Ardo'");
    expect(notesOf(result).join(" ")).toContain("mark nothing on a screen");
  });

  it("do not make search_works require two terms where a caller wrote one", async () => {
    const { client, endpoint } = on([{ fixture: "works-search" }]);
    const result = await runSearchWorks(client, {
      title: "octo\u200bbre",
      limit: 10,
      page: 1,
    });

    expect(payloadOf(result).words_searched).toEqual(["octobre"]);
    expect(endpoint.query(0)).toContain("'octobre'");
  });
});

describe("what the reading set aside", () => {
  it("names the punctuation a search dropped, on a name of two words", async () => {
    const { client } = on([{ fixture: "authors-search" }]);
    const result = await runSearchAuthors(client, { name: "Ardouin, C.", limit: 10, page: 1 });

    const notes = notesOf(result).join(" ");
    expect(notes).toContain("set aside");
    expect(notes).toContain('","');
    expect(notes).toContain('"."');
  });

  it("names a term of one character as a term the answer turns on", async () => {
    const { client } = on([{ fixture: "authors-search" }]);
    const result = await runSearchAuthors(client, { name: "Ardouin, C.", limit: 10, page: 1 });

    expect(payloadOf(result).words_searched).toEqual(["Ardouin", "C"]);
    expect(notesOf(result).join(" ")).toContain('"C" is a term of one character');
  });

  it("says nothing about a reading that set nothing aside", async () => {
    const { client } = on([{ fixture: "authors-search" }]);
    const result = await runSearchAuthors(client, { name: "Camille Ardouin", limit: 10, page: 1 });

    const notes = notesOf(result).join(" ");
    expect(notes).not.toContain("set aside");
    expect(notes).not.toContain("mark nothing on a screen");
    expect(notes).not.toContain("term of one character");
  });
});
