/**
 * search_works: find a work by words in its title.
 *
 * The endpoint's full-text index answers one question: does this title carry
 * every one of these words. It returns no score, and the rows come back in the
 * order of the record's address, which measures nothing about the match.
 * Searching for "saison enfer" therefore returns a dozen studies of Rimbaud
 * before Rimbaud, and every one of them is a correct match.
 *
 * So this tool never presents its rows as a ranking, and never presents the
 * first row as the answer. Saying that plainly is worth more than any
 * re-ordering this server could invent, since an order this server made up
 * would be a claim the catalogue does not support.
 */

import { z } from "zod";
import type { BnfClient } from "../bnf/client.js";
import { TEXT_WINDOW } from "../bnf/queries.js";
import { invalidInput } from "../errors.js";
import { readSearchText } from "../bnf/sparql.js";
import { strictInput } from "./arguments.js";
import {
  NO_RANKING,
  PROVISIONAL_CAVEAT,
  WINDOW_FULL_AND_NO_MORE,
  WINDOW_FULL_CAVEAT,
  classifyEmptyPage,
  ok,
  readingNotes,
  retrievedAtSchema,
  toToolError,
} from "./shared.js";
import type { EmptyPage, ToolResult } from "./shared.js";

export const searchWorksDescription = [
  "Find a work in the Bibliothèque nationale de France catalogue by words in its title, and get the identifier get_work and list_editions take.",
  "A row matches when its title carries every word given. The index returns no measure of how well a row matches, so the rows are ordered by the address of the record and the work a person would call the obvious answer can sit anywhere in the list or on a later page.",
  "A study of a book carries the book's title, so a search for a famous title returns the criticism alongside the work. Read 'creators' to tell them apart.",
  "This reads titles and nothing else. Searching a person's name returns the works written about them, whose creators are their critics; list_works is what walks from a person to the works the catalogue names them the creator of.",
  "'status' says whether the BnF has established the work as a record of its own or holds it provisionally under a title it has catalogued.",
  "One search reads a fixed window of the index, and that window is read before the works are told apart from everything else the index holds, so even a short list can rest on a full one. 'index_window_full' says which: when it is true, titles sit past what was read, 'has_more' being false says where the reading stopped, and another reading of the same search can bring back other rows. Add a word to the title to reach further.",
].join(" ");

export const searchWorksInput = strictInput({
  title: z
    .string()
    .min(1)
    .max(200)
    .describe("Words from the title, such as 'saison enfer'. Every word given has to appear."),
  limit: z.number().int().min(1).max(50).default(10),
  page: z.number().int().min(1).max(100).default(1),
});

export const workRowSchema = z.object({
  id: z.string().describe("Pass this to get_work, list_editions or find_digitised."),
  title: z.string().nullable(),
  date: z.string().nullable().describe("The year the record gives the work, as published."),
  creators: z
    .array(z.object({ id: z.string(), name: z.string().nullable() }))
    .describe("Everyone the record credits. Empty when the record credits nobody."),
  status: z
    .enum(["established", "provisional"])
    .describe(
      "'established' is a work the BnF has settled as a record of its own. 'provisional' is a title it holds while a cataloguer settles it, whose identifier can change.",
    ),
  source_url: z.string(),
});

export const searchWorksOutput = z.object({
  title: z.string().describe("The words asked for."),
  words_searched: z
    .array(z.string())
    .describe(
      "The terms the index required, each of which has to appear in the title. A word is cut at an apostrophe and at a hyphen before the index sees it, so a word given as one can appear here as two, and a record carrying the pieces apart is a match.",
    ),
  works: z.array(workRowSchema),
  page: z.number().int(),
  has_more: z
    .boolean()
    .describe(
      "Whether the endpoint held at least one further row beyond this page, within the window the search read off the index. Read it alongside 'index_window_full': false on a full window says where the reading stopped rather than that the catalogue holds nothing else.",
    ),
  index_window_full: z
    .boolean()
    .nullable()
    .describe(
      "Whether the fixed window this search reads off the index came back full. The window is read before the works are separated from the rest of the index, so a short list can rest on a full window. True means titles carrying these words sit past what was read, and another reading can bring back other rows. False means the window held everything that matched. Null when the endpoint stated no occupancy.",
    ),
  retrieved_at: retrievedAtSchema,
  notes: z.array(z.string()),
});

export type SearchWorksArgs = z.infer<typeof searchWorksInput>;

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
  // The window is read before works are told apart from the rest of the index,
  // so a full one can leave nothing for the answer while the catalogue holds
  // matching works further along. That page and a page of no matches at all are
  // the same page, and the window is what separates them.
  if (windowFull) {
    return `The window this search reads off the index came back full, and no work record survived the reading: every row of it named something the catalogue types as another kind of record. Whether a work carries ${quoted} in its title is unanswered here rather than answered no. Add a word to the title so that the window reaches further into the index.`;
  }
  if (emptiness === "past_the_end") {
    return `Page ${page} holds no row because it sits past the last row of this search. Works do carry ${quoted} in their title, and they are on earlier pages: call again with page=1, or with a lower page number, to read them.`;
  }
  if (emptiness === "undetermined") {
    return `Page ${page} holds no row, and reading the first page of the same search to find out why did not answer. This is either a title carrying ${quoted} matching no record, or a page sitting past the last row of a search that does match. Call again with page=1: rows there mean the second.`;
  }
  return `No work in the BnF catalogue has a title carrying every one of these words: ${quoted}. Every word given has to appear, so dropping one widens the search.`;
}

