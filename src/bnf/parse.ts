/**
 * Turning result rows into the shapes the tools render.
 *
 * The rule the whole file follows: a statement the record does not carry comes
 * out as `null` or as an empty list, never as a plausible value. A person with
 * no recorded year of death is alive, or unresearched, or died in a year nobody
 * wrote down, and the three are different claims. Only the record decides.
 */

import { isGallicaAddress, publicPageFor } from "./endpoint.js";
import { MOST_TRIPLES, TEXT_WINDOW } from "./queries.js";
import type { SparqlResults, SparqlRow, SparqlTerm } from "./http.js";
import type {
  AuthorDetail,
  AuthorSummary,
  AuthoredWork,
  DigitisedLink,
  Edition,
  Page,
  WorkDetail,
  WorkSummary,
} from "../types.js";

/** Predicates read off a record. Named once, so a rename is one edit. */
const P = {
  type: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
  label: "http://www.w3.org/2000/01/rdf-schema#label",
  seeAlso: "http://www.w3.org/2000/01/rdf-schema#seeAlso",
  sameAs: "http://www.w3.org/2002/07/owl#sameAs",
  exactMatch: "http://www.w3.org/2004/02/skos/core#exactMatch",
  closeMatch: "http://www.w3.org/2004/02/skos/core#closeMatch",
  prefLabel: "http://www.w3.org/2004/02/skos/core#prefLabel",
  altLabel: "http://www.w3.org/2004/02/skos/core#altLabel",
  created: "http://purl.org/dc/terms/created",
  modified: "http://purl.org/dc/terms/modified",
  title: "http://purl.org/dc/terms/title",
  date: "http://purl.org/dc/terms/date",
  creator: "http://purl.org/dc/terms/creator",
  language: "http://purl.org/dc/terms/language",
  subject: "http://purl.org/dc/terms/subject",
  name: "http://xmlns.com/foaf/0.1/name",
  givenName: "http://xmlns.com/foaf/0.1/givenName",
  familyName: "http://xmlns.com/foaf/0.1/familyName",
  depiction: "http://xmlns.com/foaf/0.1/depiction",
  birth: "http://vocab.org/bio/0.1/birth",
  death: "http://vocab.org/bio/0.1/death",
  firstYear: "http://data.bnf.fr/ontology/bnf-onto/firstYear",
  lastYear: "http://data.bnf.fr/ontology/bnf-onto/lastYear",
  subjectLabel: "http://data.bnf.fr/ontology/bnf-onto/subject",
  isni: "http://isni.org/ontology#identifierValid",
  placeOfBirth: "http://rdvocab.info/ElementsGr2/placeOfBirth",
  placeOfDeath: "http://rdvocab.info/ElementsGr2/placeOfDeath",
  biographicalInformation: "http://rdvocab.info/ElementsGr2/biographicalInformation",
  languageOfThePerson: "http://rdvocab.info/ElementsGr2/languageOfThePerson",
  countryAssociated: "http://rdvocab.info/ElementsGr2/countryAssociatedWithThePerson",
  fieldOfActivity: "http://rdvocab.info/ElementsGr2/fieldOfActivityOfThePerson",
  formOfWork: "http://rdvocab.info/Elements/formOfWork",
  statusOfIdentification: "http://rdvocab.info/Elements/statusOfIdentification",
  /** The occupation, which RDA numbers rather than names. */
  occupation: "http://rdaregistry.info/Elements/a/#P50113",
  /** Expressions of a work, which are not editions. */
  expressionOfWork: "http://rdaregistry.info/Elements/w/#P10078",
} as const;

/** Files whose addresses this dataset aligns records with. */
const ALIGNMENT_HOSTS: Array<{ host: string; name: string }> = [
  { host: "viaf.org", name: "viaf" },
  { host: "idref.fr", name: "idref" },
  { host: "dbpedia.org", name: "dbpedia" },
  { host: "wikidata.org", name: "wikidata" },
  { host: "isni.org", name: "isni" },
  { host: "d-nb.info", name: "gnd" },
  { host: "id.loc.gov", name: "loc" },
  { host: "datos.bne.es", name: "bne" },
  { host: "wikipedia.org", name: "wikipedia" },
  { host: "musicbrainz.org", name: "musicbrainz" },
  { host: "francearchives.gouv.fr", name: "francearchives" },
  { host: "imslp.org", name: "imslp" },
  { host: "catalogue.bnf.fr", name: "catalogue" },
];

