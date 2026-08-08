/** Schemas, error mapping and rendering shared by the six tools. */

import { z } from "zod";
import { BnfError } from "../errors.js";

/**
 * The text block is what many clients render, and some render nothing else, so
 * it has to answer on its own. This ceiling is what keeps a list of editions
 * from arriving as several pages of publishers.
 */
export const MAX_TEXT_CHARS = 2400;

/**
 * The credit every answer ends with.
 *
 * The BnF publishes these metadata under one condition, stated in one sentence:
 * they may be used freely provided their source is named and the date they were
 * retrieved is stated. Both halves are built into the answer rather than left to
 * whoever renders it, because a condition a caller has to remember is a
 * condition that will be forgotten.
 */
export const SOURCE_NAME = "data.bnf.fr (Bibliothèque nationale de France)";

/** The date of retrieval, written as the calendar day it names. */
export function retrievalDay(retrievedAt: string): string {
  const day = retrievedAt.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : retrievedAt;
}

export function attribution(retrievedAt: string, sourceUrl?: string): string {
  const credit = `Source: ${SOURCE_NAME}, retrieved ${retrievalDay(retrievedAt)}`;
  return sourceUrl ? `${credit} — ${sourceUrl}` : credit;
}

export interface ToolResult {
  // The SDK's result type carries an index signature for protocol extensions.
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/** The moment the metadata came off data.bnf.fr, carried by every answer. */
export const retrievedAtSchema = z
  .string()
  .describe(
    "When these metadata were read from data.bnf.fr, as an ISO 8601 instant. The BnF licence asks for this date to be stated wherever the metadata are shown, so repeat it alongside the source.",
  );

/** A link to a digitised document, which this server describes and never opens. */
export const digitisedLinkSchema = z.object({
  ark: z.string().describe("The Gallica ARK identifying the document."),
  url: z.string().describe("Open this to see the document. This server does not read it."),
  role: z
    .enum(["reproduction", "ocr", "depiction"])
    .describe(
      "'reproduction' is the edition itself digitised. 'ocr' is the text a machine read off it. 'depiction' is an image illustrating the record, which can be a portrait or a page mentioning the subject rather than the work.",
    ),
  from_id: z.string().describe("The record this link hangs off."),
  from_title: z.string().nullable(),
});

/**
 * Keep text from data.bnf.fr out of the shape this server's own lines take.
 *
 * This server writes three kinds of line a reader treats as its own voice:
 * `Note:`, `Source:` and `Hint:`. A cataloguer's note or a title carrying those
 * same words at the start of a line is indistinguishable from one of them, and a
 * forged `Source:` line placed above the real one substitutes a different
 * attribution for the BnF's.
 *
 * Indenting such a line keeps the two apart and costs nothing: the structured
 * output still carries the text exactly as it was published. The match ignores
 * case and allows a space before the colon, because a forgery chooses its own
 * spelling, and `m` treats a carriage return, a line feed and the Unicode line
 * and paragraph separators alike.
 */
export function indentMarkerLines(body: string): string {
  return body.replace(/^(Note|Source|Hint)(\s*:)/gim, " $1$2");
}

/**
 * Third-party text folded onto one line, for the places that build a sentence
 * around it.
 *
 * A note and an error message are each one line by construction, and the marker
 * they open with is written by this file. A value carrying a line break would
 * put whatever follows it at the start of a line of its own, where it could
 * spell `Source:` and be read as this server's attribution. Removing the break
 * is what keeps the line count equal to one, which is what makes the marker at
 * its head the only one there is.
 */
export function onOneLine(value: string): string {
  // U+2028 and U+2029 are written as escapes because they terminate a line in
  // source as well as in text: written literally they would end this one.
  return value.replace(/[\r\n\u2028\u2029]+/g, " ").trim();
}

/**
 * Build a result whose text block ends with its notes and its credit.
 *
 * The body is cut to fit around the trailer rather than the whole block being
 * cut afterwards. Appending the credit and then truncating loses exactly the
 * credit and the date beside it, which are the two lines the licence requires.
 *
 * Notes qualify an answer: that a list was cut, that a search does not rank,
 * that a record is provisional. A client that shows only the text would
 * otherwise present an unqualified answer, so they travel with the credit.
 */
export function ok(
  structured: Record<string, unknown>,
  body: string,
  options: { retrievedAt: string; notes?: string[]; sourceUrl?: string },
): ToolResult {
  const credit = attribution(options.retrievedAt, options.sourceUrl);

  // Notes are guarded the same way the body is. Several of them are built
  // around a value the BnF published, and the trailer is appended after the
  // body has been made safe, so a note is the one way third-party text could
  // otherwise reach the block already looking like a line this server wrote.
  const noteLines = (options.notes ?? []).map((note) => `Note: ${onOneLine(note)}`);
  while (noteLines.length > 0 && noteLines.join("\n").length > MAX_TEXT_CHARS / 2) noteLines.pop();
  const trailer = [...noteLines, credit].join("\n");

  const cut = "\n\n[shortened; the full result is in the structured output]";
  const budget = MAX_TEXT_CHARS - `\n\n${trailer}`.length;
  const safe = indentMarkerLines(body);
  const text =
    safe.length <= budget
      ? `${safe}\n\n${trailer}`
      : `${truncate(safe, Math.max(0, budget - cut.length))}${cut}\n\n${trailer}`;

  return { content: [{ type: "text", text }], structuredContent: structured };
}

/**
 * Errors carry no structured payload: the SDK checks it against the tool's
 * declared output schema, and a failure does not fit that shape.
 */
export function toToolError(error: unknown): ToolResult {
  const known =
    error instanceof BnfError
      ? error
      : new BnfError("network_error", error instanceof Error ? error.message : String(error));

  // A failure message can carry text from the endpoint and identifiers a caller
  // wrote, so it is guarded like any other body.
  const lines = [`[${known.code}] ${onOneLine(known.message)}`];
  if (known.details.hint) lines.push(`Hint: ${onOneLine(known.details.hint)}`);
  return { content: [{ type: "text", text: lines.join("\n") }], isError: true };
}

export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

/** Wording used wherever a search that does not rank reaches a caller. */
export const NO_RANKING =
  "The full-text index answers whether a record matches, and it does not score how well. These rows are in the order the index returned them, so the row a person would call the obvious answer can sit anywhere in the list, or on a later page.";

/** Wording used wherever a Gallica link reaches a caller. */
export const GALLICA_CAVEAT =
  "These are links for a person to open. This server reads the BnF catalogue and never requests gallica.bnf.fr, so it cannot say whether a document opens, what it contains, or on what terms it may be reused.";

/** Wording used wherever a provisional record reaches a caller. */
export const PROVISIONAL_CAVEAT =
  "A provisional record is one the BnF created to hold a title it has catalogued and not yet established as a work of its own. Its identifier can change, and it can be merged into an established record.";
