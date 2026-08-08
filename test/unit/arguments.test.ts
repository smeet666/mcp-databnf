/**
 * An argument this server does not declare is a question it cannot answer.
 *
 * Reading one and dropping it produces an answer computed on the defaults, which
 * a caller reads as the answer to what they asked. Publishing
 * `additionalProperties: false` and then accepting the argument anyway is worse
 * than declaring nothing, so both halves are checked here: the schema says the
 * rule, and the parser applies it.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { strictInput } from "../../src/tools/arguments.js";
import { findDigitisedInput } from "../../src/tools/findDigitised.js";
import { getAuthorInput } from "../../src/tools/getAuthor.js";
import { getWorkInput } from "../../src/tools/getWork.js";
import { listEditionsInput } from "../../src/tools/listEditions.js";
import { searchAuthorsInput } from "../../src/tools/searchAuthors.js";
import { searchWorksInput } from "../../src/tools/searchWorks.js";

const schemas = {
  search_authors: searchAuthorsInput,
  get_author: getAuthorInput,
  search_works: searchWorksInput,
  get_work: getWorkInput,
  list_editions: listEditionsInput,
  find_digitised: findDigitisedInput,
};

/** Arguments that satisfy each tool, so only the unknown one is at issue. */
const valid: Record<keyof typeof schemas, Record<string, unknown>> = {
  search_authors: { name: "Ardouin" },
  get_author: { author_id: "cb100000001" },
  search_works: { title: "vent octobre" },
  get_work: { work_id: "cb100000010" },
  list_editions: { work_id: "cb100000010" },
  find_digitised: { id: "cb100000001" },
};

describe("an argument that was not declared", () => {
  for (const [name, schema] of Object.entries(schemas)) {
    it(`${name} refuses one rather than answering a different question`, () => {
      const parsed = schema.safeParse({
        ...valid[name as keyof typeof schemas],
        sort_by: "year",
      });
      expect(parsed.success).toBe(false);
      expect(JSON.stringify(parsed.error?.issues)).toContain("invalid_input");
    });

    it(`${name} declares the refusal in the schema it publishes`, () => {
      const published = z.toJSONSchema(schema) as { additionalProperties?: boolean };
      expect(published.additionalProperties).toBe(false);
    });
  }

  it("names the declared argument a caller most plausibly meant", () => {
    const parsed = searchAuthorsInput.safeParse({ nam: "Ardouin" });
    const message = JSON.stringify(parsed.error?.issues);
    expect(message).toContain("did you mean 'name'");
  });

  it("names several unknown arguments at once", () => {
    const parsed = listEditionsInput.safeParse({
      work_id: "cb100000010",
      sort: "date",
      offset: 3,
    });
    const message = JSON.stringify(parsed.error?.issues ?? []);
    expect(message).toContain("sort");
    expect(message).toContain("offset");
  });

  it("lists what the tool does take, so a caller can correct it in one step", () => {
    const parsed = getWorkInput.safeParse({ work: "cb100000010" });
    expect(JSON.stringify(parsed.error?.issues)).toContain("This tool takes: work_id");
  });

  it("leaves an unrecognisable name unnamed rather than sending a caller astray", () => {
    const schema = strictInput({ name: z.string() });
    const message = JSON.stringify(schema.safeParse({ zzzzzzzz: 1 }).error?.issues);
    expect(message).toContain("'zzzzzzzz'");
    expect(message).not.toContain("did you mean");
  });
});

describe("the values each tool accepts", () => {
  it("bounds a page size, so no single call can ask the endpoint for everything", () => {
    expect(searchAuthorsInput.safeParse({ name: "a", limit: 500 }).success).toBe(false);
    expect(searchWorksInput.safeParse({ title: "a", limit: 0 }).success).toBe(false);
    expect(findDigitisedInput.safeParse({ id: "cb1", limit: 5000 }).success).toBe(false);
  });

  it("bounds how deep a caller may page", () => {
    expect(listEditionsInput.safeParse({ work_id: "cb1", page: 0 }).success).toBe(false);
    expect(listEditionsInput.safeParse({ work_id: "cb1", page: 10_000 }).success).toBe(false);
  });

  it("fills in the defaults it documents", () => {
    const parsed = searchAuthorsInput.parse({ name: "Ardouin" });
    expect(parsed.limit).toBe(10);
    expect(parsed.page).toBe(1);
    expect(findDigitisedInput.parse({ id: "cb1" }).kind).toBe("auto");
    expect(getAuthorInput.parse({ author_id: "cb1" }).include_depictions).toBe(false);
  });

  it("refuses a kind it does not know", () => {
    expect(findDigitisedInput.safeParse({ id: "cb1", kind: "edition" }).success).toBe(false);
  });
});
