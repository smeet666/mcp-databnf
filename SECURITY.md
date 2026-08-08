# Security

## Reporting

Open a [private security advisory](https://github.com/smeet666/mcp-databnf/security/advisories/new)
rather than a public issue. A first reply usually takes a few days.

## What this server does

It sends read-only SPARQL queries to `https://data.bnf.fr/sparql` over HTTPS and
renders the answers. It authenticates with nothing, stores nothing on disk, and
writes nowhere. There is no account to compromise and no credential to leak.

## The two things worth attacking, and what stops them

**Writing your own query.** Every tool takes caller text, and a SPARQL query is a
program. Three defences apply, in order of how much they leave to chance.

Text going to the full-text index is reduced to words before a query exists:
letters, digits, and an apostrophe or hyphen between two characters. Every quote,
brace, backslash, angle bracket and newline is gone by then, so there is nothing
left to escape and no operator a caller can write.

An identifier is matched against the two shapes the dataset uses and rebuilt from
the match, so the address in the query was written by this code rather than
supplied. An identifier that matches neither is refused before any request is
made.

Limits and offsets are bounded whole numbers.

`escapeLiteral` covers what is neither, and the tests hold it to producing a
literal that closes where it opened whatever it is handed. Those tests read the
query back off the wire rather than trusting the builder.

**Text from the catalogue reaching a model.** Titles, cataloguers' notes and
authority headings are written by third parties and are rendered into an answer.
This server writes three kinds of line a reader treats as its own voice: `Note:`,
`Source:` and `Hint:`. A line of catalogue text opening with one of those words
would be indistinguishable from one of them, and a forged `Source:` line placed
above the real one substitutes a different attribution for the BnF's.

Such a line is indented before rendering, whatever its case and whatever spacing
it puts before the colon. Third-party text interpolated into a note or an error
message is folded onto one line first, because those are assembled after the body
has been guarded and a line break in one of them would open a line that indenting
never reaches. The structured payload keeps the text exactly as published.

Treat anything under a title, a note or a heading as data a stranger wrote. This
server does not execute it, and neither should anything downstream.

## The host this server will not call

`gallica.bnf.fr` is never requested. The BnF places its metadata and its
digitised contents under two different regimes, and this server holds a licence
for the first only.

A guard sits between the query builders and `fetch` and refuses any host but the
query service. Redirects are read rather than followed: a 3xx is answered by
checking the address it names and only then issuing the next request, so a
redirect out of the query service is refused instead of chased. That refusal is
terminal rather than retried, since a decision not to call a host is settled.

A test drives all six tools with records full of Gallica addresses and asserts
that none of them was called, another feeds the transport a redirect to Gallica
and asserts that the second address never went out, and a third greps the source
tree for any Gallica address built as a string.

## What it does not defend against

It does not verify that the catalogue tells the truth. It reports what the BnF
published, and a mistake in a record is repeated as published, with a link so it
can be checked.

## Supported versions

The latest published version. Report a problem against it.
