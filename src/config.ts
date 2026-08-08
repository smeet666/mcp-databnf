/**
 * Settings, read from the environment.
 *
 * A value that cannot be read warns and falls back rather than stopping the
 * server: a typo in one variable should not take away every tool. Warnings go
 * to stderr, because stdout carries the protocol and anything written there
 * corrupts the session.
 */

import { PKG_VERSION, REPO_URL } from "./version.js";

export const LOG_LEVELS = ["silent", "error", "info", "debug"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * The narrowest spacing this client will ever use, in milliseconds.
 *
 * The BnF publishes no rate for the SPARQL endpoint. It publishes
 * `Crawl-delay: 5` for gallica.bnf.fr and enforces it there by banning an
 * address, so five seconds is the only figure the institution has stated about
 * how fast it wants to be read. Three seconds is the floor here because a
 * SPARQL query is one request where a crawl is thousands, and because every
 * answer is cached: the spacing that matters is the one between two distinct
 * questions.
 *
 * Configuration can slow the server down. It cannot take the spacing below this
 * floor, whether the setting arrives through the environment or through a
 * configuration object handed to the published client.
 */
export const MIN_ALLOWED_INTERVAL_MS = 3000;
/** Beyond this a request would look hung rather than paced. */
export const MAX_ALLOWED_INTERVAL_MS = 120_000;
/** The spacing in force when nothing asks for more. */
export const DEFAULT_INTERVAL_MS = 3000;

/**
 * The deadline one query is given.
 *
 * Measured against the live endpoint, a lookup by identifier answers in well
 * under a second, while a full-text query over titles takes several seconds and
 * a query the planner handles badly is dropped by the server with an empty
 * body. Sixty seconds clears the slow honest case without holding the single
 * request slot for a query that will never answer.
 */
export const DEFAULT_TIMEOUT_MS = 60_000;

export interface Config {
  userAgent: string;
  minIntervalMs: number;
  timeoutMs: number;
  maxRetries: number;
  cacheTtlMs: number;
  cacheMaxEntries: number;
  logLevel: LogLevel;
}

export const DEFAULT_USER_AGENT = `mcp-databnf/${PKG_VERSION} (+${REPO_URL})`;

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export function createLogger(level: LogLevel): Logger {
  const rank = LOG_LEVELS.indexOf(level);
  const write = (at: LogLevel, message: string) => {
    if (rank === 0 || LOG_LEVELS.indexOf(at) > rank) return;
    process.stderr.write(`[mcp-databnf] ${at}: ${message}\n`);
  };
  return {
    debug: (m) => write("debug", m),
    info: (m) => write("info", m),
    // A warning goes out at the error level so it survives the default
    // setting: a caller has to know that rows were dropped.
    warn: (m) => write("error", m),
    error: (m) => write("error", m),
  };
}

function readInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    process.stderr.write(
      `[mcp-databnf] error: ${name}="${raw}" is not a whole number; using ${fallback}.\n`,
    );
    return fallback;
  }
  if (value < min || value > max) {
    // Clamping silently would let a caller believe a setting took effect when
    // the opposite is true, so the refusal is stated and the default stands.
    process.stderr.write(
      `[mcp-databnf] error: ${name}=${value} is outside ${min}..${max}; using ${fallback}.\n`,
    );
    return fallback;
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const level = env.BNF_LOG_LEVEL as LogLevel | undefined;
  const logLevel = level && LOG_LEVELS.includes(level) ? level : "error";
  if (level && !LOG_LEVELS.includes(level)) {
    process.stderr.write(
      `[mcp-databnf] error: BNF_LOG_LEVEL="${level}" is not one of ${LOG_LEVELS.join(", ")}; using error.\n`,
    );
  }

  const custom = env.BNF_USER_AGENT?.trim();

  return {
    // A caller who wants to be recognised may say who they are, and the
    // contact address stays attached: the BnF has to be able to reach a human
    // about traffic it did not expect.
    userAgent: custom ? `${custom} ${DEFAULT_USER_AGENT}` : DEFAULT_USER_AGENT,
    minIntervalMs: readInteger(
      env,
      "BNF_MIN_INTERVAL_MS",
      DEFAULT_INTERVAL_MS,
      MIN_ALLOWED_INTERVAL_MS,
      MAX_ALLOWED_INTERVAL_MS,
    ),
    timeoutMs: readInteger(env, "BNF_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, 1000, 300_000),
    maxRetries: readInteger(env, "BNF_MAX_RETRIES", 3, 0, 8),
    cacheTtlMs: readInteger(env, "BNF_CACHE_TTL_MS", 900_000, 0, 86_400_000),
    cacheMaxEntries: readInteger(env, "BNF_CACHE_MAX_ENTRIES", 200, 1, 5000),
    logLevel,
  };
}
