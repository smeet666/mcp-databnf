#!/usr/bin/env node
/**
 * Writes the SPARQL result sets the unit tests read.
 *
 * The records are invented. Nothing the BnF published lives in this repository:
 * the tests are about the shapes a result set takes and about what this server
 * is allowed to say when it sees one, and inventing the rows makes both
 * reproducible without storing somebody else's catalogue.
 *
 * The shapes themselves come from the live endpoint, so a fixture here is a
 * faithful mould of a real answer holding fictional contents. Where a real answer has an awkward property, the fixture
 * keeps it: a person carrying two authority records, a manifestation repeated
 * across rows because it holds two digitised copies, a work whose title matches
 * a search while the work a reader wanted sits further down.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "test", "fixtures");
mkdirSync(out, { recursive: true });

const uri = (value) => ({ type: "uri", value });
const lit = (value, lang) =>
  lang ? { type: "literal", value, "xml:lang": lang } : { type: "literal", value };
const int = (value) => ({
  type: "typed-literal",
  datatype: "http://www.w3.org/2001/XMLSchema#integer",
  value: String(value),
});

const results = (vars, bindings) => ({
  head: { link: [], vars },
  results: { distinct: false, ordered: true, bindings },
});

/**
 * The row a text search carries its window occupancy on.
 *
 * The endpoint answers a search with the rows of the page and one row of its
 * own holding nothing but the number of rows the index window returned before
 * the type filter ran. It binds no entity, so a fixture places it alongside the
 * page rows exactly as the service sends it.
 */
const windowRows = (count) => ({ windowRows: int(count) });

const ark = (id) => `http://data.bnf.fr/ark:/12148/${id}`;
const person = (id) => uri(`${ark(id)}#about`);
const work = (id) => uri(`${ark(id)}#about`);
const temp = (digest) => uri(`http://data.bnf.fr/temp-work/${digest}/#about`);
const gallica = (name) => uri(`https://gallica.bnf.fr/ark:/12148/${name}`);

