/**
 * find_digitised: every digitised document the catalogue attaches to one
 * person or one work, gathered as links.
 *
 * The links point at gallica.bnf.fr, and this server never requests that host.
 * The BnF places its metadata and its digitised contents under two different
 * regimes: the catalogue described here is free to reuse with its source and
 * its date of retrieval named, while Gallica's terms make use of its contents
 * inside an artificial-intelligence project subject to a paid licence outside
 * academic research, and its server refuses automated agents outright.
 *
 * So the answer is a list of addresses and what the catalogue says about each,
 * and nothing at all about what is at the other end. An OCR link in particular
 * names a machine-read text that exists; the text stays where it is.
 */

import { z } from "zod";
import type { BnfClient } from "../bnf/client.js";
import { notFound } from "../errors.js";
import type { DigitisedLink } from "../types.js";
import { strictInput } from "./arguments.js";
import {
  GALLICA_CAVEAT,
  digitisedLinkSchema,
  ok,
  retrievedAtSchema,
  toToolError,
} from "./shared.js";
import type { ToolResult } from "./shared.js";

const PERSON_TYPE = "http://xmlns.com/foaf/0.1/Person";
const WORK_TYPES = [
  "http://rdvocab.info/uri/schema/FRBRentitiesRDA/Work",
  "http://rdaregistry.info/Elements/c/#C10001",
];

export const findDigitisedDescription = [
  "Gather the digitised documents the Bibliothèque nationale de France catalogue attaches to one person or one work, and return them as links.",
  "Give the identifier of either; the tool reads what kind of record it is and follows the right path. For a work it walks the editions; for a person it takes the images on the record and the digitised editions of the works they are credited with.",
  "Every result is a link for someone to open. This server reads the BnF catalogue and never requests gallica.bnf.fr, so it reports nothing about what is at the other end: not whether the document opens, not what it contains, not on what terms it may be reused.",
  "It returns links and nothing else: no publisher, no date, no ISBN. Use list_editions when which edition a copy belongs to matters.",
  "A 'depiction' illustrates a record and can be a page that merely mentions the subject. A 'reproduction' is an edition digitised. An 'ocr' link names a machine-read text of a document, which this server does not fetch.",
].join(" ");

export const findDigitisedInput = strictInput({
  id: z
    .string()
    .min(1)
    .max(200)
    .describe(
      "A person or work identifier, such as 'cb119219976' or 'cb11970626n'. The argument is named 'id' rather than 'work_id' or 'author_id' because it takes either.",
    ),
  kind: z
    .enum(["auto", "person", "work"])
    .default("auto")
    .describe(
      "Which kind of record the identifier names. 'auto' asks the catalogue, which costs one extra query.",
    ),
  limit: z.number().int().min(1).max(200).default(40),
});

export const findDigitisedOutput = z.object({
  id: z.string(),
  kind: z.enum(["person", "work"]).describe("What the catalogue types this record as."),
  links: z.array(digitisedLinkSchema),
  counts: z
    .object({
      reproduction: z.number().int(),
      ocr: z.number().int(),
      depiction: z.number().int(),
    })
    .describe("Links returned on this page, by role. These count links, not documents."),
  has_more: z.boolean(),
  retrieved_at: retrievedAtSchema,
  notes: z.array(z.string()),
});

export type FindDigitisedArgs = z.infer<typeof findDigitisedInput>;

export async function runFindDigitised(
  client: BnfClient,
  args: FindDigitisedArgs,
): Promise<ToolResult> {
  try {
    const id = client.identify(args.id);

    let kind: "person" | "work";
    const notes: string[] = [];

    if (args.kind === "auto") {
      // A provisional identifier can only be a work, so the question is settled
      // without asking.
      if (id.kind === "temp-work") {
        kind = "work";
      } else {
        const types = await client.types(id);
        if (types.data.length === 0) {
          return toToolError(
            notFound(`data.bnf.fr describes nothing at "${id.id}".`, {
              hint: "Find the identifier with search_authors or search_works rather than writing one.",
              url: id.pageUrl,
            }),
          );
        }
        // An edition, an expression and a subject heading all have identifiers
        // of the same shape. Reading one of them as a work asks a question it
        // can never answer, and the empty answer reads as the BnF having
        // digitised nothing.
        if (types.data.includes(PERSON_TYPE)) kind = "person";
        else if (types.data.some((type) => WORK_TYPES.includes(type))) kind = "work";
        else {
          return toToolError(
            notFound(
              `"${id.id}" is described by data.bnf.fr, and it is neither a person nor a work: it is typed ${types.data.join(", ")}.`,
              {
                hint: "This tool follows a person or a work. For one edition, list_editions carries the digitised copies alongside the imprint.",
                url: id.pageUrl,
              },
            ),
          );
        }
      }
    } else {
      kind = args.kind;
    }

    const { data, cached, retrievedAt } =
      kind === "person"
        ? await client.digitisedForPerson(id, args.limit)
        : await client.digitisedForWork(id, args.limit);

    if (cached) notes.push("Served from this server's short-lived in-memory cache.");

    const links = data.rows.map((link) => ({
      ark: link.ark,
      url: link.url,
      role: link.role,
      from_id: link.fromId,
      from_title: link.fromTitle,
    }));

    const counts = {
      reproduction: countRole(data.rows, "reproduction"),
      ocr: countRole(data.rows, "ocr"),
      depiction: countRole(data.rows, "depiction"),
    };

    if (links.length > 0) notes.push(GALLICA_CAVEAT);
    if (counts.depiction > 0) {
      notes.push(
        `${counts.depiction === 1 ? "One of these is an image" : `${counts.depiction} of these are images`} the catalogue uses to illustrate the record. Such an image can be a portrait, a title page, or a newspaper page that mentions the subject in passing, and the catalogue does not say which.`,
      );
    }
    if (counts.ocr > 0) {
      notes.push(
        `${counts.ocr === 1 ? "One of these points" : `${counts.ocr} of these point`} at a text a machine read off a scanned document. This server names that text and does not read it.`,
      );
    }
    if (data.hasMore) {
      notes.push(
        args.limit >= 200
          ? "The catalogue points at more documents than this tool will return in one answer, and it does not page: 200 is the ceiling. Read the editions with list_editions to reach the rest, one page at a time."
          : `More links exist than were returned. Raise 'limit' to see more of them, up to 200. This tool does not page, so a higher limit re-reads the links already shown rather than continuing after them.`,
      );
    }
    if (links.length === 0) {
      notes.push(
        `The catalogue attaches no digitised document to "${id.id}". That is a statement about the catalogue: the BnF digitises a fraction of what it holds, and a document can be on Gallica without the record here pointing at it.`,
      );
    }

    const body =
      links.length === 0
        ? `The BnF catalogue attaches no digitised document to "${id.id}".`
        : `${links.length} link(s) for "${id.id}" (${kind}):\n${links
            .map((link, index) => {
              const from = link.from_title ? ` · from: ${link.from_title}` : "";
              return `${index + 1}. [${link.role}] ${link.url}${from}`;
            })
            .join("\n")}`;

    return ok(
      {
        id: id.id,
        kind,
        links,
        counts,
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

const countRole = (links: readonly DigitisedLink[], role: DigitisedLink["role"]): number =>
  links.filter((link) => link.role === role).length;
