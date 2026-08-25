/**
 * The code a refused argument opens with.
 *
 * A caller branches on that code, and the schema refuses along several paths:
 * an argument that is not declared, one written outside its bounds, one of
 * another type, a value outside the set a tool reads. A code carried by one
 * path and missing from the others is a vocabulary a caller finds one time out
 * of two, which is worse than one it never finds.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { strictInput } from "../../src/tools/arguments.js";

const declared = strictInput({
  limit: z.number().int().min(1).max(50).default(10),
  query: z.string().min(2),
  kind: z.enum(["one", "two"]).optional(),
});

/** What a caller is told, for an input the declaration cannot accept. */
function refusalOf(input: unknown): string {
  const outcome = declared.safeParse(input);
  if (outcome.success) {
    throw new Error(`${JSON.stringify(input)} was accepted, so it refuses nothing to read`);
  }
  return outcome.error.issues.map((issue) => issue.message).join(" ");
}

describe("the code a refused argument opens with", () => {
  it("names it on an argument the tool does not declare", () => {
    expect(refusalOf({ query: "written", nope: 1 })).toContain("[invalid_input]");
  });

  it("names it on an argument written outside its bounds", () => {
    expect(refusalOf({ query: "written", limit: 500 })).toContain("[invalid_input]");
  });

  it("names it on an argument written as another type", () => {
    expect(refusalOf({ query: 5 })).toContain("[invalid_input]");
  });

  it("names it on a value outside the set the argument reads", () => {
    expect(refusalOf({ query: "written", kind: "three" })).toContain("[invalid_input]");
  });

  it("names it on an argument left out", () => {
    expect(refusalOf({ limit: 3 })).toContain("[invalid_input]");
  });

  it("keeps the validator's own wording behind the code", () => {
    // Rewriting these sentences by hand would freeze them to the version
    // installed the day they were written.
    expect(refusalOf({ query: "written", limit: 500 })).toContain("Too big");
  });
});
