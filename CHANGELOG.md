# Changelog

This project follows [semantic versioning](https://semver.org/).

## 1.0.1

- `search_works` and `search_authors` answered a page sitting past the last row
  by saying nothing in the catalogue carries those words. Asking for page 2 of
  "Ruy Blas" reported an absence while twenty rows sat on page 1. A page beyond
  the end and an absence are different answers, and only one of them means the
  words match nothing. An empty page after the first is now read back at the
  start of the same search: rows there mean the page sits past the end, and the
  answer says so and points back to page 1. No row there means a real absence,
  which is still stated plainly. A read-back that does not answer settles
  neither, and the answer names both readings rather than choosing one.
- Page 1 is its own evidence and is never read twice, so a search that matches
  nothing still costs one request.
- This states no total. The server does not ask the endpoint how many records
  match, because a count on a search that does not rank would read as a measure
  of the answer. Where the rows stop is a boundary it can point at.

## 1.0.0

First release.

Six read-only tools over the SPARQL endpoint of data.bnf.fr, the open catalogue
of the Bibliothèque nationale de France: `search_authors`, `get_author`,
`search_works`, `get_work`, `list_editions` and `find_digitised`.

What the answers are held to:

- Every answer names its source and states the date the metadata were retrieved,
  which is what the BnF licence asks for. A cached answer reports the moment it
  was first read.
- `search_authors` returns every authority record carrying a name, and says when
  several of them do, rather than choosing one.
- Both searches report that the full-text index does not rank, and report no
  total, because a total on such a search reads as a measure of relevance. A page
  past what one search reads of the index is refused, since an empty page there
  would say nothing about the catalogue.
- `get_work` states whether a record is established or provisional, and warns
  that a provisional identifier can change.
- A record is checked against what the catalogue types it as, so a subject
  heading is not read back as a person with no dates, and an edition is not read
  back as the work it manifests.
- A count is withheld when the record it was computed over was longer than one
  query reads.

What it will not do:

- Gallica addresses are returned as links and never requested. The guard sits
  between the query builders and the network, redirects are read rather than
  followed, and a test drives all six tools with records full of Gallica
  addresses and asserts that none of them was called.
- Caller text reaching the full-text index is reduced to words before a query
  exists, identifiers are rebuilt from a match rather than interpolated, and
  limits are bounded integers. The tests read the query back off the wire.
- Text the BnF published cannot open a line where this server writes its own:
  the attribution it ends with cannot be forged from a catalogue record.

How it treats the service:

- One request at a time, at least three seconds apart, with a floor that
  configuration cannot lower through the environment or through the published
  client entry point, which also bounds the retry budget and the deadline.
- Two callers asking one question at the same moment cost the endpoint one query.
- An answer this client could not read widens the spacing rather than counting as
  a calm reply, because an empty body is how this endpoint says it gave up.
