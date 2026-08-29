/**
 * Writes into packaging/manifest.json what the built server declares.
 *
 * A host reads the manifest before installing anything, and a directory reads
 * the bundle it is deposited as: both are answered from this file. The tool
 * names and their argument schemas therefore come from the server itself, since
 * a schema kept by hand is a second declaration that drifts from the first.
 *
 * The one-line description stays written by hand, because it addresses a person
 * choosing whether to install rather than a model choosing whether to call. A
 * tool the manifest does not know yet takes the opening sentence of the
 * server's own description, and says so, so the line can be shortened later.
 *
 * usage: node scripts/build-manifest-tools.mjs   (after npm run build)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = join(import.meta.dirname, "..");
const manifestPath = join(root, "packaging", "manifest.json");

const client = new Client({ name: "build-manifest-tools", version: "0.0.0" });
await client.connect(
  new StdioClientTransport({ command: "node", args: [join(root, "dist", "index.js")] }),
);
const { tools } = await client.listTools();
await client.close();

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const written = new Map((manifest.tools ?? []).map((tool) => [tool.name, tool.description]));

manifest.tools = tools.map((tool) => {
  let description = written.get(tool.name);
  if (description === undefined) {
    description = `${tool.description.split(". ")[0]}.`.replace(/\.\.$/, ".");
    process.stderr.write(`${tool.name}: took the server's opening sentence; shorten it by hand\n`);
  }
  return { name: tool.name, description, inputSchema: tool.inputSchema };
});

for (const name of written.keys()) {
  if (!tools.some((tool) => tool.name === name)) {
    process.stderr.write(`${name}: dropped, the server no longer registers it\n`);
  }
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
process.stderr.write(`${manifest.tools.length} tools written\n`);
process.exit(0);
