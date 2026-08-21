/**
 * search_authors: find a person in the BnF authority file by name.
 *
 * One person can hold several authority records. "Arthur Rimbaud" answers with
 * two, `cb119219976` and `cb11921998j`, and neither is a mistake: the file
 * distinguishes the poet from a second heading the BnF keeps for him. Returning
 * one of the two and calling it the answer would hide a choice the caller is
 * the only one able to make, so every match is returned and the answer says
 * when several rows carry one name.
 */

import { z } from "zod";
import type { BnfClient } from "../bnf/client.js";
import { TEXT_WINDOW } from "../bnf/queries.js";
import { invalidInput } from "../errors.js";
import { strictInput } from "./arguments.js";
import {
  NO_RANKING,
  WINDOW_FULL_AND_NO_MORE,
  WINDOW_FULL_CAVEAT,
  classifyEmptyPage,
  headingYearConflicts,
  ok,
  readingNotes,
  retrievedAtSchema,
  toToolError,
} from "./shared.js";
import type { EmptyPage, ToolResult } from "./shared.js";

export const searchAuthorsDescription = [
  "Find a person in the Bibliothèque nationale de France authority file by name, and get the identifier the other tools take.",
  "This matches the name the BnF records, so it takes a surname, a full name or both names in either order. It does not read biographies, so it cannot find a person from what they wrote or what they did.",
  "It reads the person records and nothing else: an organisation, a conference or a place is outside it, and an answer holding no row says nothing about those.",
  "The match is letter for letter, so a name written with other accents or under another transliteration is a different search: try the spellings a library would use before concluding the BnF holds nobody of that name.",
  "Several rows can carry one name: the BnF keeps more than one authority record for some people, and many people share a name. Read 'birth_year', 'death_year' and 'role' to tell them apart, and show the caller the choice rather than picking one.",
  "Rows come back ordered by the address of the record, which is not an order of relevance. That order is the one the pages are cut along, so paging through a search reaches every match once.",
  "One search reads a fixed window of the index. 'index_window_full' says whether that window came back full: when it did, names sit past what was read, 'has_more' being false says where the reading stopped, and another reading of the same search can bring back other rows. Narrow the name to reach further.",
].join(" ");

export const searchAuthorsInput = strictInput({
  name: z
    .string()
    .min(1)
    .max(200)
    .describe("The person's name, such as 'Rimbaud' or 'Arthur Rimbaud'."),
  limit: z.number().int().min(1).max(50).default(10),
  page: z.number().int().min(1).max(100).default(1),
});

export const authorRowSchema = z.object({
  id: z.string().describe("Pass this to get_author, or to find_digitised."),
  name: z.string().nullable().describe("The name as data.bnf.fr writes it."),
  label: z
    .string()
    .nullable()
    .describe("The authority heading, which usually carries the dates in brackets."),
  birth_year: z.number().int().nullable(),
  death_year: z.number().int().nullable().describe("Null when the record states none."),
  role: z
    .string()
    .nullable()
    .describe(
      "What the record says the person did. This field holds a job title far more often than a sentence, and is frequently a single word.",
    ),
  source_url: z.string().describe("The record's page. Show this when citing it."),
});

export const searchAuthorsOutput = z.object({
  name: z.string().describe("The name asked for."),
  words_searched: z
    .array(z.string())
    .describe(
      "The terms the index required, each of which has to appear in the name. A word is cut at an apostrophe and at a hyphen before the index sees it, so a name written as one word can appear here as two, and a record carrying the pieces apart is a match.",
    ),
  authors: z.array(authorRowSchema),
  page: z.number().int(),
  has_more: z
    .boolean()
    .describe(
      "Whether the endpoint held at least one further row beyond this page, within the window the search read off the index. Read it alongside 'index_window_full': false on a full window says where the reading stopped rather than that the file holds nobody else.",
    ),
  index_window_full: z
    .boolean()
    .nullable()
    .describe(
      "Whether the fixed window this search reads off the index came back full. True means records carrying these words sit past what was read, so the rows here are a part of the matches and another reading can bring back other rows. False means the window held everything that matched. Null when the endpoint stated no occupancy, which claims nothing either way.",
    ),
  retrieved_at: retrievedAtSchema,
  notes: z.array(z.string()),
});

export type SearchAuthorsArgs = z.infer<typeof searchAuthorsInput>;

/** Wording used wherever the spelling of a name decides what a search reaches. */
const SPELLING_CAVEAT =
  "The index matches the words letter for letter, so a name written with other accents, or under another transliteration, is a different search reaching different records. A short answer is no evidence that the file holds nobody else of that name: ask again with the accents dropped, with them restored, and under the transliterations a library uses.";

