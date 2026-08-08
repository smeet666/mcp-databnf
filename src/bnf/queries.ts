/**
 * The queries this server sends, and the reasons they are shaped as they are.
 *
 * Every one of them describes the endpoint as it actually answers: the shapes
 * below are the ones the live service returns, rather than the ones the
 * vocabularies promise.
 *
 * Three facts about this dataset govern most of what follows.
 *
 * **An entity and its record are two addresses.** A person is
 * `ark:/12148/cb119219976#about`, typed `foaf:Person`, and carries the dates,
 * the places and the alignments. The authority record is the same ARK without
 * the fragment, typed `skos:Concept`, and carries the headings, the editorial
 * notes and the date the record was last changed. A query that reads only one
 * of the two misses half the record.
 *
 * **Work, expression and manifestation are three levels.** A work links to
 * expressions, and a manifestation names both the expression it realises and
 * the work it manifests. `workManifested` is what makes the editions of a work
 * reachable in one step rather than two.
 *
 * **The full-text index drives, or the query is abandoned.** Virtuoso needs the
 * triple whose object it will search to appear before `bif:contains` in the same
 * group, and it needs that pattern to be the one that starts the plan. Asking
 * for `?w a rdafrbr:Work` first makes the planner walk every work in the
 * catalogue and the service gives the query up, answering 200 with an empty
 * body. Putting the text search in a subquery and filtering its output is what
 * keeps the index in front.
 */

import { PREFIX_BLOCK } from "./endpoint.js";
import type { EntityId } from "./sparql.js";
import { boundedInteger, containsAllWords, iriOf, literal } from "./sparql.js";

/**
 * How many rows a text search reads from the index before filtering.
 *
 * `bif:contains` answers in index order, which is not an order of relevance, so
 * a window that is too small leaves out the record a caller meant. A window this
 * size costs the service one pass and gives the filter enough to work with.
 *
 * It is also the end of what a text search can page through. An offset past it
 * lands beyond what was ever read, and the answer would be an empty page that
 * looks exactly like the catalogue holding nothing. The tools refuse such a page
 * rather than buying the query, which is why this is exported.
 */
export const TEXT_WINDOW = 400;

const prefixed = (body: string): string => `${PREFIX_BLOCK}\n${body.trim()}\n`;

/**
 * People whose name carries every word given.
 *
 * The name is searched rather than the authority heading, because a heading
 * carries the dates and a caller writing "Arthur Rimbaud 1854" would otherwise
 * match on the year. Both are returned, so an answer can show which of several
 * people bearing one name is which.
 *
 * `limit + 1` rows are asked for. The extra row is never shown; it is how the
 * answer can say that more exist without a second query counting them.
 */
export function searchAuthorsQuery(
  words: readonly string[],
  limit: number,
  offset: number,
): string {
  const take = boundedInteger(limit, 1, 50, "limit") + 1;
  const skip = boundedInteger(offset, 0, 5000, "offset");

  // The page is cut in the middle subquery, over people rather than over rows,
  // and the cutting projection names the person alone. Selecting the name
  // alongside would give a person recorded under two names two of the page's
  // slots; the parser then folds them back into one row, and a page of ten
  // comes back holding eight.
  return prefixed(`
SELECT ?person ?name ?label ?birthYear ?deathYear ?role WHERE {
  {
    SELECT DISTINCT ?person WHERE {
      {
        SELECT DISTINCT ?person ?name WHERE {
          ?person foaf:name ?name .
          ?name bif:contains ${containsAllWords(words)} .
        }
        LIMIT ${TEXT_WINDOW}
      }
      ?person a foaf:Person .
    }
    ORDER BY ?person
    LIMIT ${take} OFFSET ${skip}
  }
  OPTIONAL { ?person foaf:name ?name }
  OPTIONAL { ?record foaf:focus ?person ; skos:prefLabel ?label }
  OPTIONAL { ?person bnf:firstYear ?birthYear }
  OPTIONAL { ?person bnf:lastYear ?deathYear }
  OPTIONAL { ?person rdag2:biographicalInformation ?role }
}`);
}

