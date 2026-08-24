/**
 * list_works: the works the BnF catalogue names one person the creator of.
 *
 * The catalogue holds that link, so the question "what did this person write"
 * has an answer here. What it does not hold is a bibliography. A person is
 * credited on records in ways this link does not carry, and the BnF holds
 * printed editions whose work it has never established as an entry of its own,
 * so the list is what the link reaches and the answer says so.
 *
 * Two further things the catalogue withholds shape the rest. It points a work
 * at a term of its work-form vocabulary and publishes no label for that term
 * here, so the codes travel as they stand; and it states the form of some works
 * and not of others, which is what stops a code from being a filter: rows
 * carrying it are works declaring that form, and the rows without it are silent
 * rather than negative. And it orders nothing: the rows come back by the
 * address of the work, which is stable enough to page through and means nothing
 * else.
 */

import { z } from "zod";
import type { BnfClient } from "../bnf/client.js";
import type { EntityId } from "../bnf/sparql.js";
import { notFound } from "../errors.js";
import { parseEntityId } from "../bnf/sparql.js";
import { strictInput } from "./arguments.js";
import {
  FORMS_CAVEAT,
  FORMS_FILTER_CAVEAT,
  PROVISIONAL_CAVEAT,
  SEVERAL_RECORDS_CAVEAT,
  classifyEmptyPage,
  ok,
  retrievedAtSchema,
  toToolError,
} from "./shared.js";
import type { EmptyPage, ToolResult } from "./shared.js";

const PERSON_TYPE = "http://xmlns.com/foaf/0.1/Person";

/**
 * What the list holds, stated wherever it reaches a caller.
 *
 * It travels with every answer, including the ones holding no row: a page of
 * nothing is a statement about this link and about no other way the catalogue
 * credits a person, and reading it as a person having written nothing is the
 * one mistake this tool can cause.
 */
const SCOPE =
  "A work is on this list because the BnF catalogue names this person as the creator of it. That is one link in the catalogue and not a bibliography: the catalogue credits a person on a record in other ways, and the BnF holds printed editions whose work it has never established as a record of its own.";

/** Wording used wherever a work's date reaches a caller. */
const DATE_CAVEAT =
  "'date' and 'year' are the date of the work as the record gives it, which dates the work rather than any printing of it. A provisional record is made from a title the BnF has catalogued, so its date can be that of the printing it was made from. For the year a copy was printed, read list_editions.";

/** Wording used wherever the order of this list reaches a caller. */
const ORDER_CAVEAT =
  "Rows are ordered by the address the catalogue gives each work, which is neither chronological nor an order of importance, so a first work can appear anywhere in the list. That order is the one the pages are cut along, so reading page after page reaches every work once.";

export const listWorksDescription = [
  "List the works the Bibliothèque nationale de France catalogue names one person the creator of, by the identifier search_authors returns. This is the tool for 'what did this person write'.",
  "Each row carries the title, the date the record gives the work, the form codes the catalogue points at, whether the record is established or provisional, and the identifier get_work, list_editions and find_digitised take.",
  "It is not a bibliography. It reports one link the catalogue holds, and the catalogue credits a person on a record in other ways and holds editions whose work it has never established, so a work missing here is not a work the person did not write.",
  "The form codes are the work-form vocabulary's own terms and carry no label in this dataset, so some read as words and some do not. A work stating no code has a form the catalogue does not state, so keeping the rows carrying one code finds the works that declare it and never all the works of that form.",
  "Rows are ordered by the address the catalogue gives each work, which is neither chronological nor an order of importance. No total is reported, because the catalogue counts nothing here and a count would read as a measure of what the person wrote.",
].join(" ");

export const listWorksInput = strictInput({
  author_id: z
    .string()
    .min(1)
    .max(200)
    .describe(
      "The person identifier from search_authors, such as 'cb119219976'. A full data.bnf.fr address is accepted too.",
    ),
  limit: z.number().int().min(1).max(50).default(10),
  page: z.number().int().min(1).max(100).default(1),
});

export const authoredWorkRowSchema = z.object({
  id: z.string().describe("Pass this to get_work, list_editions or find_digitised."),
  title: z.string().nullable(),
  date: z
    .string()
    .nullable()
    .describe(
      "The date the record gives the work, as published. It dates the work rather than an edition of it.",
    ),
  year: z.number().int().nullable().describe("The same date as a number, when the record has one."),
  forms: z
    .array(z.string())
    .describe(
      "Terms of the BnF work-form vocabulary, as the terms themselves. The vocabulary publishes no label for them here, so they are not translated: some read as words, such as 'roman', and some do not, such as 'te'. An empty list is a form the record does not state, not a work without one.",
    ),
  status: z
    .enum(["established", "provisional"])
    .describe(
      "'established' is a work the BnF has settled as a record of its own. 'provisional' is a title it holds while a cataloguer settles it, whose identifier can change.",
    ),
  source_url: z.string(),
});

export const listWorksOutput = z.object({
  author_id: z.string(),
  works: z.array(authoredWorkRowSchema),
  page: z.number().int(),
  has_more: z.boolean(),
  retrieved_at: retrievedAtSchema,
  notes: z.array(z.string()),
});

export type ListWorksArgs = z.infer<typeof listWorksInput>;

/**
 * What a page holding no row is allowed to say.
 *
 * A page past where the rows stop and a person the catalogue links no work to
 * arrive identically, and calling either one an absence states something the
 * reading did not establish. Since no total is asked for, the only way to
 * separate them is to read the listing from its first row.
 */
