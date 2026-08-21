/**
 * get_work: read one work's record.
 *
 * The BnF holds two kinds of work record, and telling them apart is the point
 * of this tool. An established work has an ARK of its own, a settled title, and
 * links to every expression the catalogue knows. A provisional one is addressed
 * under `temp-work`, was created to hold a title a cataloguer has not yet
 * settled, and can be renamed, re-addressed or merged away. Quoting a
 * provisional identifier as a stable one is how a citation goes bad quietly, so
 * the record says which it is in words rather than leaving it to be read off
 * the shape of an address.
 */

import { z } from "zod";
import type { BnfClient } from "../bnf/client.js";
import { strictInput } from "./arguments.js";
import {
  ALIGNMENTS_CAVEAT,
  FORMS_CAVEAT,
  GALLICA_CAVEAT,
  PROVISIONAL_CAVEAT,
  digitisedLinkSchema,
  ok,
  retrievedAtSchema,
  toToolError,
} from "./shared.js";
import type { ToolResult } from "./shared.js";
import type { WorkDetail } from "../types.js";

/**
 * What the catalogue's own shape says about the work, beyond its fields.
 *
 * A provisional record, a form stated as a code the catalogue publishes no
 * label for, an alignment that reaches a description this catalogue does not
 * hold: each is something a reader would otherwise take for more than it is.
 */
function notesOnWhatTheRecordStates(data: WorkDetail, args: GetWorkArgs): string[] {
  const notes: string[] = [];

  if (data.status === "provisional") {
    notes.push(
      `This is a provisional record, addressed under 'temp-work' rather than by an ARK${data.statusStatement ? ` and stated as "${data.statusStatement}"` : ""}. ${PROVISIONAL_CAVEAT}`,
    );
  } else {
    notes.push(
      `This is an established work record, addressed by the ARK '${data.id}'${data.statusStatement ? ` and stated as "${data.statusStatement}"` : ""}. That identifier is the one to cite.`,
    );
  }

  if (data.truncated) {
    notes.push(
      "This record is longer than one query reads, so parts of it are missing from this answer. A field shown as empty here may be filled on the record itself: open source_url before concluding that the BnF states nothing.",
    );
  }
  if (data.expressionCount !== null && data.expressionCount > 0) {
    notes.push(
      `The record links ${data.expressionCount} expression(s): translations, adaptations and recordings of this work. Published editions are a separate count, and list_editions is what reads them.`,
    );
  }
  // The codes are printed in the body and in the payload, so what they are
  // travels with them: a reader shown 'poesi' beside 'te' has no way of
  // telling a word from an opaque term without being told.
  if (data.forms.length > 0) {
    notes.push(FORMS_CAVEAT);
  }
  if (data.creators.length === 0) {
    notes.push(
      "The record credits nobody with this work. That is normal for anonymous and traditional works, and it also happens on records a cataloguer has not finished.",
    );
  }
  if (Object.keys(data.sameAs).length > 0) {
    notes.push(ALIGNMENTS_CAVEAT);
  }
  // The caveat is about links a caller is holding. On an answer that returns
  // none, it describes a list that is not there and reads as a list withheld.
  if (args.include_depictions && data.depictions.length > 0) {
    notes.push(GALLICA_CAVEAT);
  }

  return notes;
}

export const getWorkDescription = [
  "Read one work's record in the Bibliothèque nationale de France catalogue, by the identifier search_works returns.",
  "It carries the title, everyone the record credits, the date the BnF gives the work, its language, its form and its subject with the Dewey class.",
  "'forms' holds the work-form vocabulary's own terms, which carry no label in this dataset, so some read as words and some do not. A record stating none has a form the catalogue does not state.",
  "'status' says whether the record is established or provisional, and 'status_statement' repeats what the catalogue itself states. A provisional identifier can change, so cite an established one where there is a choice.",
  "'expression_count' counts the expressions the record links, which is not a count of published editions: use list_editions for those.",
].join(" ");

export const getWorkInput = strictInput({
  work_id: z
    .string()
    .min(1)
    .max(200)
    .describe(
      "The identifier from search_works, such as 'cb11970626n' or 'temp-work/22d7f68c1a4bdd081ad7ca791fd3b730'.",
    ),
  include_depictions: z
    .boolean()
    .default(false)
    .describe(
      "Include the images data.bnf.fr attaches to the work. A well-known work can carry dozens, so they are left out by default. find_digitised gathers them alongside the digitised editions.",
    ),
});

