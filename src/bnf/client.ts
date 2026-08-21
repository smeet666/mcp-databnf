/**
 * The one place that talks to data.bnf.fr.
 *
 * It holds a single rate limiter and a single cache, so pacing applies to the
 * server as a whole rather than to whichever tool happens to be running. It
 * imports nothing from the MCP layer and is published on its own, so the same
 * code serves a plain script.
 *
 * Every read runs a query, parses it and only then stores: an answer nobody
 * could parse must not be served back for the rest of the cache's lifetime.
 *
 * Every read also carries the moment the metadata came off the endpoint. The
 * licence asks for the date of retrieval alongside the source, so that date is
 * a value the layer produces rather than something a caller is trusted to add.
 */

import type { Config, Logger } from "../config.js";
import {
  MAX_ALLOWED_INTERVAL_MS,
  MIN_ALLOWED_INTERVAL_MS,
  createLogger,
  loadConfig,
} from "../config.js";
import { notFound } from "../errors.js";
import type {
  AuthorDetail,
  AuthorSummary,
  AuthoredWork,
  DigitisedLink,
  Edition,
  Page,
  WorkDetail,
  WorkSummary,
} from "../types.js";
import { REPO_URL } from "../version.js";
import { Cache } from "./cache.js";
import { SPARQL_ENDPOINT } from "./endpoint.js";
import type { SparqlResults } from "./http.js";
import { runQuery } from "./http.js";
import {
  authorQuery,
  digitisedForPersonQuery,
  digitisedForWorkQuery,
  editionsQuery,
  kindQuery,
  searchAuthorsQuery,
  searchWorksQuery,
  workQuery,
  worksByCreatorQuery,
} from "./queries.js";
import {
  toAuthorDetail,
  toAuthorSummaries,
  toAuthoredWorks,
  toDigitisedLinks,
  toEditions,
  toTypes,
  toWorkDetail,
  toWorkSummaries,
} from "./parse.js";
import { RateLimiter } from "./rateLimiter.js";
import type { EntityId, SearchReading } from "./sparql.js";
import { parseEntityId, readSearchText, toIndexTerms, toSearchWords } from "./sparql.js";

/** The class data.bnf.fr types a person with. */
const PERSON_CLASS = "http://xmlns.com/foaf/0.1/Person";

/**
 * The classes data.bnf.fr types a work with.
 *
 * Two vocabularies say the same thing here, and a record carries both. Either
 * one is enough, because a record carrying one has always carried the other.
 */
const WORK_CLASSES = new Set([
  "http://rdvocab.info/uri/schema/FRBRentitiesRDA/Work",
  "http://rdaregistry.info/Elements/c/#C10001",
]);

export interface ClientOptions {
  config?: Partial<Config>;
  logger?: Logger;
  fetchImpl?: typeof fetch;
}

/** Every read reports where the value came from and when it was retrieved. */
export interface Read<T> {
  data: T;
  cached: boolean;
  /**
   * When the metadata came off data.bnf.fr, as an ISO 8601 instant.
   *
   * A cached answer keeps the moment it was first read. Reporting the moment it
   * was served would state a date of retrieval that never happened, which is
   * exactly the claim the licence asks to be accurate.
   */
  retrievedAt: string;
  /** Rows the endpoint sent that could not be read, which paging still counts. */
  skipped?: number;
}

/**
 * What this server owes the BnF, applied to whatever it is handed.
 *
 * A configuration object assembled by a caller has not been through
 * `loadConfig`, so it can carry a missing value, a value of the wrong shape, or
 * a User-Agent that names somebody else. Every bound the environment path
 * enforces is enforced here too: the published `./client` entry point is the
 * one a program uses, and it would be a strange guarantee that held only for
 * the executable.
 *
 * Three of these bounds are about what one call can cost the service. A retry
 * budget of two hundred turns a single lookup into two hundred requests against
 * an endpoint that is already failing. A deadline of an hour holds the one
 * request slot for an hour. A cache of zero entries evicts each value as it is
 * written, which switches off the caching that the three-second floor is set
 * against.
 */
function withGuarantees(config: Config): Config {
  const defaults = loadConfig({});

  /**
   * A setting that is absent or unreadable falls back, and one outside its
   * range is brought inside it. Refusing outright is what the environment path
   * does, because a person reads stderr; a program handed an object does not.
   */
  const bounded = (value: unknown, fallback: number, min: number, max: number): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
  };

  const claimed = typeof config.userAgent === "string" ? config.userAgent.trim() : "";
  const identifier = defaults.userAgent;

  return {
    ...config,
    // A caller may say who they are. Appending rather than replacing means the
    // BnF can always tell which software is calling, and reach someone.
    userAgent:
      claimed === "" || claimed.includes(REPO_URL) ? identifier : `${claimed} ${identifier}`,
    minIntervalMs: bounded(
      config.minIntervalMs,
      defaults.minIntervalMs,
      MIN_ALLOWED_INTERVAL_MS,
      MAX_ALLOWED_INTERVAL_MS,
    ),
    timeoutMs: bounded(config.timeoutMs, defaults.timeoutMs, 1000, 300_000),
    maxRetries: bounded(config.maxRetries, defaults.maxRetries, 0, 8),
    cacheTtlMs: bounded(config.cacheTtlMs, defaults.cacheTtlMs, 0, 86_400_000),
    cacheMaxEntries: bounded(config.cacheMaxEntries, defaults.cacheMaxEntries, 1, 5000),
  };
}

