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
import { NO_RANKING, ok, retrievedAtSchema, toToolError } from "./shared.js";
import type { ToolResult } from "./shared.js";

export const searchAuthorsDescription = [
  "Find a person in the Bibliothèque nationale de France authority file by name, and get the identifier the other tools take.",
  "This matches the name the BnF records, so it takes a surname, a full name or both names in either order. It does not read biographies, so it cannot find a person from what they wrote or what they did.",
  "Several rows can carry one name: the BnF keeps more than one authority record for some people, and many people share a name. Read 'birth_year', 'death_year' and 'role' to tell them apart, and show the caller the choice rather than picking one.",
  "Rows come back in the order the index returned them, which is not an order of relevance.",
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
    .describe("The words the index was actually asked for, after punctuation was set aside."),
  authors: z.array(authorRowSchema),
  page: z.number().int(),
  has_more: z
    .boolean()
    .describe("Whether the index held at least one further match beyond this page."),
  retrieved_at: retrievedAtSchema,
  notes: z.array(z.string()),
});

export type SearchAuthorsArgs = z.infer<typeof searchAuthorsInput>;

/**
 * The years a record states, written so that a silence stays a silence.
 *
 * Printing "1940–?" hands a reader a glyph to interpret, and most read it as a
 * death on a date nobody wrote down. A record carrying a birth year and no death
 * year says one thing: when the person was born.
 */
function lifespan(birthYear: number | null, deathYear: number | null): string {
  if (birthYear !== null && deathYear !== null) return ` (${birthYear}–${deathYear})`;
  if (birthYear !== null) return ` (born ${birthYear})`;
  if (deathYear !== null) return ` (died ${deathYear})`;
  return "";
}

export async function runSearchAuthors(
  client: BnfClient,
  args: SearchAuthorsArgs,
): Promise<ToolResult> {
  try {
    const words = client.words(args.name);
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

    const notes: string[] = [];
    if (cached) notes.push("Served from this server's short-lived in-memory cache.");

    const authors = data.rows.map((row) => ({
      id: row.id,
      name: row.name,
      label: row.label,
      birth_year: row.birthYear,
      death_year: row.deathYear,
      role: row.role,
      source_url: row.sourceUrl,
    }));

    if (authors.length > 0) notes.push(NO_RANKING);

    // Several records under one name is the case this tool exists to surface.
    const repeated = new Map<string, number>();
    for (const author of authors) {
      const key = (author.name ?? "").toLocaleLowerCase("fr");
      if (key !== "") repeated.set(key, (repeated.get(key) ?? 0) + 1);
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
    if (authors.length === 0) {
      notes.push(
        `No record in the BnF authority file carries every one of these words in a name: ${words.map((word) => `"${word}"`).join(", ")}. A search here reads names, so a person known by a pen name is found under that name rather than their own.`,
      );
    }
    if (words.length < args.name.trim().split(/\s+/).length) {
      notes.push(
        `The index was asked for ${words.map((word) => `"${word}"`).join(", ")}; anything in the name that was not a word was set aside.`,
      );
    }

    const body =
      authors.length === 0
        ? `No person in the BnF authority file matches "${args.name}".`
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
        words_searched: words,
        authors,
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
