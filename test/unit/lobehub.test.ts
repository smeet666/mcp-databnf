/**
 * The LobeHub manifest, against the package it describes.
 *
 * `lhm.plugin.json` is what the LobeHub marketplace publishes, and its owner can
 * change nothing else on the listing: the deployment options the marketplace
 * derives from the repository stay out of reach. A manifest left behind a
 * release keeps the listing on that release, and the marketplace page shows no
 * sign of it.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");

const packaged = JSON.parse(read("../../package.json")) as { name: string; version: string };
const lobehub = JSON.parse(read("../../lhm.plugin.json")) as {
  identifier: string;
  name: string;
  version: string;
  tools: { name: string }[];
};
const manifest = JSON.parse(read("../../packaging/manifest.json")) as {
  tools: { name: string }[];
};

describe("the LobeHub manifest", () => {
  it("carries the package version", () => {
    expect(lobehub.version, "lhm.plugin.json version left package.json").toBe(packaged.version);
  });

  it("names the package it lists", () => {
    expect(lobehub.name).toBe(packaged.name);
    expect(lobehub.identifier).toBe(`smeet666-${packaged.name}`);
  });

  it("lists the tools the extension manifest announces", () => {
    const names = (tools: { name: string }[]): string[] =>
      tools.map((each) => each.name).sort((a, b) => a.localeCompare(b));

    expect(names(lobehub.tools)).toEqual(names(manifest.tools));
  });
});