export class BnfClient {
  private readonly config: Config;
  private readonly logger: Logger;
  private readonly limiter: RateLimiter;
  private readonly cache: Cache<unknown>;
  /** Questions already on the wire, so an identical one waits instead of asking. */
  private readonly inFlight = new Map<string, Promise<Read<unknown>>>();
  private readonly fetchImpl: typeof fetch | undefined;

  constructor(options: ClientOptions = {}) {
    const base = { ...loadConfig(), ...options.config };
    this.config = withGuarantees(base);
    this.logger = options.logger ?? createLogger(this.config.logLevel);
    this.limiter = new RateLimiter({ intervalMs: this.config.minIntervalMs });
    this.cache = new Cache(this.config.cacheTtlMs, this.config.cacheMaxEntries);
    this.fetchImpl = options.fetchImpl;
  }

  /** The pacing in force, which widens when the endpoint pushes back. */
  get intervalMs(): number {
    return this.limiter.currentIntervalMs;
  }

  /** What the BnF sees this client call itself. */
  get userAgent(): string {
    return this.config.userAgent;
  }

  /** The deadline one query is given, which callers report rather than guess. */
  get timeoutMs(): number {
    return this.config.timeoutMs;
  }

  /** The one address this client sends anything to. */
  get endpoint(): string {
    return SPARQL_ENDPOINT;
  }

  /**
   * `cacheKey` is stated rather than taken from the query, because two reads of
   * one query can produce different values: a list cut to five rows is not the
   * same value as the same list cut to twenty, and serving one for the other
   * would answer a size the caller never asked for.
   */
  private read<T>(
    cacheKey: string,
    query: string,
    parse: (results: SparqlResults) => T,
  ): Promise<Read<T>> {
    const hit = this.cache.get(cacheKey) as { value: T; retrievedAt: number } | undefined;
    if (hit !== undefined) {
      this.logger.debug(`cache hit ${cacheKey}`);
      return Promise.resolve({
        data: hit.value,
        cached: true,
        retrievedAt: new Date(hit.retrievedAt).toISOString(),
      });
    }

    // Two callers asking one question at the same moment both miss the cache,
    // because the first has not answered yet. Sharing the flight means the BnF
    // is asked once, which is the point of the cache in the first place.
    const flying = this.inFlight.get(cacheKey);
    if (flying !== undefined) {
      this.logger.debug(`joining a request already in flight for ${cacheKey}`);
      return flying as Promise<Read<T>>;
    }

    const flight = this.fetchAndParse(cacheKey, query, parse);
    this.inFlight.set(cacheKey, flight as Promise<Read<unknown>>);
    // A failure is never remembered, so the next caller asks again rather than
    // being handed the failure of somebody else's request.
    return flight.finally(() => this.inFlight.delete(cacheKey));
  }

