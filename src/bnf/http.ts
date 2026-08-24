/**
 * One query sent to the endpoint, with a deadline and bounded retries.
 *
 * Two things separate a retry worth making from one that only adds load. A
 * refusal that carries a time to come back is obeyed rather than guessed at,
 * and an answer the service meant is never retried: asking again for something
 * that is not there wastes a request and delays the honest answer.
 *
 * The query travels in the body of a POST. A long query in a query string is
 * refused by an intermediary before it reaches the service, and a POST keeps the
 * text out of every access log between here and there.
 */

import {
  invalidInput,
  networkError,
  parseFailure,
  rateLimited,
  timeout as timeoutError,
} from "../errors.js";
import type { Logger } from "../config.js";
import { SPARQL_ENDPOINT, assertRequestable } from "./endpoint.js";
import type { RateLimiter } from "./rateLimiter.js";

/** The JSON shape a SPARQL SELECT answers with. */
export interface SparqlTerm {
  type: "uri" | "literal" | "typed-literal" | "bnode";
  value: string;
  datatype?: string;
  "xml:lang"?: string;
}

export type SparqlRow = Record<string, SparqlTerm | undefined>;

export interface SparqlResults {
  head: { vars?: string[] };
  results: { bindings: SparqlRow[] };
}

export interface QueryOptions {
  query: string;
  userAgent: string;
  timeoutMs: number;
  maxRetries: number;
  limiter: RateLimiter;
  logger: Logger;
  fetchImpl?: typeof fetch;
}

/** Statuses worth another attempt: the service is busy, not answering "no". */
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);
/**
 * Statuses that mean the service is refusing for now and naming a delay.
 *
 * These produce a `rate_limited` error and honour a `Retry-After` header. A
 * server error is a different claim, so it keeps its own code even though it
 * widens the spacing the same way.
 */
const PUSH_BACK = new Set([429, 503]);

/**
 * The longest wait worth taking rather than reporting.
 *
 * A refusal may name any delay, and an hour is a legal answer. Sleeping through
 * it holds the one request slot this server has, so every other tool waits
 * behind a call whose caller has long since given up. Past this point the wait
 * is the answer, and the caller decides what to do with it.
 */
const LONGEST_WAIT_MS = 30_000;

/**
 * How many times a query that never answered is worth repeating.
 *
 * A query that did not respond within its budget is one the planner is
 * struggling with. Repeating it adds the same load again, and each attempt
 * holds the slot for the full deadline.
 */
const RETRIES_AFTER_SILENCE = 1;

/**
 * Redirects worth following before calling it a loop.
 *
 * The query service answers directly, so one hop covers a host that has moved
 * and two cover a scheme change on top of it. Beyond that the answer is a
 * redirect rather than a result.
 */
const MAX_REDIRECTS = 2;

/**
 * Read a Retry-After header, which is either a number of seconds or a date.
 * Returns null when it says neither, so the caller falls back to its own wait.
 */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) {
    return null;
  }
  return Math.max(0, at - now);
}

/** Growing wait with jitter, so several clients do not return in step. */
function backoffMs(attempt: number): number {
  const base = Math.min(16_000, 1000 * 2 ** attempt);
  return base + Math.floor(Math.random() * 500);
}

/**
 * What a Virtuoso says when it will not run a query.
 *
 * It answers in plain text rather than in the result format, and the leading
 * code says which half went wrong: a compiler code means the query as written
 * could not be understood, and a runtime code means it was understood and then
 * abandoned, usually because it asked for more of the graph than the service
 * will spend on one caller.
 */
export function readEngineError(
  body: string,
): { kind: "compile" | "runtime"; text: string } | null {
  const match = /^Virtuoso\s+(\w+)\s+Error\s+([\s\S]*)$/.exec(body.trim());
  if (!match) {
    return null;
  }
  const state = match[1] ?? "";
  const text = (match[2] ?? "").split("\n")[0]?.trim() ?? "";
  // 37000 is the compiler's own state; the rest come from execution.
  return { kind: state === "37000" ? "compile" : "runtime", text };
}

