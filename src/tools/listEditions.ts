/**
 * list_editions: the published editions of one work.
 *
 * A manifestation is what a reader would call an edition: a publisher, a place,
 * a year, an extent, and sometimes a digitised copy. What the catalogue does
 * not record is whether that copy can be opened, by whom, or under what terms,
 * and there is no field that would let this server work it out. So a row that
 * carries a Gallica link says a link exists, and stops there.
 */

import { z } from "zod";
import type { BnfClient } from "../bnf/client.js";
import type { EntityId } from "../bnf/sparql.js";
import { notFound } from "../errors.js";
import { strictInput } from "./arguments.js";
import {
  GALLICA_CAVEAT,
  digitisedLinkSchema,
  ok,
  recordKindOf,
  retrievedAtSchema,
  toToolError,
} from "./shared.js";
import type { ToolResult } from "./shared.js";

/**
 * Why a page of editions came back empty.
 *
 * A page past the last one and a work the catalogue links no edition to are
 * different statements about the catalogue, and a caller cannot act on the
 * first the way they would act on the second.
 */
function nothingOnThisPage(page: number, work: string): string {
  if (page > 1) {
    return `Page ${page} of the editions of "${work}" holds no row.`;
  }
  return `The BnF catalogue links no edition to the work "${work}".`;
}

export const listEditionsDescription = [
  "List the published editions of one work in the Bibliothèque nationale de France catalogue, by the identifier search_works or get_work returns.",
  "Each row carries the publisher, the place, the year, the edition statement, the extent in the words of the record, the ISBN when there is one, and the record in the BnF general catalogue.",
  "An edition that has been digitised carries a link under 'digitised'. That link says a copy exists at that address; this server never opens it, so it cannot say whether the document is readable, complete, or free to reuse.",
  "Rows are ordered by the address the catalogue gives each edition, which is neither by date nor by importance.",
].join(" ");

export const listEditionsInput = strictInput({
  work_id: z.string().min(1).max(200).describe("The work identifier, such as 'cb11970626n'."),
  limit: z.number().int().min(1).max(50).default(10),
  page: z.number().int().min(1).max(100).default(1),
});

export const editionRowSchema = z.object({
  id: z.string().describe("The edition's own identifier in the BnF catalogue."),
  title: z.string().nullable().describe("The title as this edition carries it."),
  date: z
    .string()
    .nullable()
    .describe("The date as published, which can be a phrase such as '[s.d.]' for an undated one."),
  year: z.number().int().nullable().describe("The year, when the record states one as a number."),
  publisher: z
    .string()
    .nullable()
    .describe(
      "The publisher as the record writes it, square brackets included. A bracketed part is the cataloguer speaking rather than the item: '[s.n.]' is a publisher the item does not name, and a role such as '[éd., distrib.]' is what the named house did rather than part of its name.",
    ),
  place: z
    .string()
    .nullable()
    .describe(
      "The place of publication as the record writes it, square brackets included. '[Paris]' is a place the cataloguer supplied because the item does not print one, and '[S.l.]' is an item stating no place at all.",
    ),
  edition_statement: z.string().nullable().describe("Such as a numbered or revised edition."),
  extent: z
    .string()
    .nullable()
    .describe("The extent in the words of the record: pages, volumes, discs."),
  isbn: z.string().nullable(),
  note: z.string().nullable().describe("What the cataloguer wrote, as published."),
  catalogue_url: z.string().nullable(),
  digitised: z
    .array(digitisedLinkSchema)
    .describe(
      "Digitised copies of this edition, as links. An empty list means the catalogue records none here, not that none exists.",
    ),
  source_url: z.string(),
});

export const listEditionsOutput = z.object({
  work_id: z.string(),
  editions: z.array(editionRowSchema),
  page: z.number().int(),
  has_more: z.boolean(),
  digitised_count: z.number().int().describe("Editions on this page carrying at least one link."),
  retrieved_at: retrievedAtSchema,
  notes: z.array(z.string()),
});

export type ListEditionsArgs = z.infer<typeof listEditionsInput>;