  private async fetchAndParse<T>(
    cacheKey: string,
    query: string,
    parse: (results: SparqlResults) => T,
  ): Promise<Read<T>> {
    const results = await this.limiter.schedule(() =>
      runQuery({
        query,
        userAgent: this.config.userAgent,
        timeoutMs: this.config.timeoutMs,
        maxRetries: this.config.maxRetries,
        limiter: this.limiter,
        logger: this.logger,
        ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}),
      }),
    );

    // The moment is taken once the answer is in hand, so it names when the
    // metadata was read rather than when the request left.
    const retrievedAt = Date.now();
    const data = parse(results);
    this.cache.set(cacheKey, data, retrievedAt);
    return { data, cached: false, retrievedAt: new Date(retrievedAt).toISOString() };
  }

  /** Read an identifier a caller wrote, refusing anything this dataset cannot address. */
  identify(input: string): EntityId {
    return parseEntityId(input);
  }

  /** The words a search will actually look for, which a tool reports back. */
  words(input: string): string[] {
    return toSearchWords(input);
  }

  /**
   * The terms the index requires, which is what a row's presence rests on.
   *
   * The index splits inside a word at an apostrophe and at a hyphen, so a word
   * a caller wrote as one can reach it as two, each required on its own.
   */
  indexTerms(words: readonly string[]): string[] {
    return toIndexTerms(words);
  }

  /**
   * How a piece of caller text became the terms the search was run with.
   *
   * A tool reports the reading back, so the same reading has to be the one the
   * query was built from: the words, the terms the index makes of them, and
   * the characters that reached neither.
   */
  searchReading(input: string): SearchReading {
    return readSearchText(input);
  }

  searchAuthors(name: string, limit: number, offset: number): Promise<Read<Page<AuthorSummary>>> {
    const words = toSearchWords(name);
    const query = searchAuthorsQuery(words, limit, offset);
    return this.read(`authors:${words.join("+")}:${limit}:${offset}`, query, (results) =>
      toAuthorSummaries(results, limit),
    );
  }

  async getAuthor(id: EntityId): Promise<Read<AuthorDetail>> {
    const result = await this.read(`author:${id.id}`, authorQuery(id), (results) =>
      toAuthorDetail(results, id.id, id.pageUrl),
    );

    // The record decides what it is, and a name is not the test: a subject
    // heading and a corporate body both carry one. Answering with a person
    // record for either would put a date of birth beside something that was
    // never born, and report its absence as a fact about a life.
    if (!result.data.types.includes(PERSON_CLASS)) {
      await this.refuse(id, "a person", "get_work reads a work.");
    }
    return result;
  }

  /**
   * Say what an address is, when it is not the kind of thing that was asked for.
   *
   * A record the catalogue does not describe at all and a record describing
   * something else are two different answers, and only one of them means the
   * caller should go looking elsewhere.
   */
  private async refuse(id: EntityId, wanted: string, hint: string): Promise<never> {
    // A detail query gathers the classes of everything it walks through, so the
    // list it leaves behind is longer on one tool than on another and one
    // record would be described differently depending on which refused it. What
    // the address itself answers is one list, and it is the one every refusal
    // states, whatever the caller was reading at the time.
    const known = (await this.read(`types:${id.id}`, kindQuery(id), toTypes)).data;

    if (known.length === 0) {
      throw notFound(`data.bnf.fr describes nothing at "${id.id}".`, {
        hint: "Find the identifier with search_authors or search_works rather than writing one.",
        url: id.pageUrl,
      });
    }
    throw notFound(
      `"${id.id}" is described by data.bnf.fr, and it is not ${wanted}: it is typed ${known.join(", ")}.`,
      { hint, url: id.pageUrl },
    );
  }

  searchWorks(title: string, limit: number, offset: number): Promise<Read<Page<WorkSummary>>> {
    const words = toSearchWords(title);
    const query = searchWorksQuery(words, limit, offset);
    return this.read(`works:${words.join("+")}:${limit}:${offset}`, query, (results) =>
      toWorkSummaries(results, limit),
    );
  }

  async getWork(id: EntityId): Promise<Read<WorkDetail>> {
    const result = await this.read(`work:${id.id}`, workQuery(id), (results) =>
      toWorkDetail(results, id.id, id.iri, id.pageUrl),
    );

    // An edition carries a title too, and its ARK names a manifestation rather
    // than a work. Accepting one here would hand back an identifier described
    // as the work's, which is the identifier a citation would then carry.
    if (!result.data.types.some((type) => WORK_CLASSES.has(type))) {
      await this.refuse(
        id,
        "a work",
        "get_author reads a person, and list_editions reads the editions of a work.",
      );
    }
    return result;
  }

  /**
   * The works one person is named the creator of.
   *
   * The record is not checked here. A person the catalogue credits with nothing
   * and an address that names no person both answer with no rows, and telling
   * them apart costs a second query that only an empty answer needs.
   */
  worksByAuthor(id: EntityId, limit: number, offset: number): Promise<Read<Page<AuthoredWork>>> {
    return this.read(
      `author-works:${id.id}:${limit}:${offset}`,
      worksByCreatorQuery(id, limit, offset),
      (results) => toAuthoredWorks(results, limit),
    );
  }

  listEditions(id: EntityId, limit: number, offset: number): Promise<Read<Page<Edition>>> {
    const query = editionsQuery(id, limit, offset);
    return this.read(`editions:${id.id}:${limit}:${offset}`, query, (results) =>
      toEditions(results, limit),
    );
  }

  /** Digitised documents attached to a work and to its editions. */
  digitisedForWork(id: EntityId, limit: number): Promise<Read<Page<DigitisedLink>>> {
    return this.read(
      `digitised-work:${id.id}:${limit}`,
      digitisedForWorkQuery(id, limit),
      (results) => toDigitisedLinks(results, limit),
    );
  }

  /** Digitised documents attached to a person and to the editions of their works. */
  digitisedForPerson(id: EntityId, limit: number): Promise<Read<Page<DigitisedLink>>> {
    return this.read(
      `digitised-person:${id.id}:${limit}`,
      digitisedForPersonQuery(id, limit),
      (results) => toDigitisedLinks(results, limit),
    );
  }

  /** What an address is typed as, which tells a person from a work. */
  types(id: EntityId): Promise<Read<string[]>> {
    return this.read(`types:${id.id}`, kindQuery(id), toTypes);
  }
}
