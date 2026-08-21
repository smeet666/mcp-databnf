/**
 * How caller text becomes part of a query, and what it can never become.
 *
 * A query is a program, and every character of it that came from outside is a
 * chance to write a different program. Three separate defences apply here, and
 * each is narrower than the one before:
 *
 * 1. Text that reaches the full-text index is reduced to words. Letters,
 *    digits, apostrophes inside a word and hyphens inside a word survive; every
 *    quote, brace, backslash, angle bracket and newline is dropped before the
 *    query exists. There is no escaping to get right because there is nothing
 *    left to escape.
 * 2. An identifier is matched against the two shapes this dataset uses and
 *    rebuilt from the match, so the address in the query is one this file
 *    wrote rather than one a caller supplied.
 * 3. Numbers reach the query as numbers, after being bounded.
 *
 * `escapeLiteral` exists for the values that are neither: it is the last line
 * rather than the first, and the tests hold it to producing a literal that
 * closes where it opened whatever it is handed.
 */

import { invalidInput } from "../errors.js";

/**
 * Escape a string for a SPARQL short literal in double quotes.
 *
 * Backslash goes first: escaping it after the others would escape the
 * backslashes they just introduced. The characters a SPARQL short literal
 * cannot carry raw are a quote, a backslash, a line feed and a carriage
 * return; the rest are legal and pass through as published, since mangling a
 * title is its own kind of lie.
 */
export function escapeLiteral(value: string): string {
  return (
    value
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t")
      // The remaining control characters are legal inside a SPARQL literal and
      // meaningless in a catalogue query. A null byte in particular is where a
      // C string ends, so an intermediary or the engine can truncate the query
      // at one and run a shorter query than the one that was written.
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
  );
}

/** A literal, quoted and escaped, ready to be dropped into a query. */
export const literal = (value: string): string => `"${escapeLiteral(value)}"`;

/**
 * Characters that occupy a position in a string and mark nothing on a screen.
 *
 * The control characters other than the whitespace ones, the zero-width spaces
 * and joiners, the soft hyphen, the bidirectional marks and the byte order
 * mark. A space, a tab and a line break are absent from the list: they are
 * visible as a gap and they do separate two words.
 *
 * They are written as escapes because they would be invisible in this file as
 * well, and a character nobody can see in the source of a guard is a guard
 * nobody can review.
 */