const text = (term: SparqlTerm | undefined): string | null => {
  if (!term) return null;
  const value = term.value.trim();
  return value === "" ? null : value;
};

const integer = (term: SparqlTerm | undefined): number | null => {
  const raw = text(term);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isInteger(value) ? value : null;
};

/** The identifier a caller quotes, read back off the address of a record. */
export function idFromIri(iri: string): string | null {
  const ark = /ark:\/12148\/(c[bc][0-9a-z]+)/i.exec(iri);
  if (ark?.[1]) return ark[1].toLowerCase();
  const temp = /temp-work\/([0-9a-f]{32})/i.exec(iri);
  if (temp?.[1]) return `temp-work/${temp[1].toLowerCase()}`;
  return null;
}

/** The last segment of a vocabulary address, which is the term itself. */
const vocabularyTerm = (iri: string): string =>
  decodeURIComponent(iri.replace(/[/#]$/, "").split(/[/#]/).pop() ?? iri);

/**
 * A Gallica address turned into a link.
 *
 * Returns null for anything that is not a Gallica address, so a record pointing
 * somewhere else does not arrive labelled as a digitised BnF document. The
 * address is carried through as published: it is what a person will open.
 */
export function toDigitisedLink(
  address: string | null,
  role: DigitisedLink["role"],
  fromId: string,
  fromTitle: string | null,
): DigitisedLink | null {
  if (!address || !isGallicaAddress(address)) return null;
  const segment = /ark:\/12148\/([^/?#]+)/.exec(address)?.[1] ?? null;
  if (!segment) return null;
  // An address can carry a rendering after the name: `.thumbnail` asks for a
  // small image of the document, `.item` for one leaf of it. An ARK name holds
  // no full stop, so what precedes the first one is the identifier and the rest
  // describes a view of it. Reporting the view as the identifier would give two
  // views of one document two identifiers.
  const ark = segment.split(".")[0] ?? segment;
  if (ark === "") return null;
  return { ark, url: address, rendering: renderingOf(address, ark), role, fromId, fromTitle };
}

/**
 * The view an address asks for, read off what follows the ARK name in it.
 *
 * `bpt6k90000030` names a document; `bpt6k90000030.thumbnail` asks for a small
 * image of it and `btv1b90000002/f3.item.thumbnail` for one leaf of it as an
 * image. Carrying that as a field of its own is what keeps `url` and `ark` from
 * reading as two names for one thing: a caller told only the ARK would quote a
 * document while having been handed a picture of a page of it.
 */
function renderingOf(address: string, ark: string): string | null {
  const path = address.split(/[?#]/)[0] ?? address;
  const after = path.slice(path.indexOf(`ark:/12148/${ark}`) + `ark:/12148/${ark}`.length);
  const rendering = after.replace(/^[./]+/, "").replace(/\/+$/, "");
  return rendering === "" ? null : rendering;
}

/**
 * A page, with the rows beyond it read as more existing.
 *
 * `hasMore` is true when the endpoint sent the extra row that was asked for, and
 * also when a row had to be dropped: a page that came back short because this
 * client could not read part of it is not a page with room to spare.
 */
function page<T>(rows: T[], limit: number, skipped: number): Page<T> {
  const more = rows.length > limit;
  return skipped > 0
    ? { rows: rows.slice(0, limit), hasMore: more, skipped }
    : { rows: rows.slice(0, limit), hasMore: more };
}

/**
 * Whether the index window a text search reads came back full.
 *
 * The endpoint sends the occupancy on a row of its own, binding the count and
 * naming no entity. A count that reaches the size of the window means the
 * reading stopped where the window did rather than where the matches did.
 *
 * Null when no such row arrived, since a window nobody measured supports no
 * statement about what was left out.
 */
function readWindowOccupancy(results: SparqlResults): boolean | null {
  for (const row of results.results.bindings) {
    const raw = text(row.windowRows);
    if (raw === null) continue;
    const count = Number(raw);
    if (Number.isInteger(count)) return count >= TEXT_WINDOW;
  }
  return null;
}

/**
 * True for the row carrying the occupancy and nothing else.
 *
 * It names no record, which is the shape of a row that had to be dropped. It is
 * neither: counting it as dropped would report the page as short of a record
 * the endpoint never claimed to send.
 */
const isOccupancyRow = (row: SparqlRow, entity: string): boolean =>
  row.windowRows !== undefined && row[entity] === undefined;

/** Index a `?p ?o` result set by predicate, keeping every value. */
export function byPredicate(results: SparqlResults): Map<string, SparqlRow[]> {
  const index = new Map<string, SparqlRow[]>();
  for (const row of results.results.bindings) {
    const predicate = text(row.p);
    if (predicate === null) continue;
    const bucket = index.get(predicate);
    if (bucket) bucket.push(row);
    else index.set(predicate, [row]);
  }
  return index;
}

const firstValue = (index: Map<string, SparqlRow[]>, predicate: string): string | null =>
  text(index.get(predicate)?.[0]?.o);

const allValues = (index: Map<string, SparqlRow[]>, predicate: string): string[] => {
  const seen = new Set<string>();
  for (const row of index.get(predicate) ?? []) {
    const value = text(row.o);
    if (value !== null) seen.add(value);
  }
  return [...seen];
};

/** Values that are addresses of vocabulary terms, reduced to the term. */
const allTerms = (index: Map<string, SparqlRow[]>, predicate: string): string[] =>
  allValues(index, predicate)
    .filter((value) => value.startsWith("http"))
    .map(vocabularyTerm);

/**
 * Dewey classes, and nothing else that happens to share the predicate.
 *
 * `dcterms:subject` on a work points at a Dewey class and at subject-heading
 * ARKs alike. Reducing an ARK to its last segment yields the string `about`,
 * which would then be published as a Dewey class and printed beside a real one.
 */
const deweyClasses = (index: Map<string, SparqlRow[]>, predicate: string): string[] =>
  allValues(index, predicate)
    .filter((value) => value.includes("dewey.info/class/"))
    .map(vocabularyTerm);

/** Values that are plain words rather than addresses. */
const allWords = (index: Map<string, SparqlRow[]>, predicate: string): string[] =>
  allValues(index, predicate).filter((value) => !value.startsWith("http"));

/**
 * Alignments to the same thing in other files, grouped by file.
 *
 * `owl:sameAs`, `skos:exactMatch` and `skos:closeMatch` are gathered together
 * because a caller wanting the VIAF address does not care which of the three
 * carried it, and the dataset uses all three for the same alignments. A
 * `closeMatch` is a weaker claim than the other two, and the record makes that
 * distinction nowhere a caller could act on it, so the grouping does not
 * pretend otherwise: the field is named for the addresses it holds.
 */
function alignments(
  index: Map<string, SparqlRow[]>,
  selfId: string | null,
): Record<string, string[]> {
  const found: Record<string, Set<string>> = {};
  for (const predicate of [P.sameAs, P.exactMatch, P.closeMatch, P.seeAlso]) {
    for (const address of allValues(index, predicate)) {
      if (!address.startsWith("http")) continue;
      // An address pointing back at this record says nothing about anywhere
      // else, and the dataset carries several of those per record.
      if (selfId && address.includes(selfId)) continue;
      let host: string;
      try {
        host = new URL(address).hostname.toLowerCase();
      } catch {
        continue;
      }
      const known = ALIGNMENT_HOSTS.find(
        (entry) => host === entry.host || host.endsWith(`.${entry.host}`),
      );
      if (!known) continue;
      const addresses = found[known.name] ?? new Set<string>();
      found[known.name] = addresses;
      addresses.add(address);
    }
  }
  return Object.fromEntries(Object.entries(found).map(([name, set]) => [name, [...set]]));
}

/** ISNI is written as a bare number rather than an address. */
function isniAddresses(index: Map<string, SparqlRow[]>): string[] {
  return allValues(index, P.isni).map(
    (value) => `https://isni.org/isni/${value.replace(/\s/g, "")}`,
  );
}

/** Rows of an author search, with the extra row read as "more exist". */
export function toAuthorSummaries(results: SparqlResults, limit: number): Page<AuthorSummary> {
  const rows: AuthorSummary[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  for (const row of results.results.bindings) {
    if (isOccupancyRow(row, "person")) continue;
    const iri = text(row.person);
    const id = iri === null ? null : idFromIri(iri);
    if (iri === null || id === null) {
      // A row naming no record, or naming one at an address this client cannot
      // read, is a row that was dropped. Counting it is what keeps a short page
      // from reading as a small catalogue.
      skipped += 1;
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push({
      id,
      name: text(row.name),
      label: text(row.label),
      birthYear: integer(row.birthYear),
      deathYear: integer(row.deathYear),
      role: text(row.role),
      sourceUrl: publicPageFor(iri),
    });
  }

  return { ...page(rows, limit, skipped), indexWindowFull: readWindowOccupancy(results) };
}

/** One person, assembled from both halves of their record. */
export function toAuthorDetail(results: SparqlResults, id: string, pageUrl: string): AuthorDetail {
  const index = byPredicate(results);
  const types = allValues(index, P.type);

  const otherNames: Array<{ label: string; language: string | null }> = [];
  const seenLabels = new Set<string>();
  for (const row of index.get(P.altLabel) ?? []) {
    const label = text(row.o);
    if (label === null || seenLabels.has(label)) continue;
    seenLabels.add(label);
    otherNames.push({ label, language: text(row.lang) });
  }

  const sameAs = alignments(index, id);
  const isni = isniAddresses(index);
  if (isni.length > 0) sameAs.isni = [...new Set([...(sameAs.isni ?? []), ...isni])];

  const catalogueUrl =
    allValues(index, P.seeAlso).find((address) => address.includes("catalogue.bnf.fr")) ?? null;

  const depictions: DigitisedLink[] = [];
  for (const address of allValues(index, P.depiction)) {
    const link = toDigitisedLink(address, "depiction", id, null);
    if (link) depictions.push(link);
  }

  return {
    id,
    name: firstValue(index, P.name),
    label: firstValue(index, P.prefLabel),
    givenName: firstValue(index, P.givenName),
    familyName: firstValue(index, P.familyName),
    otherNames,
    birthDate: firstValue(index, P.birth),
    deathDate: firstValue(index, P.death),
    birthYear: integer(index.get(P.firstYear)?.[0]?.o),
    deathYear: integer(index.get(P.lastYear)?.[0]?.o),
    birthPlace: firstValue(index, P.placeOfBirth),
    deathPlace: firstValue(index, P.placeOfDeath),
    biographicalInformation: firstValue(index, P.biographicalInformation),
    occupation: firstValue(index, P.occupation),
    languages: allTerms(index, P.languageOfThePerson),
    countries: allTerms(index, P.countryAssociated),
    fields: allWords(index, P.fieldOfActivity),
    deweyClasses: deweyClasses(index, P.fieldOfActivity),
    sameAs,
    catalogueUrl,
    recordCreated: firstValue(index, P.created),
    recordModified: firstValue(index, P.modified),
    depictions,
    types,
    truncated: results.results.bindings.length >= MOST_TRIPLES,
    sourceUrl: pageUrl,
  };
}

/**
 * How settled a record is.
 *
 * The record states it in words, and the address states it in its shape: a
 * provisional work is addressed under `temp-work` rather than by an ARK. The
 * statement governs when there is one, since a cataloguer can settle a record
 * before it is re-addressed.
 */
export function readStatus(statement: string | null, iri: string): "established" | "provisional" {
  if (statement !== null) {
    const said = statement.toLowerCase();
    if (said.includes("provisional")) return "provisional";
    if (said.includes("established")) return "established";
  }
  return iri.includes("/temp-work/") ? "provisional" : "established";
}

/** Rows of a work search, gathering the creators of each work. */
export function toWorkSummaries(results: SparqlResults, limit: number): Page<WorkSummary> {
  const order: string[] = [];
  const byId = new Map<string, WorkSummary>();

  let skipped = 0;
  for (const row of results.results.bindings) {
    if (isOccupancyRow(row, "work")) continue;
    const iri = text(row.work);
    const id = iri === null ? null : idFromIri(iri);
    if (iri === null || id === null) {
      // A row naming no record, or naming one at an address this client cannot
      // read, is a row that was dropped. Counting it is what keeps a short page
      // from reading as a small catalogue.
      skipped += 1;
      continue;
    }

    let work = byId.get(id);
    if (!work) {
      work = {
        id,
        title: text(row.title),
        date: text(row.date),
        creators: [],
        status: readStatus(text(row.status), iri),
        sourceUrl: publicPageFor(iri),
      };
      byId.set(id, work);
      order.push(id);
    }

    const creatorIri = text(row.creator);
    const creatorId = creatorIri ? idFromIri(creatorIri) : null;
    if (creatorId && !work.creators.some((c) => c.id === creatorId)) {
      work.creators.push({ id: creatorId, name: text(row.creatorName) });
    }
  }

  return {
    ...page(
      order.map((id) => byId.get(id)).filter((one) => one !== undefined),
      limit,
      skipped,
    ),
    indexWindowFull: readWindowOccupancy(results),
  };
}

/**
 * The works one person is credited with, gathered from rows that repeat.
 *
 * A work pointing at two form terms arrives as two rows differing in one
 * column. Counting rows would report two works where the catalogue links one,
 * so the address of the work is what a work is counted by.
 */
export function toAuthoredWorks(results: SparqlResults, limit: number): Page<AuthoredWork> {
  const order: string[] = [];
  const byId = new Map<string, AuthoredWork>();

  let skipped = 0;
  for (const row of results.results.bindings) {
    const iri = text(row.work);
    const id = iri === null ? null : idFromIri(iri);
    if (iri === null || id === null) {
      // A row naming no record, or naming one at an address this client cannot
      // read, is a row that was dropped. Counting it is what keeps a short page
      // from reading as a small catalogue.
      skipped += 1;
      continue;
    }

    let work = byId.get(id);
    if (!work) {
      work = {
        id,
        title: text(row.title),
        date: text(row.date),
        year: integer(row.year),
        forms: [],
        status: readStatus(text(row.status), iri),
        sourceUrl: publicPageFor(iri),
      };
      byId.set(id, work);
      order.push(id);
    }

    const form = text(row.form);
    if (form !== null && form.startsWith("http")) {
      const term = vocabularyTerm(form);
      if (!work.forms.includes(term)) work.forms.push(term);
    }
  }

  return page(
    order.map((id) => byId.get(id)).filter((one) => one !== undefined),
    limit,
    skipped,
  );
}

/** One work, assembled from its record. */
export function toWorkDetail(
  results: SparqlResults,
  id: string,
  iri: string,
  pageUrl: string,
): WorkDetail {
  const index = byPredicate(results);
  const types = allValues(index, P.type);
  const truncated = results.results.bindings.length >= MOST_TRIPLES;

  const creators: Array<{ id: string; name: string | null }> = [];
  for (const row of index.get(P.creator) ?? []) {
    const creatorIri = text(row.o);
    const creatorId = creatorIri ? idFromIri(creatorIri) : null;
    if (!creatorId || creators.some((c) => c.id === creatorId)) continue;
    creators.push({ id: creatorId, name: text(row.name) });
  }

  const depictions: DigitisedLink[] = [];
  for (const address of allValues(index, P.depiction)) {
    const link = toDigitisedLink(address, "depiction", id, null);
    if (link) depictions.push(link);
  }

  const statusStatement = firstValue(index, P.statusOfIdentification);
  const catalogueUrl =
    allValues(index, P.seeAlso).find((address) => address.includes("catalogue.bnf.fr")) ?? null;

  return {
    id,
    title: firstValue(index, P.title),
    label: firstValue(index, P.label),
    date: firstValue(index, P.date),
    firstYear: integer(index.get(P.firstYear)?.[0]?.o),
    creators,
    languages: allTerms(index, P.language),
    forms: allTerms(index, P.formOfWork),
    subjects: allWords(index, P.subjectLabel),
    deweyClasses: deweyClasses(index, P.subject),
    status: readStatus(statusStatement, iri),
    statusStatement,
    // A cut record makes this the ceiling rather than the count, so it is
    // withheld rather than published as a number the record does not support.
    expressionCount: truncated ? null : allValues(index, P.expressionOfWork).length,
    sameAs: alignments(index, id),
    catalogueUrl,
    depictions,
    types,
    truncated,
    sourceUrl: pageUrl,
  };
}

/**
 * Editions, gathered from rows that repeat.
 *
 * One manifestation carrying two digitised copies arrives as two rows differing
 * in one column. Counting rows would report two editions where the record
 * describes one, so the address of the manifestation is what an edition is
 * counted by.
 */
export function toEditions(results: SparqlResults, limit: number): Page<Edition> {
  const order: string[] = [];
  const byId = new Map<string, Edition>();

  let skipped = 0;
  for (const row of results.results.bindings) {
    const iri = text(row.edition);
    const id = iri === null ? null : idFromIri(iri);
    if (iri === null || id === null) {
      // A row naming no record, or naming one at an address this client cannot
      // read, is a row that was dropped. Counting it is what keeps a short page
      // from reading as a small catalogue.
      skipped += 1;
      continue;
    }

    let edition = byId.get(id);
    if (!edition) {
      edition = {
        id,
        title: text(row.title),
        date: text(row.date),
        year: integer(row.year),
        publisher: text(row.publisher),
        place: text(row.place),
        editionStatement: text(row.editionStatement),
        extent: text(row.extent),
        isbn: text(row.isbn),
        note: text(row.note),
        catalogueUrl: text(row.catalogue),
        digitised: [],
        sourceUrl: publicPageFor(iri),
      };
      byId.set(id, edition);
      order.push(id);
    }

    for (const [column, role] of [
      ["reproduction", "reproduction"],
      ["ocr", "ocr"],
    ] as const) {
      const link = toDigitisedLink(text(row[column]), role, id, edition.title);
      if (link && !edition.digitised.some((existing) => existing.url === link.url)) {
        edition.digitised.push(link);
      }
    }
  }

  return page(
    order.map((id) => byId.get(id)).filter((one) => one !== undefined),
    limit,
    skipped,
  );
}

/**
 * Every digitised document a set of rows points at, kept in one list.
 *
 * One document can be reached by several paths, so the same address arrives
 * more than once and is kept once. That makes the length of the list a poor
 * signal of whether more exist: twenty-one rows holding seventeen addresses
 * would otherwise be reported as a page with room to spare. The endpoint was
 * asked for one row beyond the page, so the count of rows is what answers that.
 */
export function toDigitisedLinks(results: SparqlResults, limit: number): Page<DigitisedLink> {
  const links: DigitisedLink[] = [];
  const seen = new Set<string>();
  const rowCount = results.results.bindings.length;

  for (const row of results.results.bindings) {
    const fromIri = text(row.edition);
    const fromId = fromIri ? (idFromIri(fromIri) ?? fromIri) : "";
    const title = text(row.title);

    for (const [column, role] of [
      ["reproduction", "reproduction"],
      ["ocr", "ocr"],
      ["depiction", "depiction"],
    ] as const) {
      const link = toDigitisedLink(text(row[column]), role, fromId, title);
      if (!link || seen.has(link.url)) continue;
      seen.add(link.url);
      links.push(link);
    }
  }

  // `rowCount` counts what the endpoint sent, including rows whose address was
  // not a Gallica one and rows naming a document already listed. Raising the
  // limit after such a page returns the same list, so the claim is confined to
  // the case where the links themselves fill the page.
  return { rows: links.slice(0, limit), hasMore: links.length > limit || rowCount > limit };
}

/** The classes an address is typed with, reduced to their vocabulary terms. */
export function toTypes(results: SparqlResults): string[] {
  const types = new Set<string>();
  for (const row of results.results.bindings) {
    const iri = text(row.type);
    if (iri !== null) types.add(iri);
  }
  return [...types];
}
