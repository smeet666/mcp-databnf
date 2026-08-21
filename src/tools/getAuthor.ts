/**
 * get_author: read one person's authority record.
 *
 * The record is a set of statements a cataloguer entered, and its shape says
 * what it is for. Dates, places, a language, a country, a Dewey class and
 * alignments to VIAF, IdRef and DBpedia are all there and all reliable. A
 * biography is not: `biographicalInformation` holds "Poète" on Rimbaud, and a
 * caller asked for a life story has to be told that the field is a job title
 * rather than handed one word dressed up as one.
 */

import { z } from "zod";
import type { BnfClient } from "../bnf/client.js";
import { strictInput } from "./arguments.js";
import {
  ALIGNMENTS_CAVEAT,
  GALLICA_CAVEAT,
  SEVERAL_RECORDS_CAVEAT,
  digitisedLinkSchema,
  headingYearConflicts,
  ok,
  retrievedAtSchema,
  toToolError,
} from "./shared.js";
import type { ToolResult } from "./shared.js";
import type { AuthorDetail } from "../types.js";

/**
 * What the catalogue's own shape says about the record, beyond its fields.
 *
 * Each sentence answers something a reader would otherwise conclude wrongly: a
 * field that holds an occupation rather than a life, one statement written
 * twice, dates that disagree with the heading they sit under, and a silence
 * about a death that means different things depending on whether the record
 * dates the person at all.
 */
function notesOnWhatTheRecordStates(data: AuthorDetail, args: GetAuthorArgs): string[] {
  const notes: string[] = [];

  if (data.biographicalInformation !== null) {
    notes.push(
      `The BnF states "${data.biographicalInformation}" as this person's biographical information. That field holds an occupation rather than a life, and this is all the catalogue says.`,
    );
  }
  // Two fields carrying one string are one statement. Read as two they
  // corroborate each other, and a reader counts a second source that the
  // record does not hold.
  if (data.biographicalInformation !== null && data.biographicalInformation === data.occupation) {
    notes.push(
      "This record states the same text under 'biographical_information' and 'occupation', character for character. It is one statement written in two fields rather than two the record makes separately.",
    );
  }
  // A record can carry its dates twice, in the brackets of a heading and in
  // the fields, and the two can disagree. The fields are what the searches
  // read and what a caller compares to tell two people of one name apart, so
  // the disagreement is stated: nothing on the record says which side a
  // cataloguer meant, and choosing one would settle a date the BnF has not.
  const headings = [data.label, ...data.otherNames.map((other) => other.label)];
  const conflicts = [
    ...new Set(
      headings.flatMap((heading) => headingYearConflicts(heading, data.birthYear, data.deathYear)),
    ),
  ];
  if (conflicts.length > 0) {
    notes.push(
      `This record states its dates twice and the two disagree: the heading says ${conflicts.join(", and ")}. Both are passed on as the BnF publishes them, and the record says nothing about which is right, so read source_url before citing either.`,
    );
  }

  // What the silence about a death is worth depends on whether the record
  // dates the person at all. A record carrying a birth places them in time
  // and leaves one statement missing; a record carrying neither places them
  // nowhere, and reading a life out of it is reading a life out of a heading.
  if (data.deathDate === null && data.deathYear === null) {
    const dated = data.birthDate !== null || data.birthYear !== null;
    notes.push(
      dated
        ? "The record states no date of death. That can mean the person is living, or that the BnF has not recorded one; the catalogue does not distinguish the two."
        : `This record states no date of birth and no date of death, so it dates the person nowhere and says nothing about whether they are living. ${SEVERAL_RECORDS_CAVEAT}`,
    );
  }
  if (Object.keys(data.sameAs).length > 0) {
    notes.push(
      `${ALIGNMENTS_CAVEAT} Following one is how to reach a biography, which this catalogue does not hold.`,
    );
  }
  // The caveat is about links a caller is holding. On an answer that returns
  // none, it describes a list that is not there and reads as a list withheld.
  if (args.include_depictions && data.depictions.length > 0) {
    notes.push(GALLICA_CAVEAT);
  }

  return notes;
}

export const getAuthorDescription = [
  "Read one person's record in the Bibliothèque nationale de France authority file, by the identifier search_authors returns.",
  "It carries the dates and places of birth and death, the occupation the record names, the language and country it associates with the person, the field of activity with its Dewey class, and the addresses for the same person in VIAF, IdRef, DBpedia, Wikidata and ISNI.",
  "It carries no biography. The field the BnF calls biographical information is a job title on most records and a single word on many, so quote it as what the catalogue states and do not build a life story out of it.",
  "It lists no work. list_works walks from this record to the works the catalogue names the person the creator of, and states what that link does and does not reach.",
  "'depictions' are images data.bnf.fr attaches to the person. They are links for a person to open; this server does not read them, and an image can be a page that mentions the person rather than a portrait of them.",
].join(" ");

export const getAuthorInput = strictInput({
  author_id: z
    .string()
    .min(1)
    .max(200)
    .describe(
      "The identifier from search_authors, such as 'cb119219976'. A full data.bnf.fr address is accepted too.",
    ),
  include_depictions: z
    .boolean()
    .default(false)
    .describe(
      "Include the images data.bnf.fr attaches to the person. A well-known person can carry dozens, so they are left out by default. find_digitised gathers them with everything else.",
    ),
});

