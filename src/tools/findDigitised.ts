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
import { invalidInput, notFound } from "../errors.js";
import type { DigitisedLink } from "../types.js";
import { parseEntityId } from "../bnf/sparql.js";
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
import type { EntityId } from "../bnf/sparql.js";

/**
 * Whether the catalogue describes a person or a work at this address.
 *
 * The path a person is followed by and the path a work is followed by reach
 * different links, so the wrong one answers with part of the record or with
 * none of it. The name is only worth reading if the catalogue is what settled
 * it, so the type is read here whatever the caller wrote.
 */
async function whichKindTheCatalogueDescribes(
  client: BnfClient,
  id: EntityId,
): Promise<{ kind: "person" | "work" } | { error: ToolResult }> {
  // Only a work is addressed under temp-work, so the address settles it.
  if (id.kind === "temp-work") {
    return { kind: "work" };
  }

  const types = await client.types(id);
  if (types.data.length === 0) {
    return {
      error: toToolError(
        notFound(`data.bnf.fr describes nothing at "${id.id}".`, {
          hint: "Find the identifier with search_authors or search_works rather than writing one.",
          url: id.pageUrl,
        }),
      ),
    };
  }

  const found = recordKindOf(types.data);
  if (found === null) {
    return {
      error: toToolError(
        notFound(
          `"${id.id}" is described by data.bnf.fr, and it is neither a person nor a work: it is typed ${types.data.join(", ")}.`,
          {
            hint: "This tool follows a person or a work. For one edition, list_editions carries the digitised copies alongside the imprint.",
            url: id.pageUrl,
          },
        ),
      ),
    };
  }

  return { kind: found };
}

export const findDigitisedDescription = [
  "Gather the digitised documents the Bibliothèque nationale de France catalogue attaches to one person or one work, and return them as links.",
  "Give the identifier of either; the tool asks the catalogue what kind of record it is and follows the right path. For a work it walks the editions; for a person it takes the images on the record and the digitised editions of the works they are credited with. The 'kind' returned is what the catalogue types the record as.",
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
      "What you expect the identifier to name. The catalogue is asked either way, and a kind it contradicts is refused rather than followed. 'auto' states no expectation.",
    ),
  limit: z.number().int().min(1).max(200).default(40),
});

export const findDigitisedOutput = z.object({
  id: z.string(),
  kind: z.enum(["person", "work"]).describe("What the catalogue types this record as."),
  links: z.array(digitisedLinkSchema),
  links_returned_by_role: z
    .object({
      reproduction: z.number().int(),
      ocr: z.number().int(),
      depiction: z.number().int(),
    })
    .describe(
      "How many of the links in this answer carry each role. These count the links returned here, which is neither a count of documents nor a count of what the catalogue attaches: several links can name one document, and 'has_more' says when links were left out.",
    ),
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
    const id = parseEntityId(args.id);

    const notes: string[] = [];

    const settled = await whichKindTheCatalogueDescribes(client, id);
    if ("error" in settled) {
      return settled.error;
    }
    const kind = settled.kind;

    if (args.kind !== "auto" && args.kind !== kind) {
      return toToolError(
        invalidInput(
          `The call states that "${id.id}" is a ${args.kind}, and data.bnf.fr describes it as a ${kind}.`,
          `Leave 'kind' out, or pass '${kind}'. Following the ${args.kind} path over a ${kind} record answers with part of the record or with none of it, and nothing in that answer would say so.`,
        ),
      );
    }

    const { data, cached, retrievedAt } =
      kind === "person"
        ? await client.digitisedForPerson(id, args.limit)
        : await client.digitisedForWork(id, args.limit);

    if (cached) {
      notes.push("Served from this server's short-lived in-memory cache.");
    }

    const links = data.rows.map((link) => ({
      ark: link.ark,
      url: link.url,
      rendering: link.rendering,
      role: link.role,
      from_id: link.fromId,
      from_title: link.fromTitle,
    }));

    const counts = {
      reproduction: countRole(data.rows, "reproduction"),
      ocr: countRole(data.rows, "ocr"),
      depiction: countRole(data.rows, "depiction"),
    };

    const rendered = links.filter((link) => link.rendering !== null);

    if (links.length > 0) {
      notes.push(GALLICA_CAVEAT);
    }
    if (counts.depiction > 0) {
      notes.push(
        `${counts.depiction === 1 ? "One of these is an image" : `${counts.depiction} of these are images`} the catalogue uses to illustrate the record. Such an image can be a portrait, a title page, or a newspaper page that mentions the subject in passing, and the catalogue does not say which.`,
      );
    }
    if (rendered.length > 0) {
      notes.push(
        `${rendered.length === 1 ? "One of these addresses opens" : `${rendered.length} of these addresses open`} a rendering of a document rather than the document: what follows the ARK name in the address, such as 'thumbnail', is the view being asked for, and 'ark' names the document that view was taken from. Read 'rendering' before quoting a link as the document itself.`,
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
      notes.push(
        "The figures under 'links_returned_by_role' count the links in this answer, so they fall short of what the catalogue attaches by however much was left out.",
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
        links_returned_by_role: counts,
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