export async function runListEditions(
  client: BnfClient,
  args: ListEditionsArgs,
): Promise<ToolResult> {
  try {
    const id = client.identify(args.work_id);
    const offset = (args.page - 1) * args.limit;
    const { data, cached, retrievedAt } = await client.listEditions(id, args.limit, offset);

    const notes: string[] = [];
    if (cached) {
      notes.push("Served from this server's short-lived in-memory cache.");
    }

    const editions = data.rows.map((row) => ({
      id: row.id,
      title: row.title,
      date: row.date,
      year: row.year,
      publisher: row.publisher,
      place: row.place,
      edition_statement: row.editionStatement,
      extent: row.extent,
      isbn: row.isbn,
      note: row.note,
      catalogue_url: row.catalogueUrl,
      digitised: row.digitised.map((link) => ({
        ark: link.ark,
        url: link.url,
        rendering: link.rendering,
        role: link.role,
        from_id: link.fromId,
        from_title: link.fromTitle,
      })),
      source_url: row.sourceUrl,
    }));

    const digitisedCount = editions.filter((edition) => edition.digitised.length > 0).length;
    if (digitisedCount > 0) {
      notes.push(GALLICA_CAVEAT);
    }

    // A bracketed value is a cataloguing convention, and a caller building a
    // citation out of one copies the cataloguer's aside into it as if the item
    // carried it. The values are passed on as published, so what the brackets
    // do is said rather than removed.
    const bracketed = editions.some(
      (edition) =>
        (edition.publisher?.includes("[") ?? false) || (edition.place?.includes("[") ?? false),
    );
    if (bracketed) {
      notes.push(
        "Square brackets in 'place' and 'publisher' are the cataloguer's own, kept as the record writes them: '[S.l.]' and '[s.n.]' are an item naming no place and no publisher, a bracketed name is one supplied from outside the item, and a bracketed role such as '[éd., distrib.]' says what a named house did. Drop them before quoting a value as what the item prints.",
      );
    }

    if (data.hasMore) {
      notes.push(`More editions exist beyond this page. Ask for page ${args.page + 1}.`);
    }
    if (editions.length === 0 && args.page > 1) {
      notes.push(
        `Page ${args.page} holds no row, which means the list ended earlier rather than that the work has no editions. Ask for page 1 to see it from the start.`,
      );
    } else if (editions.length === 0) {
      // A person, a subject heading and an address the BnF describes nowhere
      // all answer with no editions, and so does a work the catalogue links
      // none to. Explaining the empty list as a property of a work record
      // before the address is known to name one turns a wrong identifier into
      // a bibliographic fact.
      await assertWork(client, id);
      notes.push(
        `The catalogue links no published edition to "${id.id}". A work record can exist with none: it happens on provisional records, and on works the BnF describes through an anthology rather than through an edition of their own. Check get_work to see what kind of record this is.`,
      );
    }
    if (editions.length > 0) {
      notes.push(
        "Rows are ordered by the address the catalogue gives each edition. It is neither chronological nor an order of importance, so a first edition can appear anywhere in the list. That order is the one the pages are cut along, so reading page after page reaches every edition once.",
      );
    }

    const body =
      editions.length === 0
        ? nothingOnThisPage(args.page, id.id)
        : `${editions.length} edition(s) of "${id.id}":\n${editions
            .map((edition, index) => {
              const imprint = [edition.place, edition.publisher, edition.date]
                .filter(Boolean)
                .join(" : ");
              const extra = [
                edition.edition_statement,
                edition.extent,
                edition.isbn ? `ISBN ${edition.isbn}` : "",
              ]
                .filter(Boolean)
                .join(" · ");
              const links =
                edition.digitised.length > 0
                  ? `\n   digitised: ${edition.digitised.map((link) => `${link.role} ${link.url}`).join("  ")}`
                  : "";
              return `${index + 1}. ${edition.title ?? edition.id}${imprint ? ` · ${imprint}` : ""}${extra ? `\n   ${extra}` : ""}\n   ${edition.catalogue_url ?? edition.source_url}${links}`;
            })
            .join("\n")}`;

    return ok(
      {
        work_id: id.id,
        editions,
        page: args.page,
        has_more: data.hasMore,
        digitised_count: digitisedCount,
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

/** Refuse an address the catalogue describes as anything other than a work. */
async function assertWork(client: BnfClient, id: EntityId): Promise<void> {
  // Only a work is addressed under temp-work, so the address settles it and no
  // query is spent.
  if (id.kind === "temp-work") {
    return;
  }

  const types = await client.types(id);
  if (types.data.length === 0) {
    throw notFound(`data.bnf.fr describes nothing at "${id.id}".`, {
      hint: "Find the identifier with search_works, or with list_works for the works of one person.",
      url: id.pageUrl,
    });
  }
  if (recordKindOf(types.data) !== "work") {
    throw notFound(
      `"${id.id}" is described by data.bnf.fr, and it is not a work: it is typed ${types.data.join(", ")}.`,
      {
        hint: "This tool reads the editions of a work. For a person, list_works reaches the works they are credited with and get_author reads their record.",
        url: id.pageUrl,
      },
    );
  }
}
