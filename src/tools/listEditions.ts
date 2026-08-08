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
import { strictInput } from "./arguments.js";
import {
  GALLICA_CAVEAT,
  digitisedLinkSchema,
  ok,
  retrievedAtSchema,
  toToolError,
} from "./shared.js";
import type { ToolResult } from "./shared.js";

export const listEditionsDescription = [
  "List the published editions of one work in the Bibliothèque nationale de France catalogue, by the identifier search_works or get_work returns.",
  "Each row carries the publisher, the place, the year, the edition statement, the extent in the words of the record, the ISBN when there is one, and the record in the BnF general catalogue.",
  "An edition that has been digitised carries a link under 'digitised'. That link says a copy exists at that address; this server never opens it, so it cannot say whether the document is readable, complete, or free to reuse.",
  "Rows are in the order the catalogue holds them, which is neither by date nor by importance.",
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
  publisher: z.string().nullable(),
  place: z.string().nullable(),
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
    if (cached) notes.push("Served from this server's short-lived in-memory cache.");

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
        role: link.role,
        from_id: link.fromId,
        from_title: link.fromTitle,
      })),
      source_url: row.sourceUrl,
    }));

    const digitisedCount = editions.filter((edition) => edition.digitised.length > 0).length;
    if (digitisedCount > 0) notes.push(GALLICA_CAVEAT);

    if (data.hasMore) {
      notes.push(`More editions exist beyond this page. Ask for page ${args.page + 1}.`);
    }
    if (editions.length === 0 && args.page > 1) {
      notes.push(
        `Page ${args.page} holds no row, which means the list ended earlier rather than that the work has no editions. Ask for page 1 to see it from the start.`,
      );
    } else if (editions.length === 0) {
      notes.push(
        `The catalogue links no published edition to "${id.id}". A work record can exist with none: it happens on provisional records, and on works the BnF describes through an anthology rather than through an edition of their own. Check get_work to see what kind of record this is.`,
      );
    }
    if (editions.length > 0) {
      notes.push(
        "Rows are in the order the catalogue holds them. It is neither chronological nor an order of importance, so a first edition can appear anywhere in the list.",
      );
    }

    const body =
      editions.length === 0
        ? args.page > 1
          ? `Page ${args.page} of the editions of "${id.id}" holds no row.`
          : `The BnF catalogue links no edition to the work "${id.id}".`
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