const INVISIBLE =
  /[\u0000-\u0008\u000e-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/gu;

/**
 * The text with the characters that mark nothing removed.
 *
 * A separator is something a person wrote to hold two words apart. One of these
 * holds nothing apart, so treating it as a separator turns one word into two
 * terms the index then requires separately, and a name that matches comes back
 * as a name the catalogue does not hold.
 */
export function withoutInvisibles(input: string): string {
  return input.replace(INVISIBLE, "");
}

/** The characters that marked nothing, listed once each, in the order written. */
export function invisibleCharacters(input: string): string[] {
  const found: string[] = [];
  for (const character of input.match(INVISIBLE) ?? []) {
    if (!found.includes(character)) {
      found.push(character);
    }
  }
  return found;
}

/**
 * The visible characters a search dropped, listed once each.
 *
 * Punctuation reaches no index here, so a caller comparing what they wrote
 * against what was searched for needs to see which marks were left out. A
 * space is not one of them: it separates words and is what the words are cut
 * along.
 */
export function charactersSetAside(input: string): string[] {
  const found: string[] = [];
  for (const character of withoutInvisibles(input).normalize("NFC")) {
    if (/[\p{L}\p{N}'\-\s]/u.test(character) || /[‘’ʼ]/u.test(character)) {
      continue;
    }
    if (!found.includes(character)) {
      found.push(character);
    }
  }
  return found;
}

/** How a piece of caller text became the terms the index was given. */
export interface SearchReading {
  /** The words the text was cut into, each one quoted into the query. */
  words: string[];
  /** The terms the index requires, after it splits inside a word. */
  terms: string[];
  /** The characters that marked nothing and were removed before the cutting. */
  invisible: string[];
  /** The visible characters that reached no term. */
  setAside: string[];
}

/** Read a piece of caller text the way the query builder and the index will. */
export function readSearchText(input: string): SearchReading {
  const words = toSearchWords(input);
  return {
    words,
    terms: toIndexTerms(words),
    invisible: invisibleCharacters(input),
    setAside: charactersSetAside(input),
  };
}

/**
 * Words a full-text query may carry.
 *
 * The endpoint is a Virtuoso, whose `bif:contains` takes its own miniature
 * language: words in single quotes joined by AND, OR and NOT, with `*` for a
 * prefix. Handing caller text to that language directly would let a caller
 * write the operators, so the text is cut into words instead and this file
 * writes every operator.
 *
 * A word keeps letters and digits in any script, and keeps an apostrophe or a
 * hyphen that sits between two other characters, because "aujourd'hui" and
 * "Charleville-Mézières" are one word each. A leading or trailing one is
 * dropped, so nothing can close the quoting this file opens.
 *
 * The same rule holds a span of years together: "1871-1933" stays one word.
 * Nothing here can tell a range from a compound name, and splitting on the
 * chance that it is a range would break every hyphenated place in France.
 */
export function toSearchWords(input: string): string[] {
  const cleaned = withoutInvisibles(input)
    .normalize("NFC")
    // Anything that is not a letter, a digit, an apostrophe or a hyphen becomes
    // a separator. Typographic apostrophes are folded onto the plain one first,
    // since a name is written with either.
    .replace(/[‘’ʼ]/gu, "'")
    .replace(/[^\p{L}\p{N}'-]+/gu, " ");

  const words: string[] = [];
  for (const raw of cleaned.split(" ")) {
    // Trim the joiners at the edges: they only mean something between letters.
    const word = raw.replace(/^['-]+/u, "").replace(/['-]+$/u, "");
    if (word === "") {
      continue;
    }
    // A word this long is a paste rather than a word, and the index will not
    // match it anyway.
    words.push(word.length > 60 ? word.slice(0, 60) : word);
    if (words.length >= 12) {
      break;
    }
  }
  return words;
}

/**
 * The terms the index will require, read off the words a caller wrote.
 *
 * The index tokenises inside a quoted term: an apostrophe and a hyphen are
 * separators there, so `O'Brien` reaches it as two terms and a record written
 * `Pat O Brien` carries both and matches. Reporting the word back as one term
 * would leave a caller checking why a row is on the list with no way of getting
 * there from the fields shown.
 *
 * A piece repeated across words is kept once, since requiring a term twice is
 * requiring it.
 */
export function toIndexTerms(words: readonly string[]): string[] {
  const terms: string[] = [];
  for (const word of words) {
    for (const piece of word.split(/['-]+/u)) {
      if (piece !== "" && !terms.includes(piece)) {
        terms.push(piece);
      }
    }
  }
  return terms;
}

/**
 * A `bif:contains` argument requiring every word, built from words this file
 * quoted.
 *
 * The result is a SPARQL literal, so the double quotes belong to SPARQL and the
 * single quotes belong to the index. Two quotings are therefore in play, and
 * each has to be closed by the layer that opened it.
 *
 * The apostrophe kept inside a word is also the index's own quoting character,
 * so `rimbaud'OR'hugo` arrives as one word and emits `'rimbaud'OR'hugo'`, where
 * `OR` has escaped the quotes and become an operator. Doubling it puts it back
 * inside the term, which is how the index writes a literal quote. That is the
 * whole of the exposure: the word cannot reach the SPARQL layer as anything but
 * text, because `escapeLiteral` runs over the finished clause.
 */
export function containsAllWords(words: readonly string[]): string {
  if (words.length === 0) {
    throw invalidInput(
      "No word to search for: the text held no letters or digits.",
      "Write the words to look for, such as a surname or a title.",
    );
  }
  const clause = words.map((word) => `'${word.replace(/'/g, "''")}'`).join(" AND ");
  return literal(clause);
}

/**
 * The two identifier shapes this dataset uses, and nothing else.
 *
 * An ARK identifier is `cb` followed by digits and one final check character,
 * which the BnF also writes as `cc…` on a few records. A provisional work is
 * named by a thirty-two character hexadecimal digest. Both are matched whole,
 * so an identifier reaches a query only after this file has rebuilt it.
 */
const ARK_ID = /^c[bc][0-9a-z]{6,20}$/;
const TEMP_WORK_ID = /^[0-9a-f]{32}$/;

export type EntityKind = "ark" | "temp-work";

export interface EntityId {
  kind: EntityKind;
  /** The bare identifier, as a person would quote it. */
  id: string;
  /** The address of the thing itself, which the queries bind to. */
  iri: string;
  /** The page a person can open. */
  pageUrl: string;
}

/**
 * Read an identifier a caller wrote, in any of the forms they see.
 *
 * Rows carry `http://data.bnf.fr/ark:/12148/cb119219976#about`, prose carries
 * `cb119219976`, and a browser carries `https://data.bnf.fr/ark:/12148/cb119219976`.
 * All three name one record. Anything else is refused rather than guessed at,
 * because an identifier built from a guess sends the next call to a record that
 * does not exist and the answer reads as an absence.
 */
export function parseEntityId(input: string): EntityId {
  const trimmed = input.trim();
  if (trimmed === "") {
    throw invalidInput("An identifier is required.");
  }

  const arkMatch = /(?:^|\/)ark:\/12148\/(c[bc][0-9a-z]+)/i.exec(trimmed);
  const bare = arkMatch ? arkMatch[1] : trimmed.replace(/^#/, "").split(/[#?]/)[0];
  const candidate = (bare ?? "").toLowerCase();

  if (ARK_ID.test(candidate)) {
    return {
      kind: "ark",
      id: candidate,
      iri: `http://data.bnf.fr/ark:/12148/${candidate}#about`,
      pageUrl: `https://data.bnf.fr/ark:/12148/${candidate}`,
    };
  }

  const tempMatch = /temp-work\/([0-9a-f]{32})/i.exec(trimmed);
  const digest = (tempMatch?.[1] ?? candidate).toLowerCase();
  if (TEMP_WORK_ID.test(digest)) {
    return {
      kind: "temp-work",
      id: `temp-work/${digest}`,
      iri: `http://data.bnf.fr/temp-work/${digest}/#about`,
      pageUrl: `https://data.bnf.fr/temp-work/${digest}/`,
    };
  }

  throw invalidInput(`"${input}" is not a data.bnf.fr identifier.`, hintFor(trimmed));
}

/**
 * Two shapes people paste, which are addresses of something else entirely.
 *
 * A Gallica document identifier and a data.bnf.fr page address both look like
 * identifiers to whoever is holding one, and both are refused here. Refusing
 * them with the general advice reads as the server failing to know a record it
 * plainly has, so each is named for what it is and told what to do instead.
 */
const GALLICA_DOCUMENT = /^(?:bpt6k|btv1b|bd6t|cb32|btv1b)[0-9a-z]+$/i;
/** `https://data.bnf.fr/fr/11907966/marguerite_duras/`, which is what a browser shows. */
const PAGE_ADDRESS = /data\.bnf\.fr\/(?:[a-z]{2}\/)?(\d{6,12})\/([a-z0-9_]+)/i;

const GENERAL_HINT =
  "An identifier looks like 'cb119219976' for an established record, or 'temp-work/22d7f68c1a4bdd081ad7ca791fd3b730' for a provisional one. Take it from a search result rather than building one.";

function hintFor(input: string): string {
  const page = PAGE_ADDRESS.exec(input);
  if (page) {
    const name = (page[2] ?? "").replace(/_/g, " ");
    return (
      `That is the readable address of a data.bnf.fr page, and ${page[1]} in it is the record's FRBNF number rather than the identifier these tools take. ` +
      `Search for "${name}" with search_authors or search_works, and use the identifier the row carries.`
    );
  }

  const gallicaArk = /ark:\/12148\/([0-9a-z]+)/i.exec(input)?.[1] ?? input;
  if (GALLICA_DOCUMENT.test(gallicaArk)) {
    return (
      "That is a Gallica identifier: it names a digitised document rather than a record in the catalogue, and these tools read the catalogue. " +
      "Search for the work with search_works, then list_editions will give you the Gallica link alongside the edition it belongs to."
    );
  }

  return GENERAL_HINT;
}

/** An identifier written back as the address of the entity itself. */
export const iriOf = (id: EntityId): string => `<${id.iri}>`;

/**
 * A whole number, bounded, written into a query.
 *
 * LIMIT and OFFSET take a bare number rather than a quoted value, so this is
 * the one place where something that is not a literal is assembled. Bounding
 * before writing is what makes that safe, and it also keeps a caller from
 * asking the endpoint for a page a hundred thousand rows deep.
 */
export function boundedInteger(value: number, min: number, max: number, name: string): number {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw invalidInput(`'${name}' has to be a whole number.`);
  }
  if (value < min || value > max) {
    throw invalidInput(`'${name}' has to be between ${min} and ${max}.`);
  }
  return value;
}
