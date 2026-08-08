/**
 * search_works: find a work by words in its title.
 *
 * The endpoint's full-text index answers one question: does this title carry
 * every one of these words. It returns no score, and the order it answers in is
 * the order of the index. Searching for "saison enfer" therefore returns
 * a dozen studies of Rimbaud before Rimbaud, and every one of them is a correct
 * match.
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
import { strictInput } from "./arguments.js";
import { NO_RANKING, PROVISIONAL_CAVEAT, ok, retrievedAtSchema, toToolError } from "./shared.js";
import type { ToolResult } from "./shared.js";

export const searchWorksDescription = [
  "Find a work in the Bibliothèque nationale de France catalogue by words in its title, and get the identifier get_work and list_editions take.",
  "A row matches when its title carries every word given. The index returns no measure of how well a row matches, so the rows are in index order and the work a person would call the obvious answer can sit anywhere in the list or on a later page.",
  "A study of a book carries the book's title, so a search for a famous title returns the criticism alongside the work. Read 'creators' to tell them apart.",
  "This reads titles and nothing else. It cannot find the works of a named person: searching a person's name returns works written about them, whose creators are their critics.",
  "'status' says whether the BnF has established the work as a record of its own or holds it provisionally under a title it has catalogued.",
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
  words_searched: z.array(z.string()),
  works: z.array(workRowSchema),
  page: z.number().int(),
  has_more: z.boolean(),
  retrieved_at: retrievedAtSchema,
  notes: z.array(z.string()),
});

export type SearchWorksArgs = z.infer<typeof searchWorksInput>;

export async function runSearchWorks(
  client: BnfClient,
  args: SearchWorksArgs,
): Promise<ToolResult> {
  try {
    const words = client.words(args.title);
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

    const notes: string[] = [];
    if (cached) notes.push("Served from this server's short-lived in-memory cache.");

    const works = data.rows.map((row) => ({
      id: row.id,
      title: row.title,
      date: row.date,
      creators: row.creators,
      status: row.status,
      source_url: row.sourceUrl,
    }));

    if (works.length > 0) notes.push(NO_RANKING);
    if (works.some((work) => work.status === "provisional")) notes.push(PROVISIONAL_CAVEAT);

    // Writing a title out in full narrows the search rather than sharpening it.
    // "Une saison en enfer" requires "une" and "en" to appear as well, so a
    // record catalogued as "Saison en enfer" falls out of the answer, and the
    // caller sees a shorter list and reads it as the BnF holding less. Which
    // words carry the meaning is not something this server can tell: "mal" and
    // "les" are the same length, so the requirement is stated and the choice of
    // what to drop is left where it belongs.
    if (words.length > 2) {
      notes.push(
        `All ${words.length} words were required: ${words.map((word) => `"${word}"`).join(", ")}. A record catalogued under a shorter form of the title carries fewer of them and falls out of the answer, so dropping a word widens the search.`,
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
    if (works.length === 0) {
      notes.push(
        `No work in the BnF catalogue has a title carrying every one of these words: ${words.map((word) => `"${word}"`).join(", ")}. Every word given has to appear, so dropping one widens the search.`,
      );
    }

    const body =
      works.length === 0
        ? `No work in the BnF catalogue matches "${args.title}".`
        : `${works.length} work(s) whose title carries ${words.map((word) => `"${word}"`).join(" and ")}:\n${works
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
        words_searched: words,
        works,
        page: args.page,
        has_more: data.hasMore,
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
