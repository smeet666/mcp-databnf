/**
 * One version number, in the files that publish it.
 *
 * The package, the registry descriptor, the extension manifest and the constant
 * the server reports all carry it, and each is read by someone different. Two of
 * them disagreeing leaves a host announcing one release while serving another's
 * file, and nothing on screen says so.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PKG_VERSION } from "../../src/version.js";

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");

const packaged = JSON.parse(read("../../package.json")) as { version: string };
const registry = JSON.parse(read("../../server.json")) as {
  version: string;
  packages: { registryType: string; version: string; identifier: string }[];
};
const manifest = JSON.parse(read("../../packaging/manifest.json")) as { version: string };

describe("the version number", () => {
  it("is the same in every file that carries it", () => {
    const npmPackage = registry.packages.find((each) => each.registryType === "npm");

    expect(packaged.version.trim().length, "package.json version is empty").toBeGreaterThan(0);
    expect(registry.version, "server.json version left package.json").toBe(packaged.version);
    expect(manifest.version, "packaging/manifest.json version left package.json").toBe(
      packaged.version,
    );
    expect(PKG_VERSION, "src/version.ts left package.json").toBe(packaged.version);
    expect(npmPackage?.version, "the npm package entry left package.json").toBe(packaged.version);
  });

  it("is the one the bundle URL serves", () => {
    // The address carries a number of its own, and a hand-written one survives a
    // bump: the registry then advertises one release and serves the file of
    // another, or names a release that was skipped and answers 404.
    const bundle = registry.packages.find((each) => each.registryType === "mcpb");

    expect(bundle, "server.json declares no mcpb package").toBeDefined();
    expect(bundle?.version, "the bundle package version left package.json").toBe(packaged.version);
    expect(bundle?.identifier).toContain(`/v${packaged.version}/`);
    expect(bundle?.identifier).toContain(`-${packaged.version}.mcpb`);
  });
});
