/**
 * What the published package declares, and what it carries.
 *
 * Two things are stated here rather than left to whoever edits package.json
 * next. The entry points are declared once: `exports` is what every resolver
 * reads, and a second declaration beside it is one nobody maintains, which
 * survives a rename by pointing at a path that no longer exists. And what npm
 * packs is written down, because a file dropped from that list disappears from
 * the published package without anything failing.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const packaged = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as {
  main?: string;
  types?: string;
  module?: string;
  exports: Record<string, { types: string; import: string }>;
  files: string[];
};

describe("the entry points this package declares", () => {
  it("names the server and the client layer", () => {
    // A server may publish more than those two, as one reading several sites
    // publishes the piece its neighbours reuse. Both of these are always there.
    expect(Object.keys(packaged.exports)).toContain(".");
    expect(Object.keys(packaged.exports)).toContain("./client");
  });

  it("declares each of them once", () => {
    expect(packaged.main).toBeUndefined();
    expect(packaged.types).toBeUndefined();
    expect(packaged.module).toBeUndefined();
  });

  it("gives every entry point its types and its module", () => {
    for (const [name, entry] of Object.entries(packaged.exports)) {
      expect(entry.types, name).toMatch(/^\.\/dist\/.+\.d\.ts$/);
      expect(entry.import, name).toMatch(/^\.\/dist\/.+\.js$/);
    }
  });
});

describe("what npm packs", () => {
  it("carries the built code, the readme, the licence, the changelog and the descriptor", () => {
    expect([...packaged.files].sort()).toEqual([
      "CHANGELOG.md",
      "LICENSE",
      "README.md",
      "dist",
      "server.json",
    ]);
  });
});
