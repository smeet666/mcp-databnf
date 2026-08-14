# Changelog

This project follows [semantic versioning](https://semver.org/).

## 1.1.1

- The README carries the same badge row as every server here: npm, CI, the
  licence, the MCP registry entry, the Glama score, and one-click installs for
  Cursor and VS Code. Each install link encodes this package. npm serves the
  README frozen at publish time, so a release is what puts it there.

## 1.1.0

- A text search reads a fixed window of the index, and a search that filled it
  reported exhaustion. `search_authors {"name":"Marie","limit":50,"page":8}`
  returned fifty rows and `has_more: false`, while page 9 was refused for
  reaching past the end of what one search reads: of the two statements, the one
  a caller reaches by stopping where the server told them to was the false one.
  The window is also read before the type filter, so a list of a hundred and
  fifty rows could rest on a full one. The endpoint now sends the occupancy of
  the window in the request that reads the page, and both searches publish
  `index_window_full` and say in words what a full window means: the rows are a
  part of the matches, and `has_more` false marks where the reading stopped. No
  count of matches is reported, here or anywhere else.
- The rows a full window holds are settled by the index as it answers, so two
  readings of one search could differ with nothing said. The same wording now
  states it, and ties it to the window: an answer resting on a window with room
  to spare holds every match and is repeatable.
- A page emptied by the filter behind a full window said that the BnF held
  nobody, and no reading had established that. Both searches now name the
  window as what the page rests on and leave the question open.
- `words_searched` named one term where the index had required two. It cuts a
  word at an apostrophe and at a hyphen, so `O'Brien` is required as `O` and
  `Brien` and a record written `Pat O Brien` matches. Both searches now report
  the terms the index required, and say which word was cut, so a caller can see
  from the fields why a row is on the list.
- `get_author` said a person might be living on a record that dates them
  nowhere, about a man dead since 1881. The BnF keeps a second authority record
  for some people, carrying a name and nothing else, and a silence on that
  record is a fact about the record. The note now turns on whether the record
  states a birth, and a record stating neither date says so and points at
  `search_authors` as the way to the other records the file holds.
- `list_works` answering with no row now carries the same pointer, since the
  link it reports hangs off a record rather than off a person.
- `get_work` printed the work-form codes with none of the caveat the listing
  gives them. The wording is now shared, so both tools say that the vocabulary
  publishes no label for those terms and that an absent code is a form the
  catalogue does not state.
- `search_authors`, `search_works`, `list_editions` and `list_works` served one
  record on two pages and left another out. Each cuts its page in a subquery and
  then reads the columns in an outer query that asked for no order, and SPARQL
  gives such a query no order at all: the endpoint sent the rows of a page in a
  sequence of its own, and the row dropped to turn a page of eleven into a page
  of ten was whichever one arrived last. Marguerite Duras at four works a page
  put `cb12285962p` on pages 2 and 3 and never showed `cb122859600`. Every paged
  query now sorts its outer form on the same address the page was cut along, so
  a walk through the pages reaches each record once. The sort runs over the rows
  of a single page, and the endpoint answers it in the same time as before.
- The note attached to a list of works claimed the order held between pages,
  which was the guarantee the query had not asked for. Every wording about the
  order now names what the rows are ordered by, and says that paging along it
  reaches each record once.

- `list_works` walks from a person to the works the catalogue names them the
  creator of, which is the question "what did this person write". A title search
  cannot answer it: the index reads titles, so a person's name in a title belongs
  to the books written about them, and searching "Balzac" returns his critics.
- The list states what it is. It reports one link, `dcterms:creator`, and the
  catalogue credits a person on a record in other ways and holds editions whose
  work it has never established, so an absent title is not a title the person did
  not write. No total is reported: a count of what one link reaches would be read
  as a count of what somebody wrote.
- Each row carries the form codes the catalogue points at, untranslated, because
  this dataset publishes no label for that vocabulary.
- A page holding no row is read before anything is said about the catalogue. A
  page past the last row points back to page 1, a person the link is empty on is
  named as such, and an address the catalogue types as something other than a
  person is refused with what it is.

- `list_editions` answered a person's identifier with an empty list of editions
  and explained it as a property of work records, which invented a bibliographic
  fact about a record that is not a work. It now reads what the address is
  before explaining anything, and refuses one the catalogue types otherwise,
  naming that type and pointing at `list_works` and `get_author`. A provisional
  identifier still costs no query, since only a work is addressed under
  `temp-work`.
- `find_digitised` followed the `kind` it was given without checking it, and
  returned that same word as its own reading of the record. The person path and
  the work path reach different links, so a wrong kind answered with part of the
  record and nothing said so. The catalogue is now asked what the record is on
  every call, `kind` in the answer is that reading, and a stated kind the
  catalogue contradicts is refused as invalid input.
- The wording about work forms denied information the field carries. Some terms
  of the vocabulary read as words and some do not, and what the catalogue
  withholds is a form on the many works that state none. Every place that
  describes them, the tool descriptions, the notes, the schemas and the README,
  now says that: a code is what a work declares, an absent code is a form
  unstated, and selecting on a code finds the works declaring it and never all
  the works of that form.
- A person's record can state its dates twice, in the brackets of a heading and
  in the dated fields, and the two can disagree. `get_author` and
  `search_authors` now say when they do, quoting both, and settle nothing: those
  fields are what tells two people of one name apart, and the record gives no
  ground for preferring either side.
- `search_authors` matches the index letter for letter, so a name written with
  other accents or under another transliteration is a different search reaching
  different records, and a short list of rows looks exactly like a complete one.
  Every answer now says so. An answer holding no row also said that no record in
  the authority file carried the name, having read the person records alone; it
  now states that scope, so an organisation or a conference is named as outside
  what was searched.
- A character that marks nothing on a screen was treated as a word separator, so
  a control character pasted inside a name cut it in two and the index was asked
  for both halves. `Rimbaud` carrying one such byte returned no row and the
  answer read "No person in the BnF authority file matches", which no reading had
  established. The control characters, the zero-width spaces and joiners, the
  soft hyphen, the bidirectional marks and the byte order mark are now removed
  before the words are cut, so a word one of them sits inside is searched for
  whole, and the answer says how many were removed. A space, a tab and a line
  break still separate words.
- Punctuation reached no term while a one-letter fragment was kept as a term the
  index required, and neither was said. Both searches now name the characters
  they set aside beside the terms they asked for, and name a term of one
  character as required like any other, since either can be what emptied a list.
- The addresses under `same_as` arrived with nothing said about where they came
  from or what is known of them. `get_author` and `get_work` now state that they
  are the BnF's own alignments, carried character for character, and that this
  server requests data.bnf.fr alone and does not open them, so whether one still
  answers is something it has not looked at. Re-spelling one, by decoding an
  escape or adding an escape of this server's own, would produce an address the
  catalogue never published.
- `find_digitised` published its per-role figures under `counts`, next to
  `has_more`, where they read as a count of what the catalogue attaches. They
  count the links in the answer, and Baudelaire's record returns a hundred and
  one of them with more left out at the ceiling. The field is now
  `links_returned_by_role`, it says what it counts, and a shortened answer says
  that the figures fall short by however much was left out.
- A digitised link carried an address opening a small image beside an ARK naming
  the document that image was taken from, with `url` described as the document.
  Sixty-three of the hundred and one links on Baudelaire's record are such
  addresses. Every link now carries `rendering`, the view the address asks
  Gallica for, read off what follows the ARK name and null when the address
  names the document; the answer counts the links carrying one.
- A record stating one text under `biographical_information` and under
  `occupation` was returned as two fields, where it reads as two statements
  agreeing. `get_author` now says when the two are identical character for
  character.
- One identifier was refused with a different list of types depending on which
  tool refused it, because a detail query gathers the classes of everything it
  walks through. Every refusal now states the list the address itself answers
  with, so the five tools describe one record the same way.
- `catalogue_url` came back null on `get_work` while `get_author` and
  `list_editions` filled it, with nothing to read that silence by. Both fields
  now say that the address is the one the record points at, that null is the
  record stating none, and that no address is built in its place.
- The square brackets of cataloguing passed through `publisher` and `place`
  unexplained, so `[S.l.]`, `[s.n.]` and a role such as `[éd., distrib.]` read as
  what the item prints. The values are still passed on as published, and the
  fields and a note now say what the brackets mean.
- The Gallica caveat was attached to answers from `get_author` and `get_work`
  that carried no link, where it describes a list that is not there. It now
  travels with the images only when they are returned.

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