function emptyPageBody(
  emptiness: EmptyPage,
  page: number,
  title: string,
  windowFull: boolean,
): string {
  if (windowFull) {
    return `No work record survived the reading for "${title}", out of a window of the index that came back full. Add a word to the title.`;
  }
  if (emptiness === "past_the_end") {
    return `Page ${page} of the search for "${title}" holds no row: it sits past the last row. Call again with page=1.`;
  }
  if (emptiness === "undetermined") {
    return `Page ${page} of the search for "${title}" holds no row, and whether the rows stop before it could not be read. Call again with page=1.`;
  }
  return `No work in the BnF catalogue matches "${title}".`;
}

export async function runSearchWorks(
  client: BnfClient,
  args: SearchWorksArgs,
): Promise<ToolResult> {
  try {
    const reading = readSearchText(args.title);
    const words = reading.words;
    if (words.length === 0) {
      return toToolError(
        invalidInput(
          `"${args.title}" holds no word to search for.`,
          "Write the words of the title in letters, such as 'saison enfer'.",
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
    const { data, cached, retrievedAt } = await client.searchWorks(args.title, args.limit, offset);

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
        `${split.map((word) => `"${word}"`).join(", ")} reached the index as separate terms: it cuts a word at an apostrophe and at a hyphen, and requires each piece to appear in the title rather than in that arrangement, so a record writing the pieces apart is a match.`,
      );
    }
    notes.push(...readingNotes(reading, "title"));

    const works = data.rows.map((row) => ({
      id: row.id,
      title: row.title,
      date: row.date,
      creators: row.creators,
      status: row.status,
      source_url: row.sourceUrl,
    }));

    if (works.length > 0) {
      notes.push(NO_RANKING);
    }
    if (works.some((work) => work.status === "provisional")) {
      notes.push(PROVISIONAL_CAVEAT);
    }

    // Writing a title out in full narrows the search rather than sharpening it.
    // "Une saison en enfer" requires "une" and "en" to appear as well, so a
    // record catalogued as "Saison en enfer" falls out of the answer, and the
    // caller sees a shorter list and reads it as the BnF holding less. Which
    // words carry the meaning is not something this server can tell: "mal" and
    // "les" are the same length, so the requirement is stated and the choice of
    // what to drop is left where it belongs.
    if (terms.length > 2) {
      notes.push(
        `All ${terms.length} terms were required: ${terms.map((term) => `"${term}"`).join(", ")}. A record catalogued under a shorter form of the title carries fewer of them and falls out of the answer, so dropping a word widens the search.`,
      );
    }

    // A page of studies about a famous work, with the work itself further down
    // the index, otherwise reads as the BnF not holding the work at all.
    if (works.length > 0 && works.every((work) => work.status === "provisional")) {
      notes.push(
        "Every row on this page is a provisional record. The BnF creates one for a title it has catalogued without settling it as a work of its own, which is what a study of a famous book usually gets. An established record for the work itself can sit further down the index: ask for the next page, or search fewer words of the title.",
      );
    }

    if (data.hasMore) {
      notes.push(
        `More matches exist beyond this page. Ask for page ${args.page + 1}, or add a word to the title. This server reports no total: a count would read as a measure of the search, and this search has none.`,
      );
    }
    // A page holding no row is read for what it is before anything is said
    // about the catalogue: the words matching nothing, and the rows of a search
    // that does match stopping earlier, look identical from the page alone.
    let emptiness: EmptyPage = "absent";
    if (works.length === 0) {
      // A full window already accounts for the page, and reading the search
      // from its first row would answer a question the window has settled.
      emptiness = windowFull
        ? "absent"
        : await classifyEmptyPage(args.page, async () => {
            const first = await client.searchWorks(args.title, 1, 0);
            return first.data.rows.length > 0;
          });
      notes.push(emptyPageNote(emptiness, args.page, terms, windowFull === true));
    }

    const body =
      works.length === 0
        ? emptyPageBody(emptiness, args.page, args.title, windowFull === true)
        : `${works.length} work(s) whose title carries ${terms.map((term) => `"${term}"`).join(" and ")}:\n${works
            .map((work, index) => {
              const by =
                work.creators.length > 0
                  ? ` · ${work.creators.map((creator) => creator.name ?? creator.id).join(", ")}`
                  : "";
              const when = work.date ? ` (${work.date})` : "";
              const status = work.status === "provisional" ? " · provisional record" : "";
              return `${index + 1}. ${work.title ?? work.id}${when}${by}${status} · id: ${work.id}\n   ${work.source_url}`;
            })
            .join("\n")}`;

    return ok(
      {
        title: args.title,
        words_searched: terms,
        works,
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
