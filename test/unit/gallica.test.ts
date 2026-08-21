/**
 * The one host this server describes and never reads.
 *
 * The BnF publishes its catalogue and its digitised contents under two
 * different regimes. The catalogue is free to reuse with its source and its date
 * of retrieval named. Gallica is not: its terms make use of its contents inside
 * an artificial-intelligence project subject to a paid licence outside academic
 * research, and its server refuses ClaudeBot and GPTBot outright, then bans the
 * calling address after about fifteen requests whatever the pace.
 *
 * So this is a licence boundary rather than a preference, and a test that only
 * checked the guard function would pass while a tool quietly fetched a
 * thumbnail. These tests drive every tool with records full of Gallica
 * addresses and read back every request that left, which is the only evidence
 * that counts.
 */

import { describe, expect, it } from "vitest";
import { BnfClient } from "../../src/bnf/client.js";
import { ALLOWED_HOST, assertRequestable, isGallicaAddress } from "../../src/bnf/endpoint.js";
import { runFindDigitised } from "../../src/tools/findDigitised.js";
import { runGetAuthor } from "../../src/tools/getAuthor.js";
import { runGetWork } from "../../src/tools/getWork.js";
import { runListEditions } from "../../src/tools/listEditions.js";
import { runListWorks } from "../../src/tools/listWorks.js";
import { runSearchAuthors } from "../../src/tools/searchAuthors.js";
import { runSearchWorks } from "../../src/tools/searchWorks.js";
import { fakeEndpoint, payloadOf, silentLogger, testConfig, textOf } from "./helpers.js";

const client = (endpoint: ReturnType<typeof fakeEndpoint>) =>
  new BnfClient({ config: testConfig(), logger: silentLogger, fetchImpl: endpoint.fetchImpl });

describe("the guard between the query builders and fetch", () => {
  it("refuses any host but the query service", () => {
    for (const forbidden of [
      "https://gallica.bnf.fr/ark:/12148/bpt6k70658c",
      "https://gallica.bnf.fr/iiif/ark:/12148/bpt6k70658c/manifest.json",
      "https://gallica.bnf.fr/ark:/12148/btv1b90000001.thumbnail",
      "https://GALLICA.BNF.FR/ark:/12148/bpt6k70658c",
      "http://catalogue.bnf.fr/ark:/12148/cb119219976",
      "https://data.bnf.fr.evil.example/sparql",
    ]) {
      expect(() => assertRequestable(forbidden)).toThrowError(/refuses|and nothing else/i);
    }
  });

  it("allows the query service itself", () => {
    expect(() => assertRequestable(`https://${ALLOWED_HOST}/sparql`)).not.toThrow();
  });

  it("names the reason in the refusal, so a future caller reads it", () => {
    expect(() => assertRequestable("https://gallica.bnf.fr/ark:/12148/bpt6k70658c")).toThrowError(
      /Gallica/,
    );
  });

  it("recognises a Gallica address wherever it appears", () => {
    expect(isGallicaAddress("https://gallica.bnf.fr/ark:/12148/x")).toBe(true);
    expect(isGallicaAddress("http://gallica.bnf.fr/ark:/12148/x")).toBe(true);
    expect(isGallicaAddress("https://GALLICA.bnf.fr/ark:/12148/x")).toBe(true);
    expect(isGallicaAddress("https://catalogue.bnf.fr/ark:/12148/x")).toBe(false);
    // A host merely ending in the same letters is a different host.
    expect(isGallicaAddress("https://notgallica.bnf.fr/x")).toBe(false);
    expect(isGallicaAddress("not an address")).toBe(false);
  });
});

