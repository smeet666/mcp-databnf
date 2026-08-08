/**
 * Wiring: one client, six tools, and the guidance a model reads before using
 * any of them.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BnfClient } from "./bnf/client.js";
import type { Config, Logger } from "./config.js";
import { createLogger, loadConfig } from "./config.js";
import {
  findDigitisedDescription,
  findDigitisedInput,
  findDigitisedOutput,
  runFindDigitised,
} from "./tools/findDigitised.js";
import type { FindDigitisedArgs } from "./tools/findDigitised.js";
import {
  getAuthorDescription,
  getAuthorInput,
  getAuthorOutput,
  runGetAuthor,
} from "./tools/getAuthor.js";
import type { GetAuthorArgs } from "./tools/getAuthor.js";
import { getWorkDescription, getWorkInput, getWorkOutput, runGetWork } from "./tools/getWork.js";
import type { GetWorkArgs } from "./tools/getWork.js";
import {
  listEditionsDescription,
  listEditionsInput,
  listEditionsOutput,
  runListEditions,
} from "./tools/listEditions.js";
import type { ListEditionsArgs } from "./tools/listEditions.js";
import {
  runSearchAuthors,
  searchAuthorsDescription,
  searchAuthorsInput,
  searchAuthorsOutput,
} from "./tools/searchAuthors.js";
import type { SearchAuthorsArgs } from "./tools/searchAuthors.js";
import {
  runSearchWorks,
  searchWorksDescription,
  searchWorksInput,
  searchWorksOutput,
} from "./tools/searchWorks.js";
import type { SearchWorksArgs } from "./tools/searchWorks.js";
import { PKG_VERSION } from "./version.js";

export interface CreateServerOptions {
  config?: Config;
  logger?: Logger;
  fetchImpl?: typeof fetch;
}

/** Nothing here writes or deletes; every tool only reads. */
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export const INSTRUCTIONS = [
  "Tools for data.bnf.fr, the open catalogue of the Bibliothèque nationale de France. No API key and no account are needed.",
  "The usual path is search_authors or search_works to get an identifier, then get_author, get_work or list_editions to read the record it names.",
  "The BnF publishes these metadata on one condition: name the source and state the date they were retrieved. Every answer carries 'retrieved_at' for that reason, and repeating both alongside what you show is what the licence asks for.",
  "Both searches read a full-text index that answers whether a title or a name matches and never scores how well, so rows come back in index order. Never present the first row as the best answer, and never describe a count as a ranking.",
  "One person can hold several authority records, and search_authors returns all of them: show the caller the choice rather than picking one.",
  "A work record is either established, with an ARK of its own, or provisional, addressed under 'temp-work' while a cataloguer settles it. A provisional identifier can change, so prefer an established one when citing.",
  "The catalogue describes what the BnF holds; it does not hold the texts. A record can point at a digitised copy on Gallica, and those links are returned as addresses for a person to open. This server never requests gallica.bnf.fr, because the BnF places its metadata and its digitised contents under two different regimes, so it can say a document exists at a link and nothing about what is there.",
  "This server paces itself, and a rate_limited error means the endpoint was asked to slow down, never that the thing you asked for is missing.",
  "Every result carries a source_url. Credit data.bnf.fr and link what you use.",
].join(" ");

export function createServer(options: CreateServerOptions = {}): McpServer {
  const config = options.config ?? loadConfig();
  const logger = options.logger ?? createLogger(config.logLevel);
  const client = new BnfClient({
    config,
    logger,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });

  const server = new McpServer(
    { name: "mcp-databnf", version: PKG_VERSION },
    { instructions: INSTRUCTIONS },
  );

  server.registerTool(
    "search_authors",
    {
      title: "Find a person in the BnF authority file",
      description: searchAuthorsDescription,
      inputSchema: searchAuthorsInput,
      outputSchema: searchAuthorsOutput,
      annotations: READ_ONLY,
    },
    async (args) => runSearchAuthors(client, args as SearchAuthorsArgs),
  );

  server.registerTool(
    "get_author",
    {
      title: "Read a person's record",
      description: getAuthorDescription,
      inputSchema: getAuthorInput,
      outputSchema: getAuthorOutput,
      annotations: READ_ONLY,
    },
    async (args) => runGetAuthor(client, args as GetAuthorArgs),
  );

  server.registerTool(
    "search_works",
    {
      title: "Find a work by its title",
      description: searchWorksDescription,
      inputSchema: searchWorksInput,
      outputSchema: searchWorksOutput,
      annotations: READ_ONLY,
    },
    async (args) => runSearchWorks(client, args as SearchWorksArgs),
  );

  server.registerTool(
    "get_work",
    {
      title: "Read a work's record",
      description: getWorkDescription,
      inputSchema: getWorkInput,
      outputSchema: getWorkOutput,
      annotations: READ_ONLY,
    },
    async (args) => runGetWork(client, args as GetWorkArgs),
  );

  server.registerTool(
    "list_editions",
    {
      title: "List the editions of a work",
      description: listEditionsDescription,
      inputSchema: listEditionsInput,
      outputSchema: listEditionsOutput,
      annotations: READ_ONLY,
    },
    async (args) => runListEditions(client, args as ListEditionsArgs),
  );

  server.registerTool(
    "find_digitised",
    {
      title: "Gather the digitised documents attached to a record",
      description: findDigitisedDescription,
      inputSchema: findDigitisedInput,
      outputSchema: findDigitisedOutput,
      annotations: READ_ONLY,
    },
    async (args) => runFindDigitised(client, args as FindDigitisedArgs),
  );

  logger.info(
    `ready: user-agent="${config.userAgent}", ${config.minIntervalMs}ms between requests, cache ${config.cacheTtlMs}ms`,
  );

  return server;
}