/**
 * The most triples one record's detail query will read.
 *
 * A record that hits this ceiling has been cut, and a cut record renders as a
 * record whose missing statements are absences. The parsers compare the row
 * count against it and say so rather than reporting the silence as fact.
 */
export const MOST_TRIPLES = 2000;

/**
 * Everything both halves of one person's record carry.
 *
 * The two subjects are read in one query through a UNION rather than in two
 * requests: the spacing between requests is the cost that matters here, and one
 * person is one question.
 */
export function authorQuery(id: EntityId): string {
  const person = iriOf(id);
  return prefixed(`
SELECT ?p ?o ?lang WHERE {
  {
    ${person} ?p ?o .
    BIND(LANG(?o) AS ?lang)
  }
  UNION
  {
    ?record foaf:focus ${person} ; ?p ?o .
    BIND(LANG(?o) AS ?lang)
  }
}
LIMIT ${MOST_TRIPLES}`);
}

/**
 * Works whose title carries every word given.
 *
 * Both established works and provisional ones are returned, and the row says
 * which is which: leaving the provisional ones out would hide the only record
 * the BnF holds for a great many recent books, and mixing them in silently
 * would let a provisional record be quoted as an established one.
 */
export function searchWorksQuery(words: readonly string[], limit: number, offset: number): string {
  const take = boundedInteger(limit, 1, 50, "limit") + 1;
  const skip = boundedInteger(offset, 0, 5000, "offset");

  // As with people, the page is cut over works rather than over rows, on the
  // work alone: a work with three authors occupies three rows, and a work
  // recorded under two titles would take two of the page's slots.
  return prefixed(`
SELECT ?work ?title ?date ?status ?creator ?creatorName WHERE {
  {
    SELECT DISTINCT ?work WHERE {
      {
        SELECT DISTINCT ?work ?title WHERE {
          ?work dcterms:title ?title .
          ?title bif:contains ${containsAllWords(words)} .
        }
        LIMIT ${TEXT_WINDOW}
      }
      ?work a rdafrbr:Work .
    }
    ORDER BY ?work
    LIMIT ${take} OFFSET ${skip}
  }
  OPTIONAL { ?work dcterms:title ?title }
  OPTIONAL { ?work dcterms:date ?date }
  OPTIONAL { ?work rdae:statusOfIdentification ?status }
  OPTIONAL {
    ?work dcterms:creator ?creator .
    OPTIONAL { ?creator foaf:name ?creatorName }
  }
}`);
}

/** Everything one work's record carries, with the names of its creators. */
export function workQuery(id: EntityId): string {
  const work = iriOf(id);
  return prefixed(`
SELECT ?p ?o ?lang ?name WHERE {
  ${work} ?p ?o .
  BIND(LANG(?o) AS ?lang)
  OPTIONAL { ?o foaf:name ?name }
}
LIMIT ${MOST_TRIPLES}`);
}

/**
 * The published editions of one work.
 *
 * A manifestation naming the same work twice, or carrying two digitised copies,
 * comes back as several rows describing one edition. The parser groups them,
 * which is why the manifestation's own address is selected first.
 */
