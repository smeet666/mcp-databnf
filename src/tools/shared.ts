/** Schemas, error mapping and rendering shared by the tools. */

import { z } from "zod";
import { BnfError } from "../errors.js";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const BRACKETED_TAIL = /\(([^()]*)\)\s*$/;
const YEAR = /^\d{4}$/;

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
  return ISO_DAY.test(day) ? day : retrievedAt;
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
  url: z
    .string()
    .describe(
      "The address the catalogue publishes, for a person to open. Read it beside 'rendering': an address asking for a rendering opens that view of the document rather than the document. This server does not read either.",
    ),
  rendering: z
    .string()
    .nullable()
    .describe(
      "The view the address asks Gallica for, read off what follows the ARK name in it, such as 'thumbnail' for a small image or 'item' for one leaf. Null when the address names the document itself. This says what was asked for, not what comes back.",
    ),
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
  while (noteLines.length > 0 && noteLines.join("\n").length > MAX_TEXT_CHARS / 2) {
    noteLines.pop();
  }
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
  if (known.details.hint) {
    lines.push(`Hint: ${onOneLine(known.details.hint)}`);
  }
  return { content: [{ type: "text", text: lines.join("\n") }], isError: true };
}

export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

/**
 * What a caller is owed when the answer rests on a window that filled up.
 *
 * A text search reads a fixed window of the index and filters what came back,
 * and the window is read first. A page can therefore hold every row the filter
 * kept while the index holds records the reading never reached. Saying the
 * window filled is a statement about the reading; no number of matches appears,
 * because the index scores nothing and a count printed beside these rows would
 * be read as a measure of them.
 *
 * The second sentence is the one a caller needs most: the window is filled in
 * the order the index answers in, which is fixed by nothing, so two readings of
 * one search can hold different records. A window with room to spare holds
 * every match, which is what makes such an answer repeatable.
 */
export const WINDOW_FULL_CAVEAT =
  "The window this search reads off the index came back full, so records carrying these words sit past what was read and this list is a part of the matches. Which records fill a full window is settled by the index as it answers, so another reading of the same search can bring back other rows. Requiring one more word narrows the reading and reaches what a full window leaves out.";

/** What a full window makes of the field that says where the rows stop. */
export const WINDOW_FULL_AND_NO_MORE =
  "'has_more' is false because the rows of this window stop here, and the window came back full: it says where the reading stopped rather than that the catalogue holds nothing further under these words.";

/** Wording used wherever a work-form code reaches a caller. */
export const FORMS_CAVEAT =
  "The codes under 'forms' are the terms of the BnF's work-form vocabulary a record points at, passed on as they stand: the vocabulary publishes no label for them here, so some read as words, such as 'roman' or 'poesi', and others, such as 'te', say nothing on their own. A work carrying no code is a work whose form the catalogue does not state.";

/** What the codes cannot do, said where a caller holds enough rows to try. */
export const FORMS_FILTER_CAVEAT =
  "A form is stated on some works and left unsaid on others, so keeping the rows that carry one code finds the works declaring it and never all the works of that form.";

/**
 * What a caller is owed wherever one authority record is taken for a person.
 *
 * The BnF opens a heading for a name it met on a document and keeps it beside
 * the fuller record for the same person, so a record can carry a name and
 * nothing else. Every link and every field hangs off a record, which makes a
 * silence on one of them a fact about that record alone.
 */
export const SEVERAL_RECORDS_CAVEAT =
  "The BnF keeps more than one authority record for some people, and a record can carry a name and nothing else while a second one carries the dates, the occupation and the works. Everything here is read off this record, so search_authors under the name will show the other records the file holds and let you compare them.";

/**
 * What a caller is owed about the reading that turned their text into terms.
 *
 * Every term is mandatory, so the reading decides what the answer can be. Three
 * things about it are invisible from the answer alone: a character that marks
 * nothing having been removed, punctuation having reached no term, and a term
 * of one character being required like any other. Each of them can be what
 * emptied a list, and none of them shows in the rows.
 */
export function readingNotes(
  reading: { terms: string[]; invisible: string[]; setAside: string[] },
  field: "name" | "title",
): string[] {
  const notes: string[] = [];
  const quoted = (values: readonly string[]): string =>
    values.map((value) => `"${value}"`).join(", ");

  if (reading.invisible.length > 0) {
    notes.push(
      `The text held ${reading.invisible.length} character(s) that mark nothing on a screen, such as a control character or a zero-width space. They were removed before the words were cut, so a word one of them sat inside was searched for whole rather than as two terms the index would each require.`,
    );
  }
  if (reading.setAside.length > 0) {
    notes.push(
      `Only letters and digits reach the index: ${quoted(reading.setAside)} in the text ${reading.setAside.length === 1 ? "was" : "were"} set aside, and what was searched for is ${quoted(reading.terms)}.`,
    );
  }

  const single = reading.terms.filter((term) => [...term].length === 1);
  if (single.length > 0) {
    notes.push(
      `${quoted(single)} ${single.length === 1 ? "is a term of one character" : "are terms of one character"} and ${single.length === 1 ? "is" : "are"} required like any other: a record has to carry ${single.length === 1 ? "it" : "them"} in its ${field} for a row to be a match. Leaving ${single.length === 1 ? "it" : "them"} out widens the search.`,
    );
  }
  return notes;
}

