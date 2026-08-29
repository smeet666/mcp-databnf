/**
 * What the manifest announces, held against what the server registers.
 *
 * A host reads packaging/manifest.json before it installs anything, and a
 * directory reads the bundle built from it. Both are answered from a file the
 * server itself never opens, so what it says is stated here as an agreement
 * rather than left to whoever edits it next.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeAll, describe, expect, it } from "vitest";
import { createLogger, loadConfig } from "../../src/config.js";
import { createServer } from "../../src/server.js";

const ROOT = join(import.meta.dirname, "..", "..");
const manifest = JSON.parse(readFileSync(join(ROOT, "packaging", "manifest.json"), "utf8")) as {
  tools: { name: string; description?: string; inputSchema?: unknown }[];
};

const alphabetically = (a: string, b: string) => a.localeCompare(b);

let tools: { name: string; inputSchema: { properties?: Record<string, unknown> } }[] = [];

beforeAll(async () => {
  const server = createServer({
    config: loadConfig({}),
    logger: createLogger("silent"),
    fetchImpl: (async () => Response.json({})) as unknown as typeof fetch,
  });
  const client = new Client({ name: "test", version: "0.0.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  const listed = await client.listTools();
  tools = listed.tools as typeof tools;
  await server.close();
});

describe("what a host is told before the server runs", () => {
  it("names every tool the server registers, and no other", () => {
    // A host reads this file before installing anything, so a tool gained
    // without a line here is announced to nobody.
    const announced = manifest.tools.map((tool) => tool.name).sort(alphabetically);
    const registered = tools.map((tool) => tool.name).sort(alphabetically);

    expect(announced).toEqual(registered);
  });

  it("carries the arguments each tool declares", () => {
    // A directory reading the bundle validates a tool against this schema, and
    // a schema kept by hand drifts from the one the server publishes.
    for (const tool of tools) {
      const declared = manifest.tools.find((each) => each.name === tool.name);
      expect(declared?.inputSchema, `${tool.name} is announced without its arguments`).toEqual(
        tool.inputSchema,
      );
    }
  });

  it("describes every tool it names, in a line of its own", () => {
    for (const tool of manifest.tools) {
      expect(
        tool.description?.trim(),
        `${tool.name} is announced without a description`,
      ).toBeTruthy();
    }
  });
});