export const getWorkOutput = z.object({
  work: z.object({
    id: z.string(),
    title: z.string().nullable(),
    label: z.string().nullable(),
    date: z.string().nullable().describe("The date the record gives the work, as published."),
    first_year: z.number().int().nullable(),
    creators: z.array(z.object({ id: z.string(), name: z.string().nullable() })),
    languages: z.array(z.string()).describe("ISO 639-2 codes."),
    forms: z
      .array(z.string())
      .describe(
        "Terms of the BnF work-form vocabulary, as the terms themselves. The vocabulary publishes no label for them here, so they are not translated: some read as words, such as 'poesi', and some do not, such as 'te'. An empty list is a form the record does not state.",
      ),
    subjects: z.array(z.string()).describe("Subjects in the words of the record."),
    dewey_classes: z.array(z.string()),
    status: z.enum(["established", "provisional"]),
    status_statement: z
      .string()
      .nullable()
      .describe("What the record itself states, such as 'fully established' or 'provisional'."),
    expression_count: z
      .number()
      .int()
      .nullable()
      .describe(
        "Expressions the record links: translations, adaptations, recordings. This is not a count of published editions. Null when the record was longer than one query reads, since the number would then be the ceiling rather than the count.",
      ),
    same_as: z.record(z.string(), z.array(z.string())),
    catalogue_url: z
      .string()
      .nullable()
      .describe(
        "The address of this record in the BnF general catalogue, as the record itself points at it. Null when the record states none, which is the ordinary case on work records: it is a silence in the record rather than a record the general catalogue lacks, and no address is built in its place.",
      ),
    source_url: z.string(),
  }),
  depictions: z.array(digitisedLinkSchema).optional(),
  depiction_count: z
    .number()
    .int()
    .describe(
      "Images on Gallica that the record points at, counted whether or not they were returned.",
    ),
  retrieved_at: retrievedAtSchema,
  notes: z.array(z.string()),
});

export type GetWorkArgs = z.infer<typeof getWorkInput>;

export async function runGetWork(client: BnfClient, args: GetWorkArgs): Promise<ToolResult> {
  try {
    const id = client.identify(args.work_id);
    const { data, cached, retrievedAt } = await client.getWork(id);

    const notes: string[] = [];
    if (cached) {
      notes.push("Served from this server's short-lived in-memory cache.");
    }

    notes.push(...notesOnWhatTheRecordStates(data, args));

    const structured: Record<string, unknown> = {
      work: {
        id: data.id,
        title: data.title,
        label: data.label,
        date: data.date,
        first_year: data.firstYear,
        creators: data.creators,
        languages: data.languages,
        forms: data.forms,
        subjects: data.subjects,
        dewey_classes: data.deweyClasses,
        status: data.status,
        status_statement: data.statusStatement,
        expression_count: data.expressionCount,
        same_as: data.sameAs,
        catalogue_url: data.catalogueUrl,
        source_url: data.sourceUrl,
      },
      depiction_count: data.depictions.length,
      retrieved_at: retrievedAt,
      notes,
    };

    if (args.include_depictions) {
      structured.depictions = data.depictions.map((link) => ({
        ark: link.ark,
        url: link.url,
        rendering: link.rendering,
        role: link.role,
        from_id: link.fromId,
        from_title: link.fromTitle,
      }));
    }

    const lines = [
      [data.title ?? data.label ?? data.id, data.date ? `(${data.date})` : ""]
        .filter(Boolean)
        .join(" "),
      data.creators.length > 0
        ? `By: ${data.creators.map((creator) => creator.name ?? creator.id).join(", ")}`
        : "",
      `Record: ${data.status === "provisional" ? "provisional" : "established"}`,
      data.languages.length > 0 ? `Language: ${data.languages.join(", ")}` : "",
      data.forms.length > 0 ? `Form: ${data.forms.join(", ")}` : "",
      data.subjects.length > 0
        ? `Subject: ${data.subjects.join(", ")}${data.deweyClasses.length > 0 ? ` (Dewey ${data.deweyClasses.join(", ")})` : ""}`
        : "",
      data.catalogueUrl ? `BnF catalogue: ${data.catalogueUrl}` : "",
    ].filter(Boolean);

    return ok(structured, lines.join("\n"), { retrievedAt, notes, sourceUrl: data.sourceUrl });
  } catch (error) {
    return toToolError(error);
  }
}