/**
 * The years a record states, written so that a silence stays a silence.
 *
 * Printing "1940–?" hands a reader a glyph to interpret, and most read it as a
 * death on a date nobody wrote down. A record carrying a birth year and no death
 * year says one thing: when the person was born.
 */
function lifespan(birthYear: number | null, deathYear: number | null): string {
  if (birthYear !== null && deathYear !== null) {
    return ` (${birthYear}–${deathYear})`;
  }
  if (birthYear !== null) {
    return ` (born ${birthYear})`;
  }
  if (deathYear !== null) {
    return ` (died ${deathYear})`;
  }
  return "";
}

/**
 * What a page of no rows is allowed to say.
 *
 * Only a search whose first row is missing too is an absence. A page past where
 * the rows stop is a fact about the page asked for, and it is written as such:
 * the page, that it holds nothing, and the way back to the rows. No count of
 * what came before appears, because this server never asks the endpoint how
 * many records match, so where the rows stop is a boundary it can point at and
 * not a number it can state.
 */
function emptyPageNote(
  emptiness: EmptyPage,
  page: number,
  words: string[],
  windowFull: boolean,
): string {
  const quoted = words.map((word) => `"${word}"`).join(", ");
  // A window filled by records of another kind leaves the filter nothing to
  // keep, and the page that comes back is the same empty page an unmatched name
  // produces. Only one of the two is an absence, and the window says which.
  if (windowFull) {
    return `The window this search reads off the index came back full, and no person record survived the reading: every row of it named something the authority file types as another kind of heading. Whether a person carries ${quoted} in a name is unanswered here rather than answered no. Narrow the search, by adding a word or by writing a fuller form of the name, so that the window reaches further into the index.`;
  }
  if (emptiness === "past_the_end") {
    return `Page ${page} holds no row because it sits past the last row of this search. Records do carry ${quoted} in a name, and they are on earlier pages: call again with page=1, or with a lower page number, to read them.`;
  }
  if (emptiness === "undetermined") {
    return `Page ${page} holds no row, and reading the first page of the same search to find out why did not answer. This is either a name carrying ${quoted} matching no record, or a page sitting past the last row of a search that does match. Call again with page=1: rows there mean the second.`;
  }
  return `No person record in the BnF authority file carries every one of these words in a name: ${quoted}. This search reads the person records and nothing else, so an organisation, a conference, a place or a subject heading is outside what was looked at, whether or not the BnF holds a heading for one. It reads names, so a person known by a pen name is found under that name rather than their own.`;
}

function emptyPageBody(
  emptiness: EmptyPage,
  page: number,
  name: string,
  windowFull: boolean,
): string {
  if (windowFull) {
    return `No person record survived the reading for "${name}", out of a window of the index that came back full. Narrow the search.`;
  }
  if (emptiness === "past_the_end") {
    return `Page ${page} of the search for "${name}" holds no row: it sits past the last row. Call again with page=1.`;
  }
  if (emptiness === "undetermined") {
    return `Page ${page} of the search for "${name}" holds no row, and whether the rows stop before it could not be read. Call again with page=1.`;
  }
  return `No person in the BnF authority file matches "${name}".`;
}

