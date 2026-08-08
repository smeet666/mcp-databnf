/** The shapes the access layer produces. Nothing here knows about MCP. */

/**
 * A link to a digitised document held on Gallica.
 *
 * This server describes the link and never opens it. `url` is for a person to
 * follow, and nothing downstream reports what is behind it.
 */
export interface DigitisedLink {
  /** The Gallica ARK, as it identifies the document. */
  ark: string;
  /** The address to open, exactly as data.bnf.fr publishes it. */
  url: string;
  /**
   * Which statement attached this link to the record.
   *
   * `reproduction` is the digitised copy of the edition itself.
   * `ocr` is the text a machine read off that copy.
   * `depiction` is an image data.bnf.fr uses to illustrate the record, which
   * can be a portrait, a title page, or a page of a newspaper that mentions the
   * subject: it illustrates, and it does not stand for the work.
   */
  role: "reproduction" | "ocr" | "depiction";
  /** Which record carried it, so a caller can say where a link came from. */
  fromId: string;
  fromTitle: string | null;
}

/** One row of an author search. */
export interface AuthorSummary {
  /** The identifier get_author takes. */
  id: string;
  /** The name as data.bnf.fr writes it on the person. */
  name: string | null;
  /** The heading as the authority file writes it, usually with the dates. */
  label: string | null;
  birthYear: number | null;
  deathYear: number | null;
  /** What the record says the person did, often a single word. */
  role: string | null;
  sourceUrl: string;
}

/** One person, read in full. */
export interface AuthorDetail {
  id: string;
  name: string | null;
  label: string | null;
  givenName: string | null;
  familyName: string | null;
  /** Other headings the record carries, each with the language it is written in. */
  otherNames: Array<{ label: string; language: string | null }>;
  birthDate: string | null;
  deathDate: string | null;
  birthYear: number | null;
  deathYear: number | null;
  birthPlace: string | null;
  deathPlace: string | null;
  /**
   * What the record states about the person, which is a job title far more
   * often than a sentence.
   */
  biographicalInformation: string | null;
  /** The occupation the record names. */
  occupation: string | null;
  /** Languages, as ISO 639-2 codes the record points at. */
  languages: string[];
  /** Countries, as the codes the record points at. */
  countries: string[];
  /** Fields of activity in words, as the record writes them. */
  fields: string[];
  /** Dewey classes the fields of activity point at, as `800` rather than a URL. */
  deweyClasses: string[];
  /** Addresses for the same person in other files, grouped by the file. */
  sameAs: Record<string, string[]>;
  /** The classes the record is typed with, which say what kind of thing it is. */
  types: string[];
  /** True when the record was longer than one query reads, so parts are missing. */
  truncated: boolean;
  /** The record in the BnF general catalogue. */
  catalogueUrl: string | null;
  /** When the authority record was created and last changed, as published. */
  recordCreated: string | null;
  recordModified: string | null;
  /** Images data.bnf.fr attaches to the person, as links. */
  depictions: DigitisedLink[];
  sourceUrl: string;
}

/** One row of a work search. */
export interface WorkSummary {
  id: string;
  title: string | null;
  /** The year the record gives the work, as published. */
  date: string | null;
  /** Everyone the record credits with the work. */
  creators: Array<{ id: string; name: string | null }>;
  /**
   * Whether the BnF has established this work as a record of its own, or holds
   * it provisionally while a cataloguer settles it.
   */
  status: "established" | "provisional";
  sourceUrl: string;
}

/** One work, read in full. */
export interface WorkDetail {
  id: string;
  title: string | null;
  /** The label the record carries, which can differ from the title in case. */
  label: string | null;
  date: string | null;
  firstYear: number | null;
  creators: Array<{ id: string; name: string | null }>;
  /** Languages of the work, as the codes the record points at. */
  languages: string[];
  /** Forms, as the words the BnF vocabulary uses. */
  forms: string[];
  /** Subjects in words. */
  subjects: string[];
  /** Dewey classes the subjects point at. */
  deweyClasses: string[];
  status: "established" | "provisional";
  /** What the record itself says about how settled it is. */
  statusStatement: string | null;
  /**
   * How many expressions the record links, which is not a count of editions.
   * Null when the record was longer than one query reads, since the number
   * would then be the ceiling rather than the count.
   */
  expressionCount: number | null;
  sameAs: Record<string, string[]>;
  /** The classes the record is typed with, which say what kind of thing it is. */
  types: string[];
  /** True when the record was longer than one query reads, so parts are missing. */
  truncated: boolean;
  catalogueUrl: string | null;
  depictions: DigitisedLink[];
  sourceUrl: string;
}

/** One published edition of a work. */
export interface Edition {
  id: string;
  title: string | null;
  /** The date as published, which can be a phrase such as `[s.d.]`. */
  date: string | null;
  year: number | null;
  publisher: string | null;
  place: string | null;
  /** The edition statement, when the record carries one. */
  editionStatement: string | null;
  /** The extent, in the words of the record: pages, volumes, discs. */
  extent: string | null;
  isbn: string | null;
  /** Notes the cataloguer wrote, as published. */
  note: string | null;
  /** The record in the BnF general catalogue. */
  catalogueUrl: string | null;
  /** Digitised copies of this edition, as links this server does not open. */
  digitised: DigitisedLink[];
  sourceUrl: string;
}

/** A page of rows, and whether the endpoint held more. */
export interface Page<T> {
  rows: T[];
  /**
   * True when the endpoint answered with at least one row beyond the page.
   *
   * The tools report this rather than a total: counting every match means a
   * second query over the same span, and a count would read as a ranking on a
   * search that does not rank.
   */
  hasMore: boolean;
  /** Rows the endpoint sent that could not be read, present only when some were. */
  skipped?: number;
}
