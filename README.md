# mcp-databnf

[![npm](https://img.shields.io/npm/v/mcp-databnf.svg)](https://www.npmjs.com/package/mcp-databnf)
[![CI](https://github.com/smeet666/mcp-databnf/actions/workflows/ci.yml/badge.svg)](https://github.com/smeet666/mcp-databnf/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/mcp-databnf.svg)](./LICENSE)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-listed-6E56CF)](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.smeet666/mcp-databnf)
[![Glama](https://glama.ai/mcp/servers/smeet666/mcp-databnf/badges/score.svg)](https://glama.ai/mcp/servers/smeet666/mcp-databnf)
[![M8ven Score](https://m8ven.ai/badge/mcp/smeet666-mcp-databnf-abxqfo)](https://m8ven.ai/mcp/smeet666-mcp-databnf-abxqfo)
[![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=databnf&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIm1jcC1kYXRhYm5mIl19)
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install-0098FF?style=flat&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=databnf&config=%7B%22name%22%3A%22databnf%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22mcp-databnf%22%5D%7D)

An MCP server for [data.bnf.fr](https://data.bnf.fr), the open catalogue of the
Bibliothèque nationale de France. Look up an author, find a work, list the
editions the BnF holds of it, list what a person wrote, and gather the links to
what has been digitised.

No API key. No account. Read-only.

---

## What it is for

The BnF publishes its authority file and its bibliographic records as linked
data, and answers questions about them over SPARQL. That dataset knows things a
web search does not: which of two people bearing one name wrote a given book,
what the BnF recorded as somebody's date and place of death, which editions of a
work exist and who printed them, and which of those have been digitised.

This server asks those questions for you, in seven tools, and reports what the
catalogue answers without adding to it.

## Install

```bash
npx mcp-databnf
```

### Claude Desktop, Claude Code, and other stdio clients

```json
{
  "mcpServers": {
    "databnf": {
      "command": "npx",
      "args": ["-y", "mcp-databnf"]
    }
  }
}
```

## The seven tools

| Tool             | Answers                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `search_authors` | Who does the BnF record under this name, and which record is which                                                        |
| `get_author`     | Dates, places, occupation, language, country, Dewey class, and the same person in VIAF, IdRef, DBpedia, Wikidata and ISNI |
| `search_works`   | Which works have these words in their title                                                                               |
| `get_work`       | Title, creators, date, language, form, subject, and whether the record is established or provisional                      |
| `list_works`     | Which works the catalogue names a person the creator of, with the date and the form code it gives each                    |
| `list_editions`  | Publisher, place, year, edition statement, extent, ISBN, catalogue link, and the Gallica link when there is one           |
| `find_digitised` | Every digitised document the catalogue attaches to a person or a work, as links                                           |

A typical exchange asks `search_authors` for a name, reads the rows, and passes
one identifier to `get_author`, to `list_works`, or on to `list_editions`.

## What it does not do, and why

**It never reads Gallica.** The BnF puts its metadata and its digitised contents
under two different regimes. The metadata this server reads may be reused freely
provided the source and the date of retrieval are stated. The contents on
gallica.bnf.fr are governed separately: their terms make use inside an
artificial-intelligence project subject to a paid licence outside academic
research, and the site refuses ClaudeBot and GPTBot at the server, then bans the
calling address after about fifteen requests whatever the pace.

So a Gallica address is treated here as what the catalogue says it is: a piece of
metadata, rendered as a link for a person to open. The server will tell you that
a 1873 Brussels printing of _Une saison en enfer_ has been digitised and give you
its address. It will not tell you what is on page four, whether the scan is
complete, or whether the document opens at all. A `bnf-onto:OCR` link names a
machine-read text of a document; the server reports that the text exists and
leaves it where it is. A test fails if any address on that host is ever built to
be called.

**It does not rank.** The BnF's full-text index answers whether a title or a name
carries the words asked for. It returns no measure of how well, so the rows come
back in the order the index holds them. Searching for `saison enfer` returns a
dozen studies of Rimbaud before Rimbaud, and every one of them is a correct
match. This server says so rather than inventing an order the catalogue does not
support, and it reports no total, because a total on a search that does not rank
reads as a measure of relevance.

**A name is matched letter for letter, and only among the people.** The index
compares the characters given against the characters a cataloguer entered, so
`Dostoïevski`, `Dostoievski` and `Dostoevskij` are three searches reaching three
different sets of records, and a handful of rows under one spelling is no
evidence about the others. `search_authors` says so on every answer, and it reads
the person records alone: an organisation or a conference is outside what it
looked at, so an answer holding no row is never a statement that the authority
file holds no such heading.

**A list of works is one link, not a bibliography.** `list_works` walks
`dcterms:creator`, the statement that ties a work to the person who made it.
That statement is real and it is partial. The catalogue credits a person on a
record in other ways, and the BnF holds printed editions whose work it has never
established as a record of its own, so a title missing from the list is not a
title the person did not write. Every answer says so, and none of them reports a
total: a count of what one link reaches would be read as a count of what somebody
wrote.

**A form code says what a work declares, and an empty one says nothing.** A work
record points at a term of the BnF's work-form vocabulary, and this dataset
publishes no label for those terms. So `roman`, `poesi` and `te` arrive as the
codes they are: some read as words and some do not. The catalogue also states no
form at all on a great many works, and that silence is a form unstated rather
than a genre denied. Keeping the rows that carry one code therefore finds the
works declaring it and never all the works of that form, which is why the codes
are reported and no filter is offered on them.

**It does not write biographies.** The field the BnF calls biographical
information is an occupation on most records: Rimbaud's says _Poète_, and that is
the whole of it. `get_author` returns that word and says what it is.

**It exposes no raw SPARQL tool.** An arbitrary query is an unbounded load on a
service a public institution pays for, and nothing here would control what the
caller wrote. Every query this server sends is one of ten written in advance.

## The licence, and what it asks of you

The BnF states one condition on these metadata:

> L'utilisation de ces métadonnées est libre et gratuite sous réserve du maintien
> de la mention de leur source et de l'indication de leur date de récupération.

Use is free of charge, provided the source is named **and the date of retrieval
is stated**. That second half is a design constraint:
every answer this server produces carries `retrieved_at` in its payload and ends
its text block with the source and that date. A cached answer reports the moment
it was originally read, since that is the date it was retrieved. Repeat both
wherever you show what you got.

## How it treats the service

data.bnf.fr is a query service a public institution runs at its own cost, and a
SPARQL query is a more expensive request than fetching a page.

- One request at a time, never in parallel.
- At least three seconds between two of them. Configuration can widen that and
  cannot narrow it, including through the published client entry point.
- The `User-Agent` always carries the project identifier and an address where a
  person can be reached, whatever a caller sets.
- Answers are cached in memory for fifteen minutes, so a conversation that walks
  back over one author does not ask twice.

The BnF publishes no rate for this endpoint. It publishes `Crawl-delay: 5` on its
other host and enforces it there, which is the only figure it has stated about
how fast it wants to be read, and the floor here was set with that in mind.

## Settings

Every one is optional.

| Variable                | Default  | Meaning                                                                                             |
| ----------------------- | -------- | --------------------------------------------------------------------------------------------------- |
| `BNF_USER_AGENT`        | none     | Identify your own client. The project identifier is appended, so the BnF can always reach a person. |
| `BNF_MIN_INTERVAL_MS`   | `3000`   | Milliseconds between requests. The floor is 3000 and cannot be lowered.                             |
| `BNF_TIMEOUT_MS`        | `60000`  | Deadline for one query.                                                                             |
| `BNF_MAX_RETRIES`       | `3`      | Attempts after a busy answer.                                                                       |
| `BNF_CACHE_TTL_MS`      | `900000` | How long an answer is kept. `0` turns the cache off.                                                |
| `BNF_CACHE_MAX_ENTRIES` | `200`    | How many answers are kept.                                                                          |
| `BNF_LOG_LEVEL`         | `error`  | `silent`, `error`, `info` or `debug`. Logs go to stderr.                                            |

A value that cannot be read is refused, named on stderr, and the default stands.
The setting is not clamped: clamping would let you believe a value took effect
when it did not.

## Errors

| Code            | Means                                                       |
| --------------- | ----------------------------------------------------------- |
| `not_found`     | The endpoint answered, and the BnF describes no such record |
| `invalid_input` | The request was refused rather than answered                |
| `rate_limited`  | The endpoint asked this client to slow down                 |
| `parse_failure` | The answer arrived in a shape this client cannot read       |
| `network_error` | The request did not complete                                |
| `timeout`       | The query exceeded its deadline, or the endpoint gave it up |

`rate_limited` never means the record is missing. Neither does `timeout`: the
endpoint answers 200 with an empty body when it abandons a query part way
through, and this server calls that a failure to read rather than an absence,
because the two look identical and mean opposite things.

## Using the access layer on its own

The lower layer imports nothing from the MCP protocol and is published under the
`./client` subpath, with its pacing, its cache and its error taxonomy attached.

```ts
import { BnfClient } from "mcp-databnf/client";

const client = new BnfClient();
const { data, retrievedAt } = await client.searchAuthors("Rimbaud", 10, 0);
for (const author of data.rows) console.log(author.id, author.name, author.birthYear);
console.log("retrieved", retrievedAt);
```

## Development

```bash
npm install
npm test          # unit tests, against generated fixtures, no network
npm run typecheck
npm run build
BNF_LIVE=1 npm run test:live   # one real query per route
```

The unit tests reach no network. Fixtures are generated by
`scripts/build-fixtures.mjs` from invented records, so no BnF content lives in
this repository and every test is reproducible. The live suite runs nightly as a
canary, and it is the only thing that would notice the day the catalogue changes
shape.

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md). Reports of a wrong answer are the most useful
kind: say what you asked, what came back, and what the record actually holds.

## Licence

MIT for this code. See [LICENSE](LICENSE).

The metadata belong to the Bibliothèque nationale de France and are published
under the condition quoted above: name the source, and state the date of
retrieval.

---

# mcp-databnf (français)

Un serveur MCP pour [data.bnf.fr](https://data.bnf.fr), le catalogue ouvert de la
Bibliothèque nationale de France. Chercher un auteur, trouver une œuvre, lister
les éditions que la BnF en conserve, lister ce qu'une personne a écrit, et
rassembler les liens vers ce qui a été numérisé.

Sans clé d'API. Sans compte. En lecture seule.

## À quoi il sert

La BnF publie son fichier d'autorité et ses notices bibliographiques en données
liées, et répond aux questions qu'on lui pose en SPARQL. Ce jeu de données sait
des choses qu'une recherche sur le web ignore : lequel de deux homonymes a écrit
tel livre, ce que la BnF a enregistré comme date et lieu de mort de quelqu'un,
quelles éditions d'une œuvre existent et qui les a imprimées, et lesquelles ont
été numérisées.

Ce serveur pose ces questions pour vous, en sept outils, et rapporte ce que le
catalogue répond sans y ajouter.

## Installation

```bash
npx mcp-databnf
```

```json
{
  "mcpServers": {
    "databnf": {
      "command": "npx",
      "args": ["-y", "mcp-databnf"]
    }
  }
}
```

## Les sept outils

| Outil            | Répond à                                                                                                               |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `search_authors` | Qui la BnF enregistre sous ce nom, et quelle notice est laquelle                                                       |
| `get_author`     | Dates, lieux, profession, langue, pays, indice Dewey, et la même personne dans VIAF, IdRef, DBpedia, Wikidata et ISNI  |
| `search_works`   | Quelles œuvres portent ces mots dans leur titre                                                                        |
| `get_work`       | Titre, auteurs, date, langue, forme, sujet, et si la notice est établie ou provisoire                                  |
| `list_works`     | Quelles œuvres le catalogue attribue à une personne comme créatrice, avec la date et le code de forme qu'il leur donne |
| `list_editions`  | Éditeur, lieu, année, mention d'édition, pagination, ISBN, lien catalogue, et le lien Gallica quand il existe          |
| `find_digitised` | Tous les documents numérisés que le catalogue rattache à une personne ou à une œuvre, sous forme de liens              |

## Ce qu'il ne fait pas, et pourquoi

**Il ne lit jamais Gallica.** La BnF place ses métadonnées et ses contenus
numérisés sous deux régimes différents. Les métadonnées lues ici sont
réutilisables librement à condition d'en citer la source et la date de
récupération. Les contenus de gallica.bnf.fr relèvent d'un autre régime : leurs
conditions soumettent l'usage dans un projet d'intelligence artificielle à une
licence payante hors recherche académique, et le site refuse ClaudeBot et GPTBot
au niveau du serveur, puis bannit l'adresse appelante après une quinzaine de
requêtes, quel que soit le rythme.

Une adresse Gallica est donc traitée ici pour ce que le catalogue en dit : une
métadonnée, rendue comme un lien qu'une personne ouvrira. Le serveur vous dira
qu'un tirage bruxellois de 1873 d'_Une saison en enfer_ a été numérisé et vous en
donnera l'adresse. Il ne vous dira pas ce qu'il y a page quatre, si la
numérisation est complète, ni si le document s'ouvre. Un lien `bnf-onto:OCR`
désigne un texte océrisé : le serveur signale qu'il existe et le laisse où il
est. Un test échoue si une adresse sur cet hôte est un jour construite pour être
appelée.

**Il ne classe pas.** L'index plein texte de la BnF répond si un titre ou un nom
porte les mots demandés. Il ne rend aucune mesure de pertinence, donc les lignes
arrivent dans l'ordre de l'index. Chercher `saison enfer` rend une douzaine
d'études sur Rimbaud avant Rimbaud, et chacune est une correspondance correcte.
Ce serveur le dit, plutôt que d'inventer un ordre que le catalogue ne porte pas,
et il ne rapporte aucun total : sur une recherche qui ne classe pas, un total se
lit comme une mesure de pertinence.

**Un nom est apparié lettre à lettre, et seulement parmi les personnes.**
L'index compare les caractères donnés à ceux qu'un catalogueur a saisis :
`Dostoïevski`, `Dostoievski` et `Dostoevskij` sont donc trois recherches qui
atteignent trois ensembles de notices différents, et quelques lignes obtenues
sous une graphie ne disent rien des autres. `search_authors` l'énonce sur chaque
réponse, et il ne lit que les notices de personnes : un organisme ou un congrès
est hors de ce qu'il a regardé, si bien qu'une réponse sans ligne n'affirme
jamais que le fichier d'autorité ne tient pas une telle vedette.

**Une liste d'œuvres est un lien, pas une bibliographie.** `list_works` suit
`dcterms:creator`, l'énoncé qui rattache une œuvre à qui l'a faite. Cet énoncé
est réel et il est partiel : le catalogue crédite une personne sur une notice par
d'autres voies, et la BnF conserve des éditions imprimées dont l'œuvre n'a jamais
été établie comme notice à part entière. Un titre absent de la liste n'est donc
pas un titre que la personne n'a pas écrit. Chaque réponse le dit, et aucune ne
rapporte de total : un compte de ce qu'un seul lien atteint se lirait comme un
compte de ce que quelqu'un a écrit.

**Un code de forme dit ce qu'une œuvre déclare ; son absence ne dit rien.** Une
notice d'œuvre pointe vers un terme du vocabulaire des formes d'œuvre de la BnF,
et ce jeu de données n'en publie aucun libellé. `roman`, `poesi` et `te`
arrivent donc tels quels : certains se lisent comme des mots, d'autres non. Le
catalogue n'énonce par ailleurs aucune forme sur quantité d'œuvres, et ce
silence est une forme non déclarée, pas un genre exclu. Garder les lignes qui
portent un code trouve donc les œuvres qui le déclarent, jamais toutes les
œuvres de cette forme : les codes sont rapportés, et aucun filtre n'est offert
dessus.

**Il n'écrit pas de biographies.** Le champ que la BnF appelle information
biographique contient une profession sur la plupart des notices : celle de
Rimbaud dit _Poète_, et c'est tout. `get_author` rend ce mot et dit ce que c'est.

**Il n'expose aucun outil SPARQL brut.** Une requête arbitraire est une charge
non bornée sur un service qu'une institution publique paie, et rien ici ne
contrôlerait ce que l'appelant a écrit. Chacune des requêtes envoyées est l'une
des dix écrites à l'avance.

## La licence, et ce qu'elle vous demande

La BnF pose une condition :

> L'utilisation de ces métadonnées est libre et gratuite sous réserve du maintien
> de la mention de leur source et de l'indication de leur date de récupération.

La date de récupération est une contrainte de conception : chaque réponse porte `retrieved_at` dans sa charge structurée et termine
son bloc de texte par la source et cette date. Une réponse servie depuis le cache
rapporte le moment où elle a été lue la première fois, puisque c'est là qu'elle a
été récupérée. Reprenez les deux partout où vous montrez ce que vous avez obtenu.

## Le rythme

Une requête à la fois, jamais en parallèle. Au moins trois secondes entre deux
requêtes : la configuration peut élargir cet intervalle et ne peut pas le
réduire, y compris par le point d'entrée `client` publié. Le `User-Agent` porte
toujours l'identifiant du projet et une adresse où joindre une personne. Les
réponses sont gardées quinze minutes en mémoire.

La BnF ne publie aucune limite pour ce point d'accès. Elle publie `Crawl-delay: 5`
sur son autre hôte et l'y fait respecter, ce qui est le seul chiffre qu'elle ait
énoncé sur la vitesse à laquelle elle veut être lue.

## Réglages

Tous facultatifs : `BNF_USER_AGENT`, `BNF_MIN_INTERVAL_MS` (3000, plancher
infranchissable), `BNF_TIMEOUT_MS` (60000), `BNF_MAX_RETRIES` (3),
`BNF_CACHE_TTL_MS` (900000), `BNF_CACHE_MAX_ENTRIES` (200), `BNF_LOG_LEVEL`
(`error`). Une valeur illisible est refusée, signalée sur stderr, et la valeur
par défaut s'applique.

## Erreurs

`not_found`, `invalid_input`, `rate_limited`, `parse_failure`, `network_error`,
`timeout`. `rate_limited` ne veut jamais dire que la notice est absente.
`timeout` non plus : le point d'accès répond 200 avec un corps vide quand il
abandonne une requête en cours de route, et ce serveur appelle cela un échec de
lecture plutôt qu'une absence, parce que les deux se ressemblent et veulent dire
le contraire.

## Licence

MIT pour ce code. Les métadonnées appartiennent à la Bibliothèque nationale de
France et sont publiées sous la condition citée plus haut : citer la source, et
indiquer la date de récupération.