async function postOnce(
  options: QueryOptions,
  signal: AbortSignal,
): Promise<{ status: number; headers: Headers; body: string; ok: boolean }> {
  assertRequestable(SPARQL_ENDPOINT);
  const doFetch = options.fetchImpl ?? fetch;

  const form = new URLSearchParams();
  form.set("query", options.query);
  // The endpoint answers in XML when only the Accept header asks for JSON, so
  // the format is stated in the request itself as well.
  form.set("format", "application/sparql-results+json");

  // Redirects are handled here rather than by fetch. Following one automatically
  // would take the request to whatever host the answer names, and the guard
  // above only ever sees the address this file wrote: a redirect to Gallica
  // would cross the licence boundary with no code having decided to.
  let target = SPARQL_ENDPOINT;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await doFetch(target, {
      method: "POST",
      signal,
      redirect: "manual",
      headers: {
        "user-agent": options.userAgent,
        accept: "application/sparql-results+json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });

    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location !== null) {
      const next = new URL(location, target).toString();
      // Checked before the next request rather than after it, so a refused
      // address is one this client never called.
      assertRequestable(next);
      target = next;
      continue;
    }

    return {
      status: response.status,
      headers: response.headers,
      body: await response.text(),
      ok: response.ok,
    };
  }

  throw networkError(`data.bnf.fr redirected this request more than ${MAX_REDIRECTS} times.`, {
    url: SPARQL_ENDPOINT,
  });
}

/** What a refusal from the endpoint amounts to, and what it costs the pacing. */
type Refusal =
  | { kind: "refused"; error: Error; pushBack: boolean }
  | { kind: "again"; waitMs: number; pushBack: boolean };

/**
 * Read a status the endpoint answered with, apart from the loop that retries.
 *
 * Anything worth another attempt means the service is struggling, so the gap
 * widens whether or not the status is one that names a delay: a Virtuoso under
 * load answers 500 as readily as 503. A status the service read the query for
 * and would not run is not a network failure, and calling it one invites a
 * retry of something only the query can fix.
 */
function readRefusal(
  response: { status: number; body: string; headers: Headers },
  attempt: number,
  maxRetries: number,
): Refusal {
  const pushBack = RETRYABLE.has(response.status);

  if (PUSH_BACK.has(response.status)) {
    const asked = parseRetryAfter(response.headers.get("retry-after"));

    if (asked !== null && asked > LONGEST_WAIT_MS) {
      return {
        kind: "refused",
        pushBack,
        error: rateLimited(
          `data.bnf.fr asked this client to wait ${Math.round(asked / 1000)} seconds (HTTP ${response.status}).`,
          { url: SPARQL_ENDPOINT, status: response.status },
        ),
      };
    }
    if (attempt >= maxRetries) {
      return {
        kind: "refused",
        pushBack,
        error: rateLimited(
          `data.bnf.fr asked this client to slow down (HTTP ${response.status}).`,
          {
            url: SPARQL_ENDPOINT,
            status: response.status,
          },
        ),
      };
    }
    return { kind: "again", pushBack, waitMs: asked ?? backoffMs(attempt) };
  }

  if (RETRYABLE.has(response.status) && attempt < maxRetries) {
    return { kind: "again", pushBack, waitMs: backoffMs(attempt) };
  }

  if (response.status === 400 || response.status === 422) {
    const engine = readEngineError(response.body);
    return {
      kind: "refused",
      pushBack,
      error: invalidInput(
        `data.bnf.fr would not run this query${engine?.text ? `: ${engine.text}` : "."}`,
        "Try fewer or plainer words. If this keeps happening with ordinary input, please report it.",
      ),
    };
  }

  return {
    kind: "refused",
    pushBack,
    error: networkError(`data.bnf.fr answered HTTP ${response.status}.`, {
      url: SPARQL_ENDPOINT,
      status: response.status,
    }),
  };
}

/**
 * What a thrown attempt amounts to, or the error it has become.
 *
 * An error this module raised on purpose already says what happened, and is
 * passed straight on. Silence is given fewer attempts than a refusal: a query
 * spanning the whole catalogue can take longer than the service will spend on
 * it, and asking again costs both sides the same wait.
 */
function readFailure(
  error: unknown,
  attempts: { attempt: number; maxRetries: number; timeoutMs: number },
): Error {
  const { attempt, maxRetries, timeoutMs } = attempts;

  if (error instanceof Error && error.name === "BnfError") {
    throw error;
  }

  if (error instanceof Error && error.name === "AbortError") {
    if (attempt >= Math.min(maxRetries, RETRIES_AFTER_SILENCE)) {
      throw timeoutError(
        `No answer from data.bnf.fr within ${timeoutMs}ms. A query spanning the whole catalogue can take longer than the service will spend on it.`,
        { url: SPARQL_ENDPOINT },
      );
    }
    return error;
  }

  const failure = error instanceof Error ? error : new Error(String(error));
  if (attempt >= maxRetries) {
    throw networkError(`Could not reach data.bnf.fr: ${failure.message}`, { url: SPARQL_ENDPOINT });
  }
  return failure;
}

/** Send one query and return the parsed result set. */
export async function runQuery(options: QueryOptions): Promise<SparqlResults> {
  const { timeoutMs, maxRetries, limiter, logger } = options;

  let lastError: Error | null = null;
  /** Honoured before the next attempt rather than slept after the last one. */
  let askedWaitMs = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (askedWaitMs > 0) {
      logger.debug(`waiting ${askedWaitMs}ms, as asked`);
      // Read once into a constant: the timer closes over what this attempt was
      // told to wait, not over whatever a later attempt puts there.
      const asked = askedWaitMs;
      await new Promise((resolve) => setTimeout(resolve, asked));
      askedWaitMs = 0;
    }
    await limiter.beforeRequest();

    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), timeoutMs);

    try {
      logger.debug(`POST ${SPARQL_ENDPOINT} (${options.query.length} characters)`);
      const response = await postOnce(options, controller.signal);

      if (response.ok) {
        // The body decides whether this was an answer. This endpoint says "I
        // will spend no more on you" with a status of 200 and either an empty
        // body or a runtime error in plain text, so crediting the status line
        // would narrow the spacing at the one moment it has to widen.
        let parsed: SparqlResults;
        try {
          parsed = parseResults(response.body);
        } catch (error) {
          limiter.pushBack();
          throw error;
        }
        limiter.succeeded();
        return parsed;
      }

      const verdict = readRefusal(response, attempt, maxRetries);
      if (verdict.pushBack) {
        limiter.pushBack();
      }
      if (verdict.kind === "refused") {
        throw verdict.error;
      }
      askedWaitMs = verdict.waitMs;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      clearTimeout(deadline);

      lastError = readFailure(error, { attempt, maxRetries, timeoutMs });
      askedWaitMs = backoffMs(attempt);
    } finally {
      clearTimeout(deadline);
    }
  }

  throw networkError(
    `Could not reach data.bnf.fr: ${lastError?.message ?? "no attempt was made"}`,
    {
      url: SPARQL_ENDPOINT,
    },
  );
}

