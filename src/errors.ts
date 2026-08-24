/**
 * One error type, carrying a code the caller can branch on.
 *
 * The distinction that matters most is between "the BnF describes no such
 * thing" and "the question could not be asked". Collapsing the two lets a model
 * report an absence it never established, which is a false statement about a
 * catalogue rather than a missing feature.
 */

export type ErrorCode =
  /** data.bnf.fr answered, and describes no such person, work or edition. */
  | "not_found"
  /** The arguments cannot produce a query. */
  | "invalid_input"
  /** data.bnf.fr asked this client to slow down or refused it for now. */
  | "rate_limited"
  /** An answer arrived in a shape this server cannot read. */
  | "parse_failure"
  /** The request could not be completed. */
  | "network_error"
  /** The request was abandoned before an answer arrived. */
  | "timeout";

export interface ErrorDetails {
  /** What the caller can do about it, when there is something. */
  hint?: string;
  /** The address that produced the failure, for a bug report. */
  url?: string;
  status?: number;
  /** What was raised underneath, kept for the bug report the hint asks for. */
  cause?: unknown;
}

export class BnfError extends Error {
  readonly code: ErrorCode;
  readonly details: ErrorDetails;

  constructor(code: ErrorCode, message: string, details: ErrorDetails = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "BnfError";
    this.code = code;
    this.details = details;
  }
}

export const notFound = (message: string, details?: ErrorDetails) =>
  new BnfError("not_found", message, details);

export const invalidInput = (message: string, hint?: string) =>
  new BnfError("invalid_input", message, hint ? { hint } : {});

export const rateLimited = (message: string, details?: ErrorDetails) =>
  new BnfError("rate_limited", message, {
    hint: "Wait a moment and ask again. This says nothing about whether the BnF describes what you asked for.",
    ...details,
  });

export const parseFailure = (message: string, details?: ErrorDetails) =>
  new BnfError("parse_failure", message, {
    hint: "data.bnf.fr may have changed how it answers. Please report this at https://github.com/smeet666/mcp-databnf/issues with the arguments you used.",
    ...details,
  });

export const networkError = (message: string, details?: ErrorDetails) =>
  new BnfError("network_error", message, details);

export const timeout = (message: string, details?: ErrorDetails) =>
  new BnfError("timeout", message, details);