const write = (name, value) => {
  writeFileSync(join(out, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
  console.log(`wrote ${name}.json`);
};

/* ── Two people sharing a name, which is the case search_authors exists for ── */

write(
  "authors-search",
  results(
    ["person", "name", "label", "birthYear", "deathYear", "role", "windowRows"],
    [
      {
        person: person("cb100000001"),
        name: lit("Camille Ardouin"),
        label: lit("Camille Ardouin (1871-1933)", "fr"),
        birthYear: int(1871),
        deathYear: int(1933),
        role: lit("Poète"),
      },
      // The same person under a second authority record: no dates, no role.
      {
        person: person("cb100000002"),
        name: lit("Camille Ardouin"),
      },
      // A different person entirely, who happens to share the surname.
      {
        person: person("cb100000003"),
        name: lit("Hortense Ardouin"),
        label: lit("Hortense Ardouin (1902-1988)", "fr"),
        birthYear: int(1902),
        deathYear: int(1988),
        role: lit("Botaniste"),
      },
      // A window with room to spare: everything the index matched was read.
      windowRows(3),
    ],
  ),
);

/**
 * A search whose index window came back full.
 *
 * The page holds every row it was asked for and the endpoint sent no row
 * beyond it, so the page alone reads as the end of the matches. The window
 * says otherwise: it was filled, and the index holds names the search never
 * reached.
 */
write(
  "authors-search-saturated",
  results(
    ["person", "name", "label", "birthYear", "deathYear", "role", "windowRows"],
    [
      { person: person("cb100000031"), name: lit("Marie Aveline") },
      { person: person("cb100000032"), name: lit("Marie Bonneval") },
      windowRows(400),
    ],
  ),
);

/**
 * A full window from which the type filter kept nothing.
 *
 * The window was filled by records of another kind, so no person survived it.
 * A page of no rows here is a statement about the window rather than about the
 * authority file.
 */
write(
  "authors-search-saturated-empty",
  results(["person", "name", "windowRows"], [windowRows(400)]),
);

/**
 * A record whose heading and whose dated fields disagree.
 *
 * A cataloguer corrected one side and left the other, so the brackets of the
 * heading state one year of birth and `bnf-onto:firstYear` states another. The
 * shape is the live one: both are published, and nothing on the record says
 * which was meant.
 */
write(
  "authors-year-conflict",
  results(
    ["person", "name", "label", "birthYear", "deathYear", "role"],
    [
      {
        person: person("cb100000007"),
        name: lit("Aurélien Boix"),
        label: lit("Aurélien Boix (1852-19..)", "fr"),
        birthYear: int(1825),
        role: lit("Médecin"),
      },
    ],
  ),
);

/** The same disagreement on the record read in full. */
write(
  "author-year-conflict",
  results(
    ["p", "o", "lang"],
    [
      {
        p: uri("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
        o: uri("http://xmlns.com/foaf/0.1/Person"),
      },
      { p: uri("http://xmlns.com/foaf/0.1/name"), o: lit("Aurélien Boix") },
      { p: uri("http://vocab.org/bio/0.1/birth"), o: lit("1825-07-12") },
      { p: uri("http://vocab.org/bio/0.1/death"), o: lit("19..") },
      { p: uri("http://data.bnf.fr/ontology/bnf-onto/firstYear"), o: int(1825) },
      {
        p: uri("http://www.w3.org/2004/02/skos/core#prefLabel"),
        o: lit("Aurélien Boix (1852-19..)", "fr"),
        lang: lit("fr"),
      },
      {
        p: uri("http://www.w3.org/2004/02/skos/core#altLabel"),
        o: lit("Aurélien-Charles-Marie Boix (1852-19..)", "fr"),
        lang: lit("fr"),
      },
    ],
  ),
);

/** A page asked for two rows, answered with three: the third says more exist. */
write(
  "authors-search-overflow",
  results(
    ["person", "name"],
    [
      { person: person("cb100000001"), name: lit("Camille Ardouin") },
      { person: person("cb100000002"), name: lit("Camille Ardouin") },
      { person: person("cb100000003"), name: lit("Hortense Ardouin") },
    ],
  ),
);

write("empty", results(["person"], []));

/* ── One person, read from both halves of the record ── */

write(
  "author-detail",
  results(
    ["p", "o", "lang"],
    [
      {
        p: uri("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
        o: uri("http://xmlns.com/foaf/0.1/Person"),
      },
      { p: uri("http://xmlns.com/foaf/0.1/name"), o: lit("Camille Ardouin") },
      { p: uri("http://xmlns.com/foaf/0.1/givenName"), o: lit("Camille") },
      { p: uri("http://xmlns.com/foaf/0.1/familyName"), o: lit("Ardouin") },
      { p: uri("http://vocab.org/bio/0.1/birth"), o: lit("1871-03-04") },
      { p: uri("http://vocab.org/bio/0.1/death"), o: lit("1933-09-19") },
      { p: uri("http://data.bnf.fr/ontology/bnf-onto/firstYear"), o: int(1871) },
      { p: uri("http://data.bnf.fr/ontology/bnf-onto/lastYear"), o: int(1933) },
      {
        p: uri("http://rdvocab.info/ElementsGr2/placeOfBirth"),
        o: lit("Availles-en-Ombre (Vienne)"),
      },
      { p: uri("http://rdvocab.info/ElementsGr2/placeOfDeath"), o: lit("Marsanne (Drôme)") },
      // One word, which is what this field usually holds.
      { p: uri("http://rdvocab.info/ElementsGr2/biographicalInformation"), o: lit("Poète") },
      { p: uri("http://rdaregistry.info/Elements/a/#P50113"), o: lit("Poète") },
      {
        p: uri("http://rdvocab.info/ElementsGr2/languageOfThePerson"),
        o: uri("http://id.loc.gov/vocabulary/iso639-2/fre"),
      },
      {
        p: uri("http://rdvocab.info/ElementsGr2/countryAssociatedWithThePerson"),
        o: uri("http://id.loc.gov/vocabulary/countries/fr"),
      },
      {
        p: uri("http://rdvocab.info/ElementsGr2/fieldOfActivityOfThePerson"),
        o: uri("http://dewey.info/class/800/"),
      },
      {
        p: uri("http://rdvocab.info/ElementsGr2/fieldOfActivityOfThePerson"),
        o: lit("Littératures"),
      },
      { p: uri("http://www.w3.org/2002/07/owl#sameAs"), o: uri("http://viaf.org/viaf/900000001") },
      {
        p: uri("http://www.w3.org/2002/07/owl#sameAs"),
        o: uri("http://www.idref.fr/090000001/id"),
      },
      {
        p: uri("http://www.w3.org/2002/07/owl#sameAs"),
        o: uri("http://fr.dbpedia.org/resource/Camille_Ardouin"),
      },
      // An address whose path carries an accent and a bracket, which reach it
      // percent-encoded. It is what a caller opens, so every character of it
      // has to survive the answer untouched.
      {
        p: uri("http://www.w3.org/2000/01/rdf-schema#seeAlso"),
        o: uri("http://fr.wikipedia.org/wiki/Camille_Ardouin_%28po%C3%A8te%29"),
      },
      // An alignment pointing back at the record itself, which says nothing.
      {
        p: uri("http://www.w3.org/2002/07/owl#sameAs"),
        o: uri(`${ark("cb100000001")}#foaf:Person`),
      },
      {
        p: uri("http://www.w3.org/2004/02/skos/core#exactMatch"),
        o: uri("http://wikidata.org/entity/Q90000001"),
      },
      { p: uri("http://isni.org/ontology#identifierValid"), o: lit("0000000100000001") },
      { p: uri("http://xmlns.com/foaf/0.1/depiction"), o: gallica("btv1b90000001.thumbnail") },
      {
        p: uri("http://xmlns.com/foaf/0.1/depiction"),
        o: gallica("btv1b90000002/f3.item.thumbnail"),
      },
      // An illustration held somewhere other than Gallica, which is not a link
      // to a digitised BnF document and must not arrive labelled as one.
      {
        p: uri("http://xmlns.com/foaf/0.1/depiction"),
        o: uri("http://commons.wikimedia.org/wiki/Special:FilePath/Ardouin.png"),
      },
      {
        p: uri("http://www.w3.org/2004/02/skos/core#prefLabel"),
        o: lit("Camille Ardouin (1871-1933)", "fr"),
        lang: lit("fr"),
      },
      {
        p: uri("http://www.w3.org/2004/02/skos/core#altLabel"),
        o: lit("Camille Ardouin de Marsanne (1871-1933)", "fr"),
        lang: lit("fr"),
      },
      {
        p: uri("http://www.w3.org/2004/02/skos/core#altLabel"),
        o: lit("Kamiru Arudouan (1871-1933)", "ja"),
        lang: lit("ja"),
      },
      { p: uri("http://purl.org/dc/terms/created"), o: lit("1979-04-11") },
      { p: uri("http://purl.org/dc/terms/modified"), o: lit("2023-11-02") },
      {
        p: uri("http://www.w3.org/2000/01/rdf-schema#seeAlso"),
        o: uri("https://catalogue.bnf.fr/ark:/12148/cb100000001"),
      },
    ],
  ),
);

/** A living person: no date of death, which is not the same as a zero. */
write(
  "author-living",
  results(
    ["p", "o", "lang"],
    [
      {
        p: uri("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
        o: uri("http://xmlns.com/foaf/0.1/Person"),
      },
      { p: uri("http://xmlns.com/foaf/0.1/name"), o: lit("Sidonie Verbeke") },
      { p: uri("http://data.bnf.fr/ontology/bnf-onto/firstYear"), o: int(1964) },
      { p: uri("http://vocab.org/bio/0.1/birth"), o: lit("1964-07-02") },
    ],
  ),
);

/**
 * An authority record carrying a name and nothing else.
 *
 * The BnF opens a heading for a name it met on a document and keeps it beside
 * the fuller record for the same person. Such a record dates the person
 * nowhere: it states no birth, no death, no occupation, and the fuller record
 * is where the dates live. The shape is the live one, at fourteen triples.
 */
write(
  "author-name-only",
  results(
    ["p", "o", "lang"],
    [
      {
        p: uri("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
        o: uri("http://xmlns.com/foaf/0.1/Person"),
      },
      { p: uri("http://xmlns.com/foaf/0.1/name"), o: lit("Pierre Fontenay") },
      {
        p: uri("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
        o: uri("http://www.w3.org/2004/02/skos/core#Concept"),
      },
      {
        p: uri("http://www.w3.org/2004/02/skos/core#prefLabel"),
        o: lit("Pierre Fontenay", "fr"),
        lang: lit("fr"),
      },
    ],
  ),
);

/** What the endpoint answers for an address it describes as something else. */
write("types-person", results(["type"], [{ type: uri("http://xmlns.com/foaf/0.1/Person") }]));
write(
  "types-work",
  results(
    ["type"],
    [
      { type: uri("http://rdvocab.info/uri/schema/FRBRentitiesRDA/Work") },
      { type: uri("http://rdaregistry.info/Elements/c/#C10001") },
    ],
  ),
);
write("types-empty", results(["type"], []));

/* ── Works, established and provisional ── */

write(
  "works-search",
  results(
    ["work", "title", "date", "status", "creator", "creatorName", "windowRows"],
    [
      // A study of the poem, which matches the same words as the poem itself.
      {
        work: temp("a1b2c3d4e5f60718293a4b5c6d7e8f90"),
        title: lit("Lire « Le vent d'octobre » de Camille Ardouin", "fr"),
        date: lit("1994"),
        status: lit("provisional", "en"),
        creator: person("cb100000009"),
        creatorName: lit("Bertrand Kessel"),
      },
      // The poem, further down the list, which is the whole point.
      {
        work: work("cb100000010"),
        title: lit("Le vent d'octobre", "fr"),
        date: lit("1902"),
        status: lit("fully established", "en"),
        creator: person("cb100000001"),
        creatorName: lit("Camille Ardouin"),
      },
      // The same work again, carrying a second creator: one work, two rows.
      {
        work: work("cb100000010"),
        title: lit("Le vent d'octobre", "fr"),
        date: lit("1902"),
        status: lit("fully established", "en"),
        creator: person("cb100000011"),
        creatorName: lit("Yvonne Trélat"),
      },
      // A work the catalogue credits to nobody.
      {
        work: work("cb100000012"),
        title: lit("Chanson du vent d'octobre", "fr"),
        date: lit("1911"),
        status: lit("fully established", "en"),
      },
      // A window with room to spare: everything the index matched was read.
      windowRows(4),
    ],
  ),
);

/**
 * A title search whose index window came back full.
 *
 * The window is read before the type filter runs, so a page can be short of
 * what the index matched while still holding every row the filter kept. Two
 * works survive here out of a window of four hundred rows.
 */
write(
  "works-search-saturated",
  results(
    ["work", "title", "date", "status", "creator", "creatorName", "windowRows"],
    [
      {
        work: work("cb100000041"),
        title: lit("Amour de loin", "fr"),
        date: lit("1898"),
        status: lit("fully established", "en"),
      },
      {
        work: work("cb100000042"),
        title: lit("L'amour des jardins", "fr"),
        date: lit("1921"),
        status: lit("fully established", "en"),
      },
      windowRows(400),
    ],
  ),
);

write(
  "work-detail",
  results(
    ["p", "o", "lang", "name"],
    [
      {
        p: uri("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
        o: uri("http://rdvocab.info/uri/schema/FRBRentitiesRDA/Work"),
      },
      {
        p: uri("http://purl.org/dc/terms/title"),
        o: lit("Le vent d'octobre", "fr"),
        lang: lit("fr"),
      },
      { p: uri("http://www.w3.org/2000/01/rdf-schema#label"), o: lit("Le vent d'octobre") },
      { p: uri("http://purl.org/dc/terms/date"), o: lit("1902") },
      { p: uri("http://data.bnf.fr/ontology/bnf-onto/firstYear"), o: int(1902) },
      {
        p: uri("http://purl.org/dc/terms/creator"),
        o: person("cb100000001"),
        name: lit("Camille Ardouin"),
      },
      {
        p: uri("http://purl.org/dc/terms/language"),
        o: uri("http://id.loc.gov/vocabulary/iso639-2/fre"),
      },
      {
        p: uri("http://rdvocab.info/Elements/formOfWork"),
        o: uri("http://data.bnf.fr/vocabulary/work-form/poesi"),
      },
      { p: uri("http://data.bnf.fr/ontology/bnf-onto/subject"), o: lit("Littératures") },
      { p: uri("http://purl.org/dc/terms/subject"), o: uri("http://dewey.info/class/800/") },
      {
        p: uri("http://rdvocab.info/Elements/statusOfIdentification"),
        o: lit("fully established", "en"),
        lang: lit("en"),
      },
      {
        p: uri("http://rdaregistry.info/Elements/w/#P10078"),
        o: uri(`${ark("cb100000020")}#Expression`),
      },
      {
        p: uri("http://rdaregistry.info/Elements/w/#P10078"),
        o: uri(`${ark("cb100000021")}#Expression`),
      },
      {
        p: uri("http://www.w3.org/2002/07/owl#sameAs"),
        o: uri("http://wikidata.org/entity/Q90000010"),
      },
      {
        p: uri("http://www.w3.org/2000/01/rdf-schema#seeAlso"),
        o: uri("https://catalogue.bnf.fr/ark:/12148/cb100000010"),
      },
      { p: uri("http://xmlns.com/foaf/0.1/depiction"), o: gallica("bpt6k90000010.thumbnail") },
    ],
  ),
);

/**
 * A provisional work.
 *
 * The record says so in words, and the address says so by its shape. The
 * fixture carries both, because a parser that reads only one of them would keep
 * passing while the other quietly stopped being true.
 */
write(
  "work-provisional",
  results(
    ["p", "o", "lang", "name"],
    [
      {
        p: uri("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
        o: uri("http://rdvocab.info/uri/schema/FRBRentitiesRDA/Work"),
      },
      {
        p: uri("http://purl.org/dc/terms/title"),
        o: lit("Lire « Le vent d'octobre » de Camille Ardouin", "fr"),
        lang: lit("fr"),
      },
      { p: uri("http://purl.org/dc/terms/date"), o: lit("1994") },
      {
        p: uri("http://rdvocab.info/Elements/statusOfIdentification"),
        o: lit("provisional", "en"),
        lang: lit("en"),
      },
      {
        p: uri("http://purl.org/dc/terms/creator"),
        o: person("cb100000009"),
        name: lit("Bertrand Kessel"),
      },
    ],
  ),
);

/** A record with no title at all, which is what a wrong identifier looks like. */
write("work-untitled", results(["p", "o", "lang", "name"], []));

/* ── Editions ── */

write(
  "editions",
  results(
    [
      "edition",
      "title",
      "date",
      "year",
      "publisher",
      "place",
      "editionStatement",
      "extent",
      "isbn",
      "note",
      "catalogue",
      "reproduction",
      "ocr",
    ],
    [
      // One edition holding two digitised copies: two rows, one edition.
      {
        edition: work("cb100000030"),
        title: lit("Le vent d'octobre"),
        date: lit("1902"),
        year: int(1902),
        publisher: lit("Vve Delarue et fils"),
        place: lit("Poitiers"),
        extent: lit("1 vol. (94 p.)"),
        note: lit("Note : Tiré à 300 exemplaires sur vergé"),
        catalogue: uri("https://catalogue.bnf.fr/ark:/12148/cb100000030"),
        reproduction: gallica("bpt6k90000030"),
      },
      {
        edition: work("cb100000030"),
        title: lit("Le vent d'octobre"),
        date: lit("1902"),
        year: int(1902),
        publisher: lit("Vve Delarue et fils"),
        place: lit("Poitiers"),
        extent: lit("1 vol. (94 p.)"),
        note: lit("Note : Tiré à 300 exemplaires sur vergé"),
        catalogue: uri("https://catalogue.bnf.fr/ark:/12148/cb100000030"),
        reproduction: gallica("btv1b90000030"),
      },
      // A reprint carrying an edition statement, an ISBN and a machine-read text.
      {
        edition: work("cb100000031"),
        title: lit("Le vent d'octobre"),
        date: lit("1978"),
        year: int(1978),
        publisher: lit("Éditions du Cormier"),
        place: lit("Bruxelles"),
        editionStatement: lit("2e édition revue"),
        extent: lit("1 vol. (112 p.)"),
        isbn: lit("2-87042-000-1"),
        catalogue: uri("https://catalogue.bnf.fr/ark:/12148/cb100000031"),
        ocr: gallica("bd6t90000031"),
      },
      // An undated edition, where the date is a phrase rather than a year.
      {
        edition: work("cb100000032"),
        title: lit("Le vent d'octobre"),
        date: lit("[s.d.]"),
        publisher: lit("[s.n.]"),
        place: lit("[S.l.]"),
        extent: lit("2 disques : 33 t ; 30 cm"),
        catalogue: uri("https://catalogue.bnf.fr/ark:/12148/cb100000032"),
      },
    ],
  ),
);

write(
  "editions-empty",
  results(["edition", "title", "date", "year", "publisher", "place", "extent", "catalogue"], []),
);

/* ── Digitised documents ── */

write(
  "digitised-person",
  results(
    ["rank", "edition", "title", "reproduction", "ocr", "depiction"],
    [
      {
        rank: int(0),
        edition: work("cb100000030"),
        title: lit("Le vent d'octobre"),
        reproduction: gallica("bpt6k90000030"),
      },
      {
        rank: int(0),
        edition: work("cb100000031"),
        title: lit("Le vent d'octobre"),
        ocr: gallica("bd6t90000031"),
      },
      // The same address reached twice, which is one document rather than two.
      {
        rank: int(0),
        edition: work("cb100000030"),
        title: lit("Le vent d'octobre"),
        reproduction: gallica("bpt6k90000030"),
      },
      {
        rank: int(1),
        edition: person("cb100000001"),
        depiction: gallica("btv1b90000001.thumbnail"),
      },
      {
        rank: int(1),
        edition: person("cb100000001"),
        depiction: gallica("btv1b90000002/f3.item.thumbnail"),
      },
    ],
  ),
);

write(
  "digitised-empty",
  results(["rank", "edition", "title", "reproduction", "ocr", "depiction"], []),
);

/* ── The works one person is credited with as their creator ── */

/**
 * A person's works, with the awkward properties the real listing has.
 *
 * One work carries two form codes and therefore arrives as two rows. One work
 * carries none, which is the catalogue recording no genre for it. One is
 * provisional. The last row names an address this client cannot read, so a page
 * that came back short can be told from a catalogue holding little.
 */
write(
  "author-works",
  results(
    ["work", "title", "date", "year", "status", "form"],
    [
      {
        work: work("cb100000010"),
        title: lit("Le vent d'octobre", "fr"),
        date: lit("1902"),
        year: int(1902),
        status: lit("fully established", "en"),
        form: uri("http://data.bnf.fr/vocabulary/work-form/te"),
      },
      {
        work: work("cb100000010"),
        title: lit("Le vent d'octobre", "fr"),
        date: lit("1902"),
        year: int(1902),
        status: lit("fully established", "en"),
        form: uri("http://data.bnf.fr/vocabulary/work-form/poesi"),
      },
      // A work the catalogue records no form for.
      {
        work: work("cb100000013"),
        title: lit("Sonnets d'hiver", "fr"),
        date: lit("1908"),
        year: int(1908),
        status: lit("fully established", "en"),
      },
      {
        work: temp("b7c1d2e3f405162738495a6b7c8d9e0f"),
        title: lit("Notes de voyage", "fr"),
        date: lit("1931"),
        year: int(1931),
        status: lit("provisional", "en"),
        form: uri("http://data.bnf.fr/vocabulary/work-form/te"),
      },
      {
        work: uri("http://data.bnf.fr/something-else/9000/#about"),
        title: lit("An address this client cannot read"),
      },
    ],
  ),
);

write("author-works-empty", results(["work", "title", "date", "year", "status", "form"], []));

/* ── Answers this server has to refuse to read ── */

write("not-a-result-set", { head: { vars: ["s"] }, rows: [] });