export const getAuthorOutput = z.object({
  author: z.object({
    id: z.string(),
    name: z.string().nullable(),
    label: z.string().nullable().describe("The authority heading, usually with the dates."),
    given_name: z.string().nullable(),
    family_name: z.string().nullable(),
    other_names: z
      .array(z.object({ label: z.string(), language: z.string().nullable() }))
      .describe("Other headings the record carries, including transliterations and pen names."),
    birth_date: z.string().nullable().describe("As published, usually YYYY-MM-DD."),
    death_date: z.string().nullable(),
    birth_year: z.number().int().nullable(),
    death_year: z.number().int().nullable(),
    birth_place: z.string().nullable(),
    death_place: z.string().nullable(),
    biographical_information: z
      .string()
      .nullable()
      .describe(
        "What the record states about the person. This is a job title on most records and a single word on many; it is not a biography.",
      ),
    occupation: z.string().nullable(),
    languages: z.array(z.string()).describe("ISO 639-2 codes, such as 'fre'."),
    countries: z.array(z.string()).describe("Country codes, such as 'fr'."),
    fields: z.array(z.string()).describe("Fields of activity in the words of the record."),
    dewey_classes: z
      .array(z.string())
      .describe("Dewey classes the fields point at, such as '800' for literature."),
    same_as: z
      .record(z.string(), z.array(z.string()))
      .describe("Addresses for the same person in other files, grouped by file."),
    catalogue_url: z
      .string()
      .nullable()
      .describe(
        "The address of this record in the BnF general catalogue, as the record itself points at it. Null when the record states none, which is a silence in the record rather than a record the general catalogue lacks: no address is built in its place.",
      ),
    record_created: z.string().nullable().describe("When the authority record was created."),
    record_modified: z.string().nullable().describe("When it was last changed."),
    source_url: z.string(),
  }),
  depictions: z.array(digitisedLinkSchema).optional(),
  depiction_count: z
    .number()
    .int()
    .describe(
      "Images on Gallica that the record points at, counted whether or not they were returned. An illustration the record holds elsewhere is not counted, because this server describes Gallica documents and knows nothing about the others.",
    ),
  retrieved_at: retrievedAtSchema,
  notes: z.array(z.string()),
});

export type GetAuthorArgs = z.infer<typeof getAuthorInput>;

export async function runGetAuthor(client: BnfClient, args: GetAuthorArgs): Promise<ToolResult> {
  try {
    const id = client.identify(args.author_id);
    const { data, cached, retrievedAt } = await client.getAuthor(id);

    const notes: string[] = [];
    if (cached) {
      notes.push("Served from this server's short-lived in-memory cache.");
    }

    notes.push(...notesOnWhatTheRecordStates(data, args));

    const structured: Record<string, unknown> = {
      author: {
        id: data.id,
        name: data.name,
        label: data.label,
        given_name: data.givenName,
        family_name: data.familyName,
        other_names: data.otherNames,
        birth_date: data.birthDate,
        death_date: data.deathDate,
        birth_year: data.birthYear,
        death_year: data.deathYear,
        birth_place: data.birthPlace,
        death_place: data.deathPlace,
        biographical_information: data.biographicalInformation,
        occupation: data.occupation,
        languages: data.languages,
        countries: data.countries,
        fields: data.fields,
        dewey_classes: data.deweyClasses,
        same_as: data.sameAs,
        catalogue_url: data.catalogueUrl,
        record_created: data.recordCreated,
        record_modified: data.recordModified,
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

    const born = [
      data.birthDate ?? (data.birthYear === null ? null : String(data.birthYear)),
      data.birthPlace,
    ]
      .filter(Boolean)
      .join(", ");
    const died = [
      data.deathDate ?? (data.deathYear === null ? null : String(data.deathYear)),
      data.deathPlace,
    ]
      .filter(Boolean)
      .join(", ");

    const lines = [
      data.label ?? data.name ?? data.id,
      born ? `Born: ${born}` : "",
      died ? `Died: ${died}` : "",
      data.occupation ? `Occupation as recorded: ${data.occupation}` : "",
      data.fields.length > 0
        ? `Field of activity: ${data.fields.join(", ")}${data.deweyClasses.length > 0 ? ` (Dewey ${data.deweyClasses.join(", ")})` : ""}`
        : "",
      data.languages.length > 0 ? `Language: ${data.languages.join(", ")}` : "",
      data.countries.length > 0 ? `Country: ${data.countries.join(", ")}` : "",
      data.otherNames.length > 0
        ? `Also recorded as: ${data.otherNames.map((other) => other.label).join("; ")}`
        : "",
      Object.keys(data.sameAs).length > 0
        ? `Same person in: ${Object.entries(data.sameAs)
            .map(([file, addresses]) => `${file} ${addresses[0]}`)
            .join(" · ")}`
        : "",
      data.catalogueUrl ? `BnF catalogue: ${data.catalogueUrl}` : "",
      data.depictions.length > 0
        ? `Images attached to this record: ${data.depictions.length}${args.include_depictions ? "" : " (ask with include_depictions, or use find_digitised)"}`
        : "",
    ].filter(Boolean);

    return ok(structured, lines.join("\n"), { retrievedAt, notes, sourceUrl: data.sourceUrl });
  } catch (error) {
    return toToolError(error);
  }
}