/** Wording used wherever a search that does not rank reaches a caller. */
export const NO_RANKING =
  "The full-text index answers whether a record matches, and it does not score how well. Rows are ordered by the address of the record, which measures nothing, so the row a person would call the obvious answer can sit anywhere in the list, or on a later page. That order is the one the pages are cut along, so reading page after page reaches every match once.";

/**
 * What a page holding no row turned out to be.
 *
 * 'absent' is the words matching no record at all. 'past_the_end' is a search
 * that matches, whose rows stop before the page asked for. 'undetermined' is
 * the reading that would tell them apart having failed.
 */
export type EmptyPage = "absent" | "past_the_end" | "undetermined";

/**
 * Tell a page asked for beyond the last row from a search that matches nothing.
 *
 * Both come back as a page of no rows, and calling either one an absence states
 * something the reading did not establish. Since a search reports no total, the
 * only way to separate them is to read the search from its first row: a row
 * there means the words match and the page asked for sits past where the rows
 * stop. The first page is its own evidence and is never read twice.
 */
export async function classifyEmptyPage(
  page: number,
  firstPageHasRow: () => Promise<boolean>,
): Promise<EmptyPage> {
  if (page === 1) {
    return "absent";
  }
  try {
    return (await firstPageHasRow()) ? "past_the_end" : "absent";
  } catch {
    return "undetermined";
  }
}

/** The class data.bnf.fr types a person with. */
export const PERSON_TYPE = "http://xmlns.com/foaf/0.1/Person";

/** The classes data.bnf.fr types a work with, one per vocabulary it uses. */
export const WORK_TYPES: readonly string[] = [
  "http://rdvocab.info/uri/schema/FRBRentitiesRDA/Work",
  "http://rdaregistry.info/Elements/c/#C10001",
];

/**
 * What the catalogue says an address is.
 *
 * An edition, an expression and a subject heading carry identifiers of the same
 * shape as a person and a work, and a tool that reads one of them as the other
 * asks a question it can never answer. The empty answer that comes back is
 * indistinguishable from the BnF holding nothing, so the type is read and null
 * is returned for everything else, which the caller refuses by name.
 */
export function recordKindOf(types: readonly string[]): "person" | "work" | null {
  if (types.includes(PERSON_TYPE)) {
    return "person";
  }
  if (types.some((type) => WORK_TYPES.includes(type))) {
    return "work";
  }
  return null;
}

/** The years a BnF heading states in its brackets, read off the end of it. */
function headingYears(label: string): { birth: number | null; death: number | null } {
  const bracketed = BRACKETED_TAIL.exec(label);
  const [birth, death] = (bracketed?.[1] ?? "").split("-");
  const year = (part: string | undefined): number | null =>
    part !== undefined && YEAR.test(part.trim()) ? Number(part.trim()) : null;
  return { birth: year(birth), death: year(death) };
}

/**
 * Where a heading and the dated fields of the same record disagree.
 *
 * A BnF heading writes the dates in brackets and the record states them again
 * as numbers, and a correction applied to one side and not the other leaves the
 * record saying two things. The numbers are what a caller compares to tell two
 * people of one name apart, so a disagreement is reported: this server has no
 * way of knowing which side a cataloguer meant, and picking one would hand over
 * a date the record does not settle.
 */
export function headingYearConflicts(
  label: string | null,
  birthYear: number | null,
  deathYear: number | null,
): string[] {
  if (label === null) {
    return [];
  }
  const stated = headingYears(label);
  const conflicts: string[] = [];
  if (stated.birth !== null && birthYear !== null && stated.birth !== birthYear) {
    conflicts.push(`${stated.birth} against 'birth_year' ${birthYear}`);
  }
  if (stated.death !== null && deathYear !== null && stated.death !== deathYear) {
    conflicts.push(`${stated.death} against 'death_year' ${deathYear}`);
  }
  return conflicts;
}

/** Wording used wherever a Gallica link reaches a caller. */
export const GALLICA_CAVEAT =
  "These are links for a person to open. This server reads the BnF catalogue and never requests gallica.bnf.fr, so it cannot say whether a document opens, what it contains, or on what terms it may be reused.";

/**
 * Wording used wherever the addresses under 'same_as' reach a caller.
 *
 * They are the BnF's own alignments, carried through character for character:
 * an address is a key, and re-spelling one, by decoding an escape or by adding
 * an escape of this server's own, produces an address the catalogue never
 * published which can name another page or none. This server requests
 * data.bnf.fr and nothing else, so whether any of them answers today is
 * something it has not looked at and does not claim.
 */
export const ALIGNMENTS_CAVEAT =
  "The addresses under 'same_as' are the BnF's own alignments to other files, passed on exactly as the catalogue publishes them, character for character. This server requests data.bnf.fr alone and does not open them, so it cannot say whether one still answers or what stands at the other end.";

/** Wording used wherever a provisional record reaches a caller. */
export const PROVISIONAL_CAVEAT =
  "A provisional record is one the BnF created to hold a title it has catalogued and not yet established as a work of its own. Its identifier can change, and it can be merged into an established record.";
