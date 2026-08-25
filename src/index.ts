#!/usr/bin/env node
/**
 * Entry point.
 *
 * stdout carries the protocol and nothing else: every diagnostic goes to
 * stderr, because a stray line on stdout corrupts the session for the client.
 */

import process from "node:process";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = async () => {
    await server.close().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[mcp-databnf] fatal: ${message}\n`);
  process.exit(1);
});
