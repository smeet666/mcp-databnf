# mcp-databnf

[![npm](https://img.shields.io/npm/v/mcp-databnf.svg)](https://www.npmjs.com/package/mcp-databnf)
[![CI](https://github.com/smeet666/mcp-databnf/actions/workflows/ci.yml/badge.svg)](https://github.com/smeet666/mcp-databnf/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/mcp-databnf.svg)](./LICENSE)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-listed-6E56CF)](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.smeet666/mcp-databnf)
[![Glama](https://glama.ai/mcp/servers/smeet666/mcp-databnf/badges/score.svg)](https://glama.ai/mcp/servers/smeet666/mcp-databnf)
[![M8ven](https://m8ven.ai/badge/mcp/smeet666-mcp-databnf-abxqfo?variant=verified)](https://m8ven.ai/mcp/smeet666-mcp-databnf-abxqfo)
[![LobeHub](https://lobehub.com/badge/mcp/smeet666-mcp-databnf)](https://lobehub.com/mcp/smeet666-mcp-databnf)
[![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=databnf&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIm1jcC1kYXRhYm5mIl19)
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install-0098FF?style=flat&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=databnf&config=%7B%22name%22%3A%22databnf%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22mcp-databnf%22%5D%7D)

[data.bnf.fr](https://data.bnf.fr) is the open data service of the Bibliothèque
nationale de France. It publishes the authority records the national library
maintains: the people it catalogues, with their dates, their places, their
languages and their fields of activity; the works they wrote, with the editions
each work was published in; and the links to the copies digitised in Gallica. A
record states whether the library considers it established or still provisional.

This server connects a chat client to that service. You can search for an author
or a work by name, read a record in full, list what an author wrote, list the
editions of a work, and find the digitised copies attached to either. It needs no
API key and no account.

_[Version française](#mcp-databnf-français)_

---

## Install

**One-click install**

[![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=databnf&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIm1jcC1kYXRhYm5mIl19)
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install-0098FF?style=flat&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=databnf&config=%7B%22name%22%3A%22databnf%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22mcp-databnf%22%5D%7D)

**Claude Code**

```bash
claude mcp add databnf -- npx -y mcp-databnf
```

**Claude Desktop, Cursor, and any client using the standard config format**

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

Node 24 or later is required, and no environment variable has to be set.

### With Docker

```json
{
  "mcpServers": {
    "databnf": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "ghcr.io/smeet666/mcp-databnf:2.1.2"]
    }
  }
}
```

`-i` keeps stdin open, which is where the protocol travels, and `-t` is left out
because a TTY rewrites the stream. The container needs outbound HTTPS to
`data.bnf.fr`, and nothing else: no volume, no port, no credential.

### Bundle, without npm

Download `mcp-databnf-2.1.2.mcpb` from
[the latest release](https://github.com/smeet666/mcp-databnf/releases/latest) and
open it. A client that supports MCP bundles installs it on its own, with no npm
and no configuration file to edit. The bundle carries its dependencies, so
nothing is fetched at install time.

## What you can ask

- « Que dit la BnF de Colette ? »
- "List everything Marguerite Duras wrote."
- "Which editions of that work does the library hold?"
- "Are any of them digitised in Gallica?"
- "When was that record last established?"

The ordinary path runs from a search to a record: a row carries an `id`, and
`get_author` or `get_work` reads it.

## Tools

| Tool             | What it does                                                  |
| ---------------- | ------------------------------------------------------------- |
| `search_authors` | Finds people by name in the authority records.                |
| `get_author`     | Reads one person's record in full.                            |
| `search_works`   | Finds works by title.                                         |
| `get_work`       | Reads one work's record in full.                              |
| `list_works`     | Lists the works one person is credited with.                  |
| `list_editions`  | Lists the editions of one work.                               |
| `find_digitised` | Finds the copies digitised in Gallica for a person or a work. |

### `search_authors`

Finds people by name in the authority records.

| Argument | Type                           | Required | What it does          |
| -------- | ------------------------------ | -------- | --------------------- |
| `name`   | string, 1 to 200 characters    | yes      | The name to look for. |
| `limit`  | integer, 1 to 50, default `10` | no       | Rows to serve.        |
| `page`   | integer, 1 to 100, default `1` | no       | Which page of rows.   |

**In return:** `authors`, each carrying `id`, which `get_author`, `list_works`
and `find_digitised` take; `name` as the service writes it; `label`, the
authority heading, usually with the dates; `birth_year` and `death_year`, `null`
where the record states none; `role`; and `source_url`. `words_searched` says
what was actually sent, `has_more` whether further pages exist, and
`index_window_full` that the index served everything it will serve for this
search.

### `get_author`

Reads one person's record in full.

| Argument             | Type                        | Required | What it does                            |
| -------------------- | --------------------------- | -------- | --------------------------------------- |
| `author_id`          | string, 1 to 200 characters | yes      | The identifier a row carries.           |
| `include_depictions` | boolean, default `false`    | no       | Add the portraits the record points to. |

**In return:** the person with `name`, `label`, `given_name`, `family_name`,
`other_names`, `birth_date` and `death_date` as published, `birth_year` and
`death_year` as numbers, `birth_place`, `death_place`,
`biographical_information`, `occupation`, `languages` as ISO 639-2 codes,
`countries` and `fields` in the words of the record. A field the record leaves
empty is `null`.

### `search_works`

Finds works by title.

| Argument | Type                           | Required | What it does                        |
| -------- | ------------------------------ | -------- | ----------------------------------- |
| `title`  | string, 1 to 200 characters    | yes      | The words of the title to look for. |
| `limit`  | integer, 1 to 50, default `10` | no       | Rows to serve.                      |
| `page`   | integer, 1 to 100, default `1` | no       | Which page of rows.                 |

**In return:** `works`, each carrying `id`, which `get_work`, `list_editions` and
`find_digitised` take; `title`; `date`, the year the record gives the work, as
published; `creators`; `status`, reading `established` or `provisional`; and
`source_url`. The envelope carries the same `words_searched`, `has_more` and
`index_window_full` a search of people returns.

### `get_work`

Reads one work's record in full.

| Argument             | Type                        | Required | What it does                                |
| -------------------- | --------------------------- | -------- | ------------------------------------------- |
| `work_id`            | string, 1 to 200 characters | yes      | The identifier a row carries.               |
| `include_depictions` | boolean, default `false`    | no       | Add the illustrations the record points to. |

**In return:** the work with `title`, `label`, `date` as published, `first_year`,
`creators` as `{ id, name }`, `languages`, `forms`, `subjects` and
`dewey_classes` in the words of the record, `expression_count`, `same_as` for the
registers the BnF aligns it with, and `catalogue_url`. `status` reads
`established` or `provisional`, and `status_statement` says what the library
means by it: a provisional record is one the library has not finished checking.

### `list_works`

Lists the works one person is credited with.

| Argument    | Type                           | Required | What it does             |
| ----------- | ------------------------------ | -------- | ------------------------ |
| `author_id` | string, 1 to 200 characters    | yes      | The person's identifier. |
| `limit`     | integer, 1 to 50, default `10` | no       | Rows to serve.           |
| `page`      | integer, 1 to 100, default `1` | no       | Which page of rows.      |

**In return:** `works`, each carrying `id`, `title`, `date` as published, `year`
as a number where the record has one, `forms`, `status` and `source_url`, with
`has_more` to continue.

### `list_editions`

Lists the editions of one work.

| Argument  | Type                           | Required | What it does           |
| --------- | ------------------------------ | -------- | ---------------------- |
| `work_id` | string, 1 to 200 characters    | yes      | The work's identifier. |
| `limit`   | integer, 1 to 50, default `10` | no       | Rows to serve.         |
| `page`    | integer, 1 to 100, default `1` | no       | Which page of rows.    |

**In return:** `editions`, each carrying its own `id` in the BnF catalogue, the
`title` this edition bears, `date` and `year`, `publisher`, `place`,
`edition_statement`, `extent`, `isbn`, `note` as the cataloguer wrote it,
`catalogue_url`, `digitised` and `source_url`. A field the record leaves empty is
`null`.

### `find_digitised`

Finds the copies digitised in Gallica attached to a person or a work.

| Argument | Type                                       | Required | What it does                             |
| -------- | ------------------------------------------ | -------- | ---------------------------------------- |
| `id`     | string, 1 to 200 characters                | yes      | The identifier of a person or of a work. |
| `kind`   | `auto`, `person` or `work`, default `auto` | no       | What the identifier stands for.          |
| `limit`  | integer, 1 to 200, default `40`            | no       | Links to serve.                          |

**In return:** `kind`, saying what the catalogue types the record as, and `links`,
each carrying the Gallica `ark`, its `url`, its `rendering` and the `role` the
person holds on it. `links_returned_by_role` counts them per role. This server
describes a digitised document and never opens one.

## Established and provisional records

A record carries a `status`. `established` means the library has checked it;
`provisional` means it has not finished, and `status_statement` says so in the
library's own words. Report the status alongside anything taken from a
provisional record.

## The licence, and what it asks

The BnF states one condition on these metadata:

> L'utilisation de ces métadonnées est libre et gratuite sous réserve du maintien
> de la mention de leur source et de l'indication de leur date de récupération.

Use is free of charge, provided the source is named and the date of retrieval is
stated. Every answer carries `retrieved_at` in its payload and ends its text with
the source and that date. A cached answer reports the moment it was originally
read, since that is when it was retrieved. Repeat both wherever what you got is
shown.

## Configuration

Every variable is optional. Set them in the `env` block of your client config.

| Variable                | Default              | What it does                                                                      |
| ----------------------- | -------------------- | --------------------------------------------------------------------------------- |
| `BNF_USER_AGENT`        | the project identity | Names your application to the BnF, with an address where a person can be reached. |
| `BNF_MIN_INTERVAL_MS`   | `3000`               | Gap between two requests, from 3000 to 120000.                                    |
| `BNF_TIMEOUT_MS`        | `60000`              | Deadline for one request, from 1000 to 300000.                                    |
| `BNF_MAX_RETRIES`       | `3`                  | Attempts after a transient failure, from 0 to 8.                                  |
| `BNF_CACHE_TTL_MS`      | `900000`             | How long an answer stays in memory, from 0 to 86400000.                           |
| `BNF_CACHE_MAX_ENTRIES` | `200`                | Answers held in memory at once, from 1 to 5000.                                   |
| `BNF_LOG_LEVEL`         | `error`              | `silent`, `error`, `info` or `debug`, written to stderr.                          |

A value outside its range falls back to the default, and the reason is written to
stderr.

## Errors

Every failure carries one of six codes, a message, and where it helps a hint
naming the next move.

| Code            | What happened                                           | What to do                                                                                                   |
| --------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `not_found`     | The service answered, and holds no such record.         | Check the identifier with `search_authors` or `search_works`.                                                |
| `invalid_input` | The arguments were refused before any request went out. | Read the message, which names the argument.                                                                  |
| `rate_limited`  | The service asked this client to slow down.             | Wait the number of seconds the hint names and call again with the same arguments. The record is still there. |
| `parse_failure` | The answer arrived in a shape this client cannot read.  | Report it at [the issue tracker](https://github.com/smeet666/mcp-databnf/issues).                            |
| `network_error` | The request did not complete.                           | Try again shortly.                                                                                           |
| `timeout`       | The request passed its deadline.                        | Raise `BNF_TIMEOUT_MS`, or ask for fewer rows.                                                               |

## As a library

The layer reading the service is published on its own, with its pacing, its cache
and its errors, and with no protocol attached.

```ts
import { BnfClient } from "mcp-databnf/client";

const client = new BnfClient();
const { data, cached } = await client.getAuthor("cb11907966z");
console.log(data.label, cached);
```

`getAuthor` and `getWork` each answer `{ data, cached }`, and throw an error
carrying one of the six codes. The three-second floor between two requests holds
here as well.

## Pacing and attribution

Requests go out one at a time with at least three seconds between them, and that
floor holds however the server is configured. Each question is answered by a
SPARQL query against a public endpoint the BnF runs at its own expense, which is
why the interval is wide and the deadline long. The `User-Agent` always ends with
the project identity and an address where a person can be reached.

Every answer carries the source and `retrieved_at`, which the licence asks to be
stated wherever the metadata are shown.

This MCP server is an unofficial project, with no affiliation to the
Bibliothèque nationale de France.

## Privacy

This server collects nothing about you and sends nothing to its author. It runs
on your machine, contacts `data.bnf.fr` and nothing else, holds its answers in memory
while it runs, and writes nothing to disk.
[PRIVACY.md](PRIVACY.md) states what a request carries and which settings change
any of it.

## Development

```bash
npm install
npm run build:fixtures
npm test
npm run check
```

Tests run against generated fixtures and make no network request. The live suite,
`npm run test:live`, makes one request per route and runs nightly against the
service itself.

## Contributing

Bugs, questions and ideas belong in
[the issue tracker](https://github.com/smeet666/mcp-databnf/issues). Pull
requests are welcome; opening an issue first helps agree on the shape of the
change. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT, see [LICENSE](LICENSE). The metadata belong to the Bibliothèque nationale de
France, free to use provided the source and the date of retrieval are stated.

---

<a name="mcp-databnf-français"></a>

# mcp-databnf (français)

_[English version](#mcp-databnf)_

[data.bnf.fr](https://data.bnf.fr) est le service de données ouvertes de la
Bibliothèque nationale de France. Il publie les notices d'autorité que la
bibliothèque nationale entretient : les personnes qu'elle catalogue, avec leurs
dates, leurs lieux, leurs langues et leurs domaines d'activité ; les œuvres
qu'elles ont écrites, avec les éditions dans lesquelles chaque œuvre a paru ; et
les liens vers les exemplaires numérisés dans Gallica. Une notice indique si la
bibliothèque la tient pour établie ou encore provisoire.

Ce serveur relie un client de conversation à ce service. On peut y chercher un
auteur ou une œuvre par son nom, lire une notice en entier, lister ce qu'un
auteur a écrit, lister les éditions d'une œuvre, et trouver les exemplaires
numérisés attachés à l'un ou l'autre. Aucune clé d'API, aucun compte.

## Installation

**Installation en un clic**

[![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=databnf&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIm1jcC1kYXRhYm5mIl19)
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install-0098FF?style=flat&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=databnf&config=%7B%22name%22%3A%22databnf%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22mcp-databnf%22%5D%7D)

**Claude Code**

```bash
claude mcp add databnf -- npx -y mcp-databnf
```

**Claude Desktop, Cursor, et tout client au format de configuration standard**

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

Node 24 ou plus récent est nécessaire, et aucune variable d'environnement n'est à
renseigner.

### Avec Docker

```json
{
  "mcpServers": {
    "databnf": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "ghcr.io/smeet666/mcp-databnf:2.1.2"]
    }
  }
}
```

`-i` garde l'entrée standard ouverte, qui est le canal du protocole, et `-t` est
omis parce qu'un TTY réécrit le flux. Le conteneur a besoin d'un accès HTTPS
sortant vers `data.bnf.fr`, et de rien d'autre : aucun volume, aucun port, aucun
identifiant.

### Bundle, sans npm

Téléchargez `mcp-databnf-2.1.2.mcpb` depuis
[la dernière publication](https://github.com/smeet666/mcp-databnf/releases/latest)
et ouvrez-le. Un client qui gère les bundles MCP l'installe seul, sans npm et
sans fichier de configuration à modifier. Le bundle emporte ses dépendances, donc
rien n'est téléchargé à l'installation.

## Ce qu'on peut demander

- « Que dit la BnF de Colette ? »
- « Liste tout ce qu'a écrit Marguerite Duras. »
- « Quelles éditions de cette œuvre la bibliothèque conserve-t-elle ? »
- « Y en a-t-il de numérisées dans Gallica ? »
- « Cette notice est-elle établie ou provisoire ? »

Le chemin ordinaire va d'une recherche à une notice : une ligne porte un `id`, et
`get_author` ou `get_work` la lit.

## Les outils

| Outil            | Ce qu'il fait                                                                |
| ---------------- | ---------------------------------------------------------------------------- |
| `search_authors` | Trouve des personnes par leur nom dans les notices d'autorité.               |
| `get_author`     | Lit la notice d'une personne en entier.                                      |
| `search_works`   | Trouve des œuvres par leur titre.                                            |
| `get_work`       | Lit la notice d'une œuvre en entier.                                         |
| `list_works`     | Liste les œuvres attribuées à une personne.                                  |
| `list_editions`  | Liste les éditions d'une œuvre.                                              |
| `find_digitised` | Trouve les exemplaires numérisés dans Gallica d'une personne ou d'une œuvre. |

### `search_authors`

Trouve des personnes par leur nom dans les notices d'autorité.

| Argument | Type                        | Requis | Ce qu'il fait          |
| -------- | --------------------------- | ------ | ---------------------- |
| `name`   | chaîne, 1 à 200 caractères  | oui    | Le nom cherché.        |
| `limit`  | entier, 1 à 50, défaut `10` | non    | Lignes à servir.       |
| `page`   | entier, 1 à 100, défaut `1` | non    | Quelle page de lignes. |

**En retour :** `authors`, chacun portant `id`, que `get_author`, `list_works` et
`find_digitised` reprennent ; `name` tel que le service l'écrit ; `label`, la
vedette d'autorité, généralement avec les dates ; `birth_year` et `death_year`,
`null` là où la notice n'en indique pas ; `role` ; et `source_url`.
`words_searched` dit ce qui a réellement été envoyé, `has_more` s'il existe
d'autres pages, et `index_window_full` que l'index a servi tout ce qu'il servira
pour cette recherche.

### `get_author`

Lit la notice d'une personne en entier.

| Argument             | Type                       | Requis | Ce qu'il fait                                        |
| -------------------- | -------------------------- | ------ | ---------------------------------------------------- |
| `author_id`          | chaîne, 1 à 200 caractères | oui    | L'identifiant que porte une ligne.                   |
| `include_depictions` | booléen, défaut `false`    | non    | Ajoute les portraits vers lesquels la notice pointe. |

**En retour :** la personne avec `name`, `label`, `given_name`, `family_name`,
`other_names`, `birth_date` et `death_date` tels que publiés, `birth_year` et
`death_year` en nombres, `birth_place`, `death_place`,
`biographical_information`, `occupation`, `languages` en codes ISO 639-2,
`countries` et `fields` dans les mots de la notice. Un champ que la notice laisse
vide vaut `null`.

### `search_works`

Trouve des œuvres par leur titre.

| Argument | Type                        | Requis | Ce qu'il fait              |
| -------- | --------------------------- | ------ | -------------------------- |
| `title`  | chaîne, 1 à 200 caractères  | oui    | Les mots du titre cherché. |
| `limit`  | entier, 1 à 50, défaut `10` | non    | Lignes à servir.           |
| `page`   | entier, 1 à 100, défaut `1` | non    | Quelle page de lignes.     |

**En retour :** `works`, chacune portant `id`, que `get_work`, `list_editions` et
`find_digitised` reprennent ; `title` ; `date`, l'année que la notice donne à
l'œuvre, telle que publiée ; `creators` ; `status`, valant `established` ou
`provisional` ; et `source_url`. L'enveloppe porte les mêmes `words_searched`,
`has_more` et `index_window_full` qu'une recherche de personnes.

### `get_work`

Lit la notice d'une œuvre en entier.

| Argument             | Type                       | Requis | Ce qu'il fait                                              |
| -------------------- | -------------------------- | ------ | ---------------------------------------------------------- |
| `work_id`            | chaîne, 1 à 200 caractères | oui    | L'identifiant que porte une ligne.                         |
| `include_depictions` | booléen, défaut `false`    | non    | Ajoute les illustrations vers lesquelles la notice pointe. |

**En retour :** l'œuvre avec `title`, `label`, `date` telle que publiée,
`first_year`, `creators` en `{ id, name }`, `languages`, `forms`, `subjects` et
`dewey_classes` dans les mots de la notice, `expression_count`, `same_as` pour
les registres auxquels la BnF l'aligne, et `catalogue_url`. `status` vaut
`established` ou `provisional`, et `status_statement` dit ce que la bibliothèque
entend par là : une notice provisoire est une notice qu'elle n'a pas fini de
vérifier.

### `list_works`

Liste les œuvres attribuées à une personne.

| Argument    | Type                        | Requis | Ce qu'il fait                 |
| ----------- | --------------------------- | ------ | ----------------------------- |
| `author_id` | chaîne, 1 à 200 caractères  | oui    | L'identifiant de la personne. |
| `limit`     | entier, 1 à 50, défaut `10` | non    | Lignes à servir.              |
| `page`      | entier, 1 à 100, défaut `1` | non    | Quelle page de lignes.        |

**En retour :** `works`, chacune portant `id`, `title`, `date` telle que publiée,
`year` en nombre quand la notice en a un, `forms`, `status` et `source_url`, avec
`has_more` pour poursuivre.

### `list_editions`

Liste les éditions d'une œuvre.

| Argument  | Type                        | Requis | Ce qu'il fait             |
| --------- | --------------------------- | ------ | ------------------------- |
| `work_id` | chaîne, 1 à 200 caractères  | oui    | L'identifiant de l'œuvre. |
| `limit`   | entier, 1 à 50, défaut `10` | non    | Lignes à servir.          |
| `page`    | entier, 1 à 100, défaut `1` | non    | Quelle page de lignes.    |

**En retour :** `editions`, chacune portant son propre `id` au catalogue de la
BnF, le `title` que cette édition porte, `date` et `year`, `publisher`, `place`,
`edition_statement`, `extent`, `isbn`, `note` telle que le catalogueur l'a
écrite, `catalogue_url`, `digitised` et `source_url`. Un champ que la notice
laisse vide vaut `null`.

### `find_digitised`

Trouve les exemplaires numérisés dans Gallica attachés à une personne ou à une
œuvre.

| Argument | Type                                      | Requis | Ce qu'il fait                                |
| -------- | ----------------------------------------- | ------ | -------------------------------------------- |
| `id`     | chaîne, 1 à 200 caractères                | oui    | L'identifiant d'une personne ou d'une œuvre. |
| `kind`   | `auto`, `person` ou `work`, défaut `auto` | non    | Ce que l'identifiant désigne.                |
| `limit`  | entier, 1 à 200, défaut `40`              | non    | Liens à servir.                              |

**En retour :** `kind`, qui dit de quel type le catalogue tient la notice, et
`links`, chacun portant l'`ark` Gallica, son `url`, son `rendering` et le `role`
que la personne y tient. `links_returned_by_role` les compte par rôle. Ce serveur
décrit un document numérisé et n'en ouvre jamais aucun.

## Notices établies et provisoires

Une notice porte un `status`. `established` signifie que la bibliothèque l'a
vérifiée ; `provisional` qu'elle ne l'a pas terminée, et `status_statement` le
dit dans ses propres mots. Rapportez ce statut à côté de tout ce qui vient d'une
notice provisoire.

## La licence, et ce qu'elle demande

La BnF pose une condition sur ces métadonnées :

> L'utilisation de ces métadonnées est libre et gratuite sous réserve du maintien
> de la mention de leur source et de l'indication de leur date de récupération.

Chaque réponse porte `retrieved_at` dans sa charge utile et termine son texte par
la source et cette date. Une réponse servie depuis le cache rapporte le moment où
elle a été lue à l'origine, puisque c'est sa date de récupération. Redonnez les
deux partout où ce que vous avez obtenu est montré.

## Configuration

Chaque variable est facultative. Elles se posent dans le bloc `env` de la
configuration du client.

| Variable                | Défaut               | Ce qu'elle fait                                                                     |
| ----------------------- | -------------------- | ----------------------------------------------------------------------------------- |
| `BNF_USER_AGENT`        | l'identité du projet | Nomme votre application auprès de la BnF, avec une adresse où joindre une personne. |
| `BNF_MIN_INTERVAL_MS`   | `3000`               | Écart entre deux requêtes, de 3000 à 120000.                                        |
| `BNF_TIMEOUT_MS`        | `60000`              | Délai d'une requête, de 1000 à 300000.                                              |
| `BNF_MAX_RETRIES`       | `3`                  | Tentatives après un échec passager, de 0 à 8.                                       |
| `BNF_CACHE_TTL_MS`      | `900000`             | Durée pendant laquelle une réponse reste en mémoire, de 0 à 86400000.               |
| `BNF_CACHE_MAX_ENTRIES` | `200`                | Réponses gardées en mémoire à la fois, de 1 à 5000.                                 |
| `BNF_LOG_LEVEL`         | `error`              | `silent`, `error`, `info` ou `debug`, écrit sur la sortie d'erreur.                 |

Une valeur hors de sa plage retombe sur le défaut, et la raison est écrite sur la
sortie d'erreur.

## Erreurs

Chaque échec porte un des six codes, un message, et quand cela aide une
indication du geste suivant.

| Code            | Ce qui s'est passé                                   | Que faire                                                                                        |
| --------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `not_found`     | Le service a répondu, et n'a pas cette notice.       | Vérifiez l'identifiant avec `search_authors` ou `search_works`.                                  |
| `invalid_input` | Les arguments ont été refusés avant toute requête.   | Lisez le message, qui nomme l'argument.                                                          |
| `rate_limited`  | Le service demande à ce client de ralentir.          | Attendez les secondes indiquées et rappelez avec les mêmes arguments. La notice est toujours là. |
| `parse_failure` | La réponse est arrivée dans une forme illisible ici. | Signalez-le sur [le suivi d'incidents](https://github.com/smeet666/mcp-databnf/issues).          |
| `network_error` | La requête n'a pas abouti.                           | Réessayez sous peu.                                                                              |
| `timeout`       | La requête a dépassé son délai.                      | Augmentez `BNF_TIMEOUT_MS`, ou demandez moins de lignes.                                         |

## Comme bibliothèque

La couche qui lit le service est publiée seule, avec son rythme, son cache et ses
erreurs, sans protocole attaché.

```ts
import { BnfClient } from "mcp-databnf/client";

const client = new BnfClient();
const { data, cached } = await client.getAuthor("cb11907966z");
console.log(data.label, cached);
```

`getAuthor` et `getWork` répondent chacun `{ data, cached }`, et lèvent une
erreur portant un des six codes. Le plancher de trois secondes entre deux
requêtes tient également ici.

## Rythme et attribution

Les requêtes partent une à une avec au moins trois secondes entre elles, et ce
plancher tient quelle que soit la configuration. Chaque question se résout par
une requête SPARQL contre un point d'accès public que la BnF fait tourner à ses
frais, d'où un intervalle large et un délai long. Le `User-Agent` se termine
toujours par l'identité du projet et une adresse où joindre une personne.

Chaque réponse porte la source et `retrieved_at`, que la licence demande
d'indiquer partout où les métadonnées sont montrées.

Ce MCP est un projet non officiel, sans affiliation à la Bibliothèque nationale
de France.

## Confidentialité

Ce serveur ne collecte rien sur vous et n'envoie rien à son auteur. Il tourne sur
votre machine, ne joint que `data.bnf.fr`, garde ses réponses en mémoire le temps qu'il
tourne, et n'écrit rien sur le disque. [PRIVACY.md](PRIVACY.md) dit ce qu'une
requête emporte et quels réglages changent cela.

## Développement

```bash
npm install
npm run build:fixtures
npm test
npm run check
```

Les tests s'exécutent sur des fixtures engendrées et n'émettent aucune requête.
La suite en direct, `npm run test:live`, émet une requête par route et tourne
chaque nuit contre le service lui-même.

## Contribuer

Les anomalies, les questions et les idées ont leur place dans
[le suivi d'incidents](https://github.com/smeet666/mcp-databnf/issues). Les
propositions de modification sont bienvenues ; ouvrir un ticket d'abord aide à
s'accorder sur la forme du changement. Voir [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

MIT, voir [LICENSE](LICENSE). Les métadonnées appartiennent à la Bibliothèque
nationale de France, d'usage libre sous réserve d'indiquer la source et la date
de récupération.
