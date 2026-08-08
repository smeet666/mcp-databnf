# mcp-databnf

**An MCP server for data.bnf.fr, the open catalogue of the Bibliothèque nationale
de France.** Look up an author, find a work, list the editions the BnF holds of
it, and gather the links to what has been digitised. No API key, no account,
read-only.

## Install

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

## Tools

- `search_authors`: who the BnF records under a name, and which record is which.
- `get_author`: dates, places, occupation, language, country, Dewey class, and
  the same person in VIAF, IdRef, DBpedia, Wikidata and ISNI.
- `search_works`: works whose title carries the words given.
- `get_work`: title, creators, date, language, form, subject, and whether the
  record is established or provisional.
- `list_editions`: publisher, place, year, edition statement, extent, ISBN,
  catalogue link, and the Gallica link where there is one.
- `find_digitised`: every digitised document the catalogue attaches to a person
  or a work, as links.

## Worth knowing

The BnF licence asks for the source and the date of retrieval to be stated
wherever the metadata are shown, so every answer carries both.

The full-text index does not rank, so rows come back in index order and the
server says so rather than presenting the first as the best.

Gallica addresses are returned as links and never requested: the BnF places its
metadata and its digitised contents under two different regimes.

- npm: https://www.npmjs.com/package/mcp-databnf
- Source: https://github.com/smeet666/mcp-databnf
- Licence: MIT