export async function runSearchAuthors(
  client: BnfClient,
  args: SearchAuthorsArgs,
): Promise<ToolResult> {
  try {
    const reading = client.searchReading(args.name);
    const words = reading.words;
    if (words.length === 0) {
      return toToolError(
        invalidInput(
          `"${args.name}" holds no word to search for.`,
          "Write the name in letters, such as 'Rimbaud'.",
        ),
      );
    }

    // A text search reads a fixed window of the index, and a page beyond it
    // would come back empty for want of anything having been read. Answering
    // that with "the BnF holds none" states an absence nobody established, so
    // the page is refused here rather than bought from the endpoint.
    const offset = (args.page - 1) * args.limit;
    if (offset + args.limit > TEXT_WINDOW) {
      return toToolError(
        invalidInput(
          `Page ${args.page} at ${args.limit} rows a page reaches past row ${TEXT_WINDOW}, which is as far into the index as one search reads.`,
          `Narrow the search instead. Rows past ${TEXT_WINDOW} are not a smaller part of the answer: they were never read, so an empty page there would say nothing about the catalogue.`,
        ),
      );
    }
    const { data, cached, retrievedAt } = await client.searchAuthors(args.name, args.limit, offset);

    const terms = reading.terms;
    const windowFull = data.indexWindowFull ?? null;

    const notes: string[] = [];
    if (cached) {
      notes.push("Served from this server's short-lived in-memory cache.");
    }

    // What bounds the answer is said before what qualifies it. The text block
    // fits a limited trailer and drops the last notes to keep the credit, and a
    // caller losing this one is left reading a part of the matches as all of
    // them.
    if (windowFull) {
      notes.push(WINDOW_FULL_CAVEAT);
      if (!data.hasMore) {
        notes.push(WINDOW_FULL_AND_NO_MORE);
      }
    }

    // A caller checking why a row is on the list reads the terms, so the ones
    // the index made out of a word are traced back to it before anything that
    // merely qualifies the answer.
    const split = words.filter((word) => /['-]/u.test(word));
    if (split.length > 0) {
      notes.push(
        `${split.map((word) => `"${word}"`).join(", ")} reached the index as separate terms: it cuts a word at an apostrophe and at a hyphen, and requires each piece to appear in the name rather than in that arrangement, so a record writing the pieces apart is a match.`,
      );
    }
    notes.push(...readingNotes(reading, "name"));

    const authors = data.rows.map((row) => ({
      id: row.id,
      name: row.name,
      label: row.label,
      birth_year: row.birthYear,
      death_year: row.deathYear,
      role: row.role,
      source_url: row.sourceUrl,
    }));

    if (authors.length > 0) {
      notes.push(NO_RANKING);
    }

    // The index compares the characters it was given against the characters a
    // cataloguer entered. A name the BnF holds under a transliteration of its
    // own is therefore reachable only by that spelling, and the answer to any
    // other one is a short list or none at all, neither of which looks partial.
    notes.push(SPELLING_CAVEAT);

    const disputed = authors
      .map((author) => ({
        label: author.label ?? author.name,
        conflicts: headingYearConflicts(author.label, author.birth_year, author.death_year),
      }))
      .filter((row) => row.conflicts.length > 0);
    if (disputed.length > 0) {
      notes.push(
        `${disputed.map((row) => `"${row.label}" states ${row.conflicts.join(", and ")}`).join("; ")}. A record stating its dates twice can disagree with itself, and the BnF publishes both. These fields are what tells two people of one name apart, so open source_url before telling them apart by a date the record disputes.`,
      );
    }

    // Several records under one name is the case this tool exists to surface.
    const repeated = new Map<string, number>();
    for (const author of authors) {
      const key = (author.name ?? "").toLocaleLowerCase("fr");
      if (key !== "") {
        repeated.set(key, (repeated.get(key) ?? 0) + 1);
      }
    }
    const shared = [...repeated.entries()].filter(([, count]) => count > 1);
    if (shared.length > 0) {
      notes.push(
        `${shared.map(([name, count]) => `${count} records are named "${name}"`).join("; ")}. The BnF keeps more than one authority record for some people, and different people share names. Read the dates and the role before treating any of them as the person meant.`,
      );
    }

    if (data.hasMore) {
      notes.push(
        `More matches exist beyond this page. Ask for page ${args.page + 1}, or narrow the name. This server reports no total, because counting every match means asking the endpoint to walk the whole index a second time.`,
      );
    }
    // A page holding no row is read for what it is before anything is said
    // about the authority file: no name matching, and the rows of a name that
    // does match stopping earlier, look identical from the page alone.
    let emptiness: EmptyPage = "absent";
    if (authors.length === 0) {
      // A full window already accounts for the page, and reading the search
      // from its first row would answer a question the window has settled.
      emptiness = windowFull
        ? "absent"
        : await classifyEmptyPage(args.page, async () => {
            const first = await client.searchAuthors(args.name, 1, 0);
            return first.data.rows.length > 0;
          });
      notes.push(emptyPageNote(emptiness, args.page, terms, windowFull === true));
    }

    const body =
      authors.length === 0
        ? emptyPageBody(emptiness, args.page, args.name, windowFull === true)
        : `${authors.length} record(s) for "${args.name}":\n${authors
            .map((author, index) => {
              const life = lifespan(author.birth_year, author.death_year);
              const role = author.role ? ` · ${author.role}` : "";
              return `${index + 1}. ${author.name ?? author.label ?? author.id}${life}${role} · id: ${author.id}\n   ${author.source_url}`;
            })
            .join("\n")}`;

    return ok(
      {
        name: args.name,
        words_searched: terms,
        authors,
        page: args.page,
        has_more: data.hasMore,
        index_window_full: windowFull,
        retrieved_at: retrievedAt,
        notes,
      },
      body,
      { retrievedAt, notes },
    );
  } catch (error) {
    return toToolError(error);
  }
}
