/**
 * Every host, address and vocabulary term this server reads, in one place. An
 * upstream rename is then a one-file change rather than a hunt through the
 * parsers.
 *
 * The robots file at data.bnf.fr withholds one path, the one ending in
 * `cross-documents`, and nothing built here reaches it. The endpoint below is
 * addressed without a trailing slash: with one, the same address serves a
 * JavaScript query editor rather than the query service.
 */

import { BnfError } from "../errors.js";

/** The one address this server sends a request to. */
export const SPARQL_ENDPOINT = "https://data.bnf.fr/sparql";

/** The host every request must be addressed to, checked before each call. */
export const ALLOWED_HOST = "data.bnf.fr";

/**
 * The host this server describes and never requests.
 *
 * The BnF places its metadata and its digitised contents under two different
 * regimes. The metadata served here is free to reuse with its source and its
 * date of retrieval named. The contents on gallica.bnf.fr are not: their terms
 * make use inside an artificial-intelligence project subject to a paid licence
 * outside academic research, and the site refuses ClaudeBot and GPTBot at the
 * server, then bans the calling address after about fifteen requests whatever
 * the pace.
 *
 * So a Gallica address is a piece of metadata here, rendered as a link for a
 * person to open. `assertRequestable` below is what keeps that a rule rather
 * than an intention.
 */
export const GALLICA_HOST = "gallica.bnf.fr";

/**
 * Refuse to request anything but the query service.
 *
 * This sits between the query builders and `fetch`, so a future route, a
 * redirect followed by hand, or an address read out of a response cannot become
 * a request to a host this server has no licence to read.
 */
export function assertRequestable(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw refusal(`mcp-databnf refuses to request "${url}": it is not an address.`);
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (host !== ALLOWED_HOST) {
    throw refusal(
      `mcp-databnf requests ${ALLOWED_HOST} and nothing else; "${host}" was refused. ` +
        "Gallica in particular is described from the catalogue and never read.",
    );
  }
}

/**
 * The refusal, raised as an error the transport will not retry.
 *
 * A plain error here would be read as a request that failed to complete, and the
 * next attempt would be made against the same address. A decision not to call a
 * host is settled, so it has to arrive as an answer rather than as a mishap.
 */
const refusal = (message: string) =>
  new BnfError("network_error", message, {
    hint: "This server reads the BnF catalogue at data.bnf.fr. It holds no licence to read the digitised contents, so it does not follow an address that leaves that host.",
  });

/** True when an address points at Gallica, whatever the scheme or the case. */
export function isGallicaAddress(address: string): boolean {
  try {
    // A trailing dot names the root of the domain tree and resolves to the same
    // host. Comparing without stripping it would read a Gallica address as
    // somewhere else, and the link would be dropped from the answer.
    const host = new URL(address).hostname.toLowerCase().replace(/\.$/, "");
    return host === GALLICA_HOST || host.endsWith(`.${GALLICA_HOST}`);
  } catch {
    return false;
  }
}

/** Namespaces the queries use, emitted as a PREFIX block. */
export const PREFIXES = {
  foaf: "http://xmlns.com/foaf/0.1/",
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  rdfs: "http://www.w3.org/2000/01/rdf-schema#",
  owl: "http://www.w3.org/2002/07/owl#",
  skos: "http://www.w3.org/2004/02/skos/core#",
  dcterms: "http://purl.org/dc/terms/",
  bio: "http://vocab.org/bio/0.1/",
  bnf: "http://data.bnf.fr/ontology/bnf-onto/",
  bibo: "http://purl.org/ontology/bibo/",
  isni: "http://isni.org/ontology#",
  /** RDA group 2 elements, which carry the biographical fields. */
  rdag2: "http://rdvocab.info/ElementsGr2/",
  /** RDA elements, which carry the bibliographic fields. */
  rdae: "http://rdvocab.info/Elements/",
  /** RDA relationships between work, expression, manifestation and item. */
  rdarel: "http://rdvocab.info/RDARelationshipsWEMI/",
  /** The FRBR classes data.bnf.fr types its entities with. */
  rdafrbr: "http://rdvocab.info/uri/schema/FRBRentitiesRDA/",
} as const;

export const PREFIX_BLOCK = Object.entries(PREFIXES)
  .map(([name, iri]) => `PREFIX ${name}: <${iri}>`)
  .join("\n");

/** The two shapes an entity address takes in this dataset. */
export const ARK_BASE = "http://data.bnf.fr/ark:/12148/";
export const TEMP_WORK_BASE = "http://data.bnf.fr/temp-work/";

/** The page a person can open for a record, which every result carries. */
export const publicPageFor = (entityIri: string): string =>
  entityIri.replace(/#.*$/, "").replace(/^http:/, "https:");

/** The BnF general catalogue, where a record is described for a reader. */
export const catalogueUrlFor = (arkId: string): string =>
  `https://catalogue.bnf.fr/ark:/12148/${arkId}`;

/**
 * The licence this dataset is published under, and what it asks for.
 *
 * The BnF states it in one sentence: the metadata may be used freely and at no
 * cost, provided the source is named and the date of retrieval is stated. Both
 * halves are therefore attached to every answer rather than left to a caller.
 */
export const LICENCE_FR =
  "L'utilisation de ces métadonnées est libre et gratuite sous réserve du maintien de la mention de leur source et de l'indication de leur date de récupération.";

export const LICENCE_EN =
  "These metadata may be used freely and at no cost, provided their source is named and the date they were retrieved is stated.";
