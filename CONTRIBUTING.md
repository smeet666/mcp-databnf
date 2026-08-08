# Contributing

## The most useful report

A wrong answer. Say what you asked, what came back, and what the record actually
holds, with the data.bnf.fr address. That is the kind of bug the tests cannot
find on their own, and it is what turns a rule in this repository into a
test.

## Running it

```bash
npm install
npm test          # unit tests, no network
npm run typecheck
npm run build
BNF_LIVE=1 npm run test:live   # one real query per route
```

## How a change is made

**Write the test first.** A defect is fixed by writing the test that states the
right answer, then correcting the code. A test written afterwards proves only
what the code already does.

**Tests are deterministic or they do not exist.** Anything touching time goes
through `vi.useFakeTimers` with a pinned epoch. No tolerance constants, no
wall-clock measurement. A test that passes only on a fast machine is rewritten.

**Fixtures are generated, not captured.** `scripts/build-fixtures.mjs` writes
invented records in the shape the endpoint really answers with. No BnF content
lives in this repository.

**The unit tests reach no network.** The live suite is opt-in and makes one
request per route. data.bnf.fr is a service a public institution pays for.

## Two rules that are not negotiable

**Nothing requests gallica.bnf.fr.** The metadata and the digitised contents are
under two different regimes, and this server holds a licence for the first only.
Gallica addresses are rendered as links and never called. A test enforces it.

**Every answer names its source and the date of retrieval.** The BnF licence asks
for both. They are produced by the access layer and rendered by `ok()`, so a new
tool gets them by construction; do not build a result without going through it.

## Writing

Anything you write here is read by somebody who has never seen a previous
version. Describe what the code does and why, never how it differs from a past
state. Comment the non-obvious: an invariant, an edge case, the reason behind a
choice that looks odd. Do not comment what the name already says.
