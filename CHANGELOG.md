# Changelog

This project follows [semantic versioning](https://semver.org/).

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
