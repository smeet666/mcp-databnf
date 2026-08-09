/**
 * What the server publishes about itself.
 *
 * A tool's declaration is the only thing a model reads before deciding whether
 * to call it, so a declaration that is wrong is a bug that never shows up in any
 * other test: everything downstream keeps working, and the tool is chosen for
 * questions it cannot answer.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { INSTRUCTIONS, createServer } from "../../src/server.js";
import { findDigitisedOutput } from "../../src/tools/findDigitised.js";
import { getAuthorOutput } from "../../src/tools/getAuthor.js";
import { getWorkOutput } from "../../src/tools/getWork.js";
import { listEditionsOutput } from "../../src/tools/listEditions.js";
import { listWorksOutput } from "../../src/tools/listWorks.js";
import { searchAuthorsOutput } from "../../src/tools/searchAuthors.js";
import { searchWorksOutput } from "../../src/tools/searchWorks.js";
import { fakeEndpoint, silentLogger, testConfig } from "./helpers.js";

const TOOLS = [
  "search_authors",
  "get_author",
  "search_works",
  "get_work",
  "list_editions",
  "list_works",
  "find_digitised",
] as const;

/** The registry the SDK keeps, which is what a client is told about. */
function registered() {
  const endpoint = fakeEndpoint([{ fixture: "empty" }]);
  const server = createServer({
    config: testConfig(),
    logger: silentLogger,
    fetchImpl: endpoint.fetchImpl,
  });
  return (server as unknown as { _registeredTools: Record<string, Record<string, unknown>> })
    ._registeredTools;
}

describe("the tools a client is offered", () => {
  it("are the seven this server has, under the names it documents", () => {
    expect(Object.keys(registered()).sort()).toEqual([...TOOLS].sort());
  });

  it("each declare that they only read", () => {
    for (const [name, tool] of Object.entries(registered())) {
      expect(tool.annotations, name).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      });
    }
  });

  it("each carry a description saying what the tool cannot do as well as what it can", () => {
    for (const [name, tool] of Object.entries(registered())) {
      const description = String(tool.description ?? "");
      expect(description.length, name).toBeGreaterThan(120);
      // Every description states a limit, because a tool chosen for the wrong
      // question answers confidently and wrongly.
      expect(description, name).toMatch(/\b(not|never|cannot|no measure|no)\b/i);
    }
  });

  it("each declare an output schema, so a client can check what came back", () => {
    for (const [name, tool] of Object.entries(registered())) {
      expect(tool.outputSchema, name).toBeDefined();
    }
  });
});

describe("what every output schema promises", () => {
  const outputs = {
    search_authors: searchAuthorsOutput,
    get_author: getAuthorOutput,
    search_works: searchWorksOutput,
    get_work: getWorkOutput,
    list_editions: listEditionsOutput,
    list_works: listWorksOutput,
    find_digitised: findDigitisedOutput,
  };

  for (const [name, schema] of Object.entries(outputs)) {
    it(`${name} carries the date of retrieval the licence asks for`, () => {
      const published = z.toJSONSchema(schema) as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      expect(Object.keys(published.properties ?? {}), name).toContain("retrieved_at");
      expect(published.required ?? [], name).toContain("retrieved_at");
    });

    it(`${name} carries notes, which is where an answer is qualified`, () => {
      const published = z.toJSONSchema(schema) as { properties?: Record<string, unknown> };
      expect(Object.keys(published.properties ?? {}), name).toContain("notes");
    });
  }

  it("describes 'has_more' as more existing rather than as a total", () => {
    const published = z.toJSONSchema(searchWorksOutput) as {
      properties?: Record<string, { description?: string }>;
    };
    expect(Object.keys(published.properties ?? {})).not.toContain("total");
    expect(Object.keys(published.properties ?? {})).toContain("has_more");
  });

  it("names a count for what it counts", () => {
    const published = z.toJSONSchema(findDigitisedOutput) as {
      properties?: Record<string, { description?: string }>;
    };
    expect(published.properties?.links_returned_by_role?.description).toContain(
      "count the links returned here",
    );
  });
});

describe("the instructions a model reads first", () => {
  it("state the two things the licence asks for", () => {
    expect(INSTRUCTIONS).toContain("name the source and state the date they were retrieved");
  });

  it("state that neither search ranks", () => {
    expect(INSTRUCTIONS).toContain("never scores how well");
    expect(INSTRUCTIONS).toContain("never describe a count as a ranking");
  });

  it("state that one person can hold several records", () => {
    expect(INSTRUCTIONS).toContain("several authority records");
  });

  it("state that Gallica is described and never read", () => {
    expect(INSTRUCTIONS).toContain("never requests gallica.bnf.fr");
  });

  it("state that a list of a person's works is what the catalogue links", () => {
    expect(INSTRUCTIONS).toContain("not a bibliography");
  });

  it("state that a rate limit is not an absence", () => {
    expect(INSTRUCTIONS).toContain("never that the thing you asked for is missing");
  });

  it("name the source rather than any other server", () => {
    expect(INSTRUCTIONS).toContain("data.bnf.fr");
    expect(INSTRUCTIONS.toLowerCase()).not.toContain("mcp-");
  });
});