describe("every tool, driven with records full of Gallica addresses", () => {
  /** Each tool paired with the replies it consumes and the call that runs it. */
  const runs: Array<{
    name: string;
    replies: Array<{ fixture: string }>;
    run: (client: BnfClient) => Promise<{ content: Array<{ text: string }> }>;
  }> = [
    {
      name: "search_authors",
      replies: [{ fixture: "authors-search" }],
      run: (c) => runSearchAuthors(c, { name: "Ardouin", limit: 10, page: 1 }),
    },
    {
      name: "get_author",
      replies: [{ fixture: "author-detail" }],
      run: (c) => runGetAuthor(c, { author_id: "cb100000001", include_depictions: true }),
    },
    {
      name: "search_works",
      replies: [{ fixture: "works-search" }],
      run: (c) => runSearchWorks(c, { title: "vent octobre", limit: 10, page: 1 }),
    },
    {
      name: "get_work",
      replies: [{ fixture: "work-detail" }],
      run: (c) => runGetWork(c, { work_id: "cb100000010", include_depictions: true }),
    },
    {
      name: "list_editions",
      replies: [{ fixture: "editions" }],
      run: (c) => runListEditions(c, { work_id: "cb100000010", limit: 10, page: 1 }),
    },
    {
      name: "list_works",
      replies: [{ fixture: "author-works" }],
      run: (c) => runListWorks(c, { author_id: "cb100000001", limit: 10, page: 1 }),
    },
    {
      name: "find_digitised",
      replies: [{ fixture: "types-person" }, { fixture: "digitised-person" }],
      run: (c) => runFindDigitised(c, { id: "cb100000001", kind: "auto", limit: 20 }),
    },
  ];

  for (const { name, replies, run } of runs) {
    it(`${name} sends every request to the query service and nowhere else`, async () => {
      const endpoint = fakeEndpoint(replies);
      await run(client(endpoint));

      expect(endpoint.requests.length).toBeGreaterThan(0);
      for (const url of endpoint.urls()) {
        expect(new URL(url).hostname).toBe(ALLOWED_HOST);
        expect(isGallicaAddress(url)).toBe(false);
      }
    });
  }

  it("renders Gallica addresses as links while requesting none of them", async () => {
    const endpoint = fakeEndpoint([{ fixture: "editions" }]);
    const result = await runListEditions(client(endpoint), {
      work_id: "cb100000010",
      limit: 10,
      page: 1,
    });

    const editions = payloadOf(result).editions as Array<{ digitised: Array<{ url: string }> }>;
    const links = editions.flatMap((edition) => edition.digitised);

    // The links are there, in full, for a person to open.
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(isGallicaAddress(link.url)).toBe(true);
    }
    // And nothing was asked of that host.
    expect(endpoint.urls().every((url) => new URL(url).hostname === ALLOWED_HOST)).toBe(true);
  });

  it("says plainly that it did not look at what is behind a link", async () => {
    const endpoint = fakeEndpoint([{ fixture: "types-person" }, { fixture: "digitised-person" }]);
    const result = await runFindDigitised(client(endpoint), {
      id: "cb100000001",
      kind: "auto",
      limit: 20,
    });
    expect(textOf(result)).toContain("never requests gallica.bnf.fr");
  });

  it("names a machine-read text without carrying any of it", async () => {
    const endpoint = fakeEndpoint([{ fixture: "editions" }]);
    const result = await runListEditions(client(endpoint), {
      work_id: "cb100000010",
      limit: 10,
      page: 1,
    });

    const editions = payloadOf(result).editions as Array<{
      digitised: Array<{ role: string; url: string; ark: string }>;
    }>;
    const ocr = editions
      .flatMap((edition) => edition.digitised)
      .filter((link) => link.role === "ocr");

    expect(ocr).toHaveLength(1);
    // What the record carries is the address of the text and nothing else: the
    // shape has no field a passage could arrive in.
    expect(Object.keys(ocr[0]!).sort()).toEqual([
      "ark",
      "from_id",
      "from_title",
      "rendering",
      "role",
      "url",
    ]);
  });
});

describe("the source tree", () => {
  it("builds no address on the Gallica host anywhere under src", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");

    const files: string[] = [];
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(path);
        } else if (entry.name.endsWith(".ts")) {
          files.push(path);
        }
      }
    };
    walk(new URL("../../src", import.meta.url).pathname);

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      // The host is named in prose and in one constant, and never assembled
      // into an address a request could be built from.
      const built = source.match(/["'`]https?:\/\/[^"'`]*gallica\.bnf\.fr[^"'`]*["'`]/g) ?? [];
      expect(built, `${file} builds a Gallica address`).toEqual([]);
    }
  });
});