export function editionsQuery(id: EntityId, limit: number, offset: number): string {
  const work = iriOf(id);
  const take = boundedInteger(limit, 1, 50, "limit") + 1;
  const skip = boundedInteger(offset, 0, 5000, "offset");

  return prefixed(`
SELECT ?edition ?title ?date ?year ?publisher ?place ?editionStatement
       ?extent ?isbn ?note ?catalogue ?reproduction ?ocr WHERE {
  {
    SELECT DISTINCT ?edition WHERE {
      ?edition rdarel:workManifested ${work} .
    }
    ORDER BY ?edition
    LIMIT ${take} OFFSET ${skip}
  }
  OPTIONAL { ?edition dcterms:title ?title }
  OPTIONAL { ?edition dcterms:date ?date }
  OPTIONAL { ?edition bnf:firstYear ?year }
  OPTIONAL { ?edition rdae:publishersName ?publisher }
  OPTIONAL { ?edition rdae:placeOfPublication ?place }
  OPTIONAL { ?edition rdae:editionStatement ?editionStatement }
  OPTIONAL { ?edition dcterms:description ?extent }
  OPTIONAL { ?edition bnf:isbn ?isbn }
  OPTIONAL { ?edition rdae:note ?note }
  OPTIONAL { ?edition rdfs:seeAlso ?catalogue }
  OPTIONAL { ?edition rdarel:electronicReproduction ?reproduction }
  OPTIONAL { ?edition bnf:OCR ?ocr }
}`);
}

/**
 * Every digitised document one work's editions point at.
 *
 * Held apart from the edition listing because the two answer different
 * questions: one asks what was published, the other asks what can be opened.
 */
export function digitisedForWorkQuery(id: EntityId, limit: number): string {
  const work = iriOf(id);
  const take = boundedInteger(limit, 1, 200, "limit") + 1;

  return prefixed(`
SELECT DISTINCT ?rank ?edition ?title ?reproduction ?ocr ?depiction WHERE {
  {
    ?edition rdarel:workManifested ${work} .
    OPTIONAL { ?edition dcterms:title ?title }
    { ?edition rdarel:electronicReproduction ?reproduction }
    UNION
    { ?edition bnf:OCR ?ocr }
    BIND(0 AS ?rank)
  }
  UNION
  {
    ${work} foaf:depiction ?depiction .
    BIND(${work} AS ?edition)
    BIND(1 AS ?rank)
  }
}
ORDER BY ?rank
LIMIT ${take}`);
}

/**
 * Every digitised document attached to one person.
 *
 * Two paths lead there and they mean different things. `foaf:depiction` hangs
 * off the person and illustrates them. A reproduction hangs off an edition of a
 * work they are credited with, and is that edition digitised. The parser keeps
 * the two apart, and the answer says which is which.
 *
 * Reproductions are ordered first because a well-known person carries dozens of
 * illustrations, and a page filled with those would answer "what of this author
 * can be read" with a list of pictures of him.
 */
export function digitisedForPersonQuery(id: EntityId, limit: number): string {
  const person = iriOf(id);
  const take = boundedInteger(limit, 1, 200, "limit") + 1;

  return prefixed(`
SELECT DISTINCT ?rank ?edition ?title ?reproduction ?ocr ?depiction WHERE {
  {
    ?work dcterms:creator ${person} .
    ?edition rdarel:workManifested ?work .
    OPTIONAL { ?edition dcterms:title ?title }
    { ?edition rdarel:electronicReproduction ?reproduction }
    UNION
    { ?edition bnf:OCR ?ocr }
    BIND(0 AS ?rank)
  }
  UNION
  {
    ${person} foaf:depiction ?depiction .
    BIND(${person} AS ?edition)
    BIND(1 AS ?rank)
  }
}
ORDER BY ?rank
LIMIT ${take}`);
}

/**
 * Whether one address is described at all, and what it is.
 *
 * Asked when a lookup came back with nothing, so an answer can tell "the BnF
 * describes no such record" from "that record exists and is not a person".
 */
export function kindQuery(id: EntityId): string {
  return prefixed(`
SELECT DISTINCT ?type WHERE {
  ${iriOf(id)} a ?type .
}
LIMIT 20`);
}

/**
 * A query written for the live suite alone, naming one record by its label.
 *
 * It exists so the canary exercises `literal` against text a person typed,
 * rather than only against words the tokeniser produced.
 */
export function labelProbeQuery(label: string): string {
  return prefixed(`
SELECT ?person WHERE {
  ?person foaf:name ${literal(label)} .
}
LIMIT 3`);
}