/**
 * Read a result set out of a body that arrived with a success status.
 *
 * The endpoint answers 200 with an empty body when it abandons a query part way
 * through, which is the same silence as a result set holding no rows and means
 * the opposite. An empty body is therefore a failure to read rather than an
 * absence, so nothing downstream can report "the BnF describes none" on the
 * strength of a query that was never finished.
 */
export function parseResults(body: string): SparqlResults {
  if (body.trim() === "") {
    throw parseFailure(
      "data.bnf.fr returned an empty body, which is what it does when it abandons a query part way through.",
      { url: SPARQL_ENDPOINT },
    );
  }

  const engine = readEngineError(body);
  if (engine) {
    if (engine.kind === "compile") {
      throw invalidInput(
        `data.bnf.fr could not read this query: ${engine.text}`,
        "Try fewer or plainer words. If this keeps happening with ordinary input, please report it.",
      );
    }
    throw timeoutError(`data.bnf.fr started this query and gave it up: ${engine.text}`, {
      url: SPARQL_ENDPOINT,
    });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch (cause) {
    throw parseFailure("data.bnf.fr answered with something that is not JSON.", {
      url: SPARQL_ENDPOINT,
      cause,
    });
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    !("results" in payload) ||
    typeof (payload as SparqlResults).results !== "object" ||
    !Array.isArray((payload as SparqlResults).results?.bindings)
  ) {
    throw parseFailure("data.bnf.fr answered with JSON that is not a SPARQL result set.", {
      url: SPARQL_ENDPOINT,
    });
  }

  return payload as SparqlResults;
}
