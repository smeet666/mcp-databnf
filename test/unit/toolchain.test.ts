/**
 * What the configuration declares, held against what the repository installs.
 *
 * A formatter configuration names the schema it is written against, and the
 * dependency that reads it moves on its own. Nothing fails when the two part
 * company: the run prints a notice and carries on, so the drift is only visible
 * to whoever reads a green log.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const config = JSON.parse(readFileSync(join(ROOT, "biome.json"), "utf8")) as { $schema: string };
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  devDependencies: Record<string, string>;
};

describe("the formatter configuration", () => {
  it("names the schema of the version this repository installs", () => {
    const installed = pkg.devDependencies["@biomejs/biome"];

    expect(installed, "the formatter is pinned, so this is one version").toMatch(/^\d+\.\d+\.\d+$/);
    expect(config.$schema).toBe(`https://biomejs.dev/schemas/${installed}/schema.json`);
  });
});
