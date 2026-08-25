/**
 * One name for the person behind this server, in the three places that publish it.
 *
 * The package, the extension manifest and the licence each carry an author, and
 * each is read by someone different: the npm page, the host about to install
 * the extension, and anyone asking who holds the copyright. Two of them naming
 * different people leaves the third to arbitrate, and it has nothing to
 * arbitrate with.
 *
 * The account this work is published under is a separate fact from the name of
 * the person, so it is written where an account belongs, in the address.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface Author {
  name: string;
  url: string;
}

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");

const packaged = JSON.parse(read("../../package.json")) as {
  author: Author;
  repository: { url: string };
};
const manifest = JSON.parse(read("../../packaging/manifest.json")) as { author: Author };
const licence = read("../../LICENSE");

const ACCOUNT_IN_ADDRESS = /github\.com\/([^/]+)\//;

/** The account the repository lives under, which is the one that publishes. */
const account = ACCOUNT_IN_ADDRESS.exec(packaged.repository.url)?.[1];

describe("who this server says wrote it", () => {
  it("names the same person in the package and in the extension manifest", () => {
    expect(packaged.author.name).toBe(manifest.author.name);
  });

  it("names that person as the holder of the licence", () => {
    expect(licence).toMatch(new RegExp(`Copyright \\(c\\) \\d{4} ${packaged.author.name}$`, "m"));
  });

  it("writes the publishing account as an address rather than as a name", () => {
    expect(account).toBeDefined();
    expect(packaged.author.url).toBe(`https://github.com/${account}`);
    expect(manifest.author.url).toBe(packaged.author.url);
  });
});