function emptyPageNote(emptiness: EmptyPage, page: number, authorId: string): string {
  if (emptiness === "past_the_end") {
    return `Page ${page} holds no row because it sits past the last row of this listing. The catalogue does link works to "${authorId}", and they are on earlier pages: call again with page=1, or with a lower page number, to read them.`;
  }
  if (emptiness === "undetermined") {
    return `Page ${page} holds no row, and the first page of the same listing could not be read to find out why. This is either the catalogue linking no work to "${authorId}", or a page sitting past the last row of a listing that does hold some. Call again with page=1: rows there mean the second.`;
  }
  return `The BnF catalogue links no work to "${authorId}" as its creator. The record exists and this link is empty on it, which is a statement about the catalogue rather than about what the person wrote. ${SEVERAL_RECORDS_CAVEAT}`;
}

function emptyPageBody(emptiness: EmptyPage, page: number, authorId: string): string {
  if (emptiness === "past_the_end") {
    return `Page ${page} of the works linked to "${authorId}" holds no row: it sits past the last row. Call again with page=1.`;
  }
  if (emptiness === "undetermined") {
    return `Page ${page} of the works linked to "${authorId}" holds no row, and whether the rows stop before it could not be read. Call again with page=1.`;
  }
  return `The BnF catalogue links no work to "${authorId}" as its creator.`;
}

export async function runListWorks(client: BnfClient, args: ListWorksArgs): Promise<ToolResult> {
  try {
    const id = parseEntityId(args.author_id);
    const offset = (args.page - 1) * args.limit;
    const { data, cached, retrievedAt } = await client.worksByAuthor(id, args.limit, offset);

    const notes: string[] = [];
    if (cached) {
      notes.push("Served from this server's short-lived in-memory cache.");
    }

    const works = data.rows.map((row) => ({
      id: row.id,
      title: row.title,
      date: row.date,
      year: row.year,
      forms: row.forms,
      status: row.status,
      source_url: row.sourceUrl,
    }));

    // The notes are ordered by how much a caller loses without them, because
    // the text block fits a limited trailer and drops the last of them to keep
    // the credit. What the list is comes first, then what to do next, then the
    // qualifications a caller could also read off the tool's own description.
    notes.push(SCOPE);

    if (data.skipped !== undefined && data.skipped > 0) {
      notes.push(
        `${data.skipped} row(s) the endpoint sent could not be read, because each named a record at an address this client cannot address. The page is short by that much rather than the catalogue holding less.`,
      );
    }

    let emptiness: EmptyPage = "absent";
    if (works.length === 0) {
      emptiness = await classifyEmptyPage(args.page, async () => {
        const first = await client.worksByAuthor(id, 1, 0);
        return first.data.rows.length > 0;
      });
      // A listing with no row anywhere says nothing until the address is known
      // to name a person. An edition, a subject heading and a record the BnF
      // describes nowhere all answer with no rows, and reporting any of them as
      // a person credited with nothing states a fact about a life the catalogue
      // never described.
      if (emptiness === "absent") {
        await assertPerson(client, id);
      }
      notes.push(emptyPageNote(emptiness, args.page, id.id));
    } else {
      if (data.hasMore) {
        notes.push(
          `More works exist beyond this page. Ask for page ${args.page + 1}. This server reports no total: a count of the works one link reaches would read as a count of what the person wrote, and the catalogue does not carry that.`,
        );
      }
      notes.push(`${FORMS_CAVEAT} ${FORMS_FILTER_CAVEAT}`);
      if (works.some((work) => work.status === "provisional")) {
        notes.push(PROVISIONAL_CAVEAT);
      }
      notes.push(ORDER_CAVEAT, DATE_CAVEAT);
    }

    const body =
      works.length === 0
        ? emptyPageBody(emptiness, args.page, id.id)
        : `${works.length} work(s) the catalogue links to "${id.id}" as their creator:\n${works
            .map((work, index) => {
              const when = work.date ? ` (${work.date})` : "";
              const forms = work.forms.length > 0 ? ` · form: ${work.forms.join(", ")}` : "";
              const status = work.status === "provisional" ? " · provisional record" : "";
              return `${index + 1}. ${work.title ?? work.id}${when}${forms}${status} · id: ${work.id}\n   ${work.source_url}`;
            })
            .join("\n")}`;

    return ok(
      {
        author_id: id.id,
        works,
        page: args.page,
        has_more: data.hasMore,
        retrieved_at: retrievedAt,
        notes,
      },
      body,
      { retrievedAt, notes, sourceUrl: id.pageUrl },
    );
  } catch (error) {
    return toToolError(error);
  }
}

/** Refuse an address the catalogue describes as anything other than a person. */
async function assertPerson(client: BnfClient, id: EntityId): Promise<void> {
  const types = await client.types(id);
  if (types.data.length === 0) {
    throw notFound(`data.bnf.fr describes nothing at "${id.id}".`, {
      hint: "Find the identifier with search_authors rather than writing one.",
      url: id.pageUrl,
    });
  }
  if (!types.data.includes(PERSON_TYPE)) {
    throw notFound(
      `"${id.id}" is described by data.bnf.fr, and it is not a person: it is typed ${types.data.join(", ")}.`,
      {
        hint: "This tool walks from a person to the works they are credited with. For a work, list_editions reads its editions and get_work reads the record.",
        url: id.pageUrl,
      },
    );
  }
}
