/**
 * The live suite and the notes this server writes, held to the same wording.
 *
 * The live suite asserts that a tool qualifies its answer, and it does so by
 * quoting the qualification. A quotation is a copy, so it can name a sentence
 * no tool writes: the assertion then fails against a server behaving exactly as
 * intended, and it fails at night, against data.bnf.fr, in a job whose whole
 * purpose is to report that the catalogue moved.
 *
 * This reads the phrases the live suite requires of a note and checks each one
 * against the notes the tools actually produce, from fixtures and without a
 * network. A phrase that drifts is then a red unit test on the push that
 * introduced it, and the nightly job keeps saying only what it exists to say.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BnfClient } from "../../src/bnf/client.js";
import { runFindDigitised } from "../../src/tools/findDigitised.js";
import { runGetAuthor } from "../../src/tools/getAuthor.js";
import { runGetWork } from "../../src/tools/getWork.js";
import { runListEditions } from "../../src/tools/listEditions.js";
import { runListWorks } from "../../src/tools/listWorks.js";
import { runSearchAuthors } from "../../src/tools/searchAuthors.js";
import { runSearchWorks } from "../../src/tools/searchWorks.js";
import { fakeEndpoint, notesOf, silentLogger, testConfig } from "./helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const liveSuitePath = join(here, "..", "live", "smoke.live.test.ts");

const client = (endpoint: ReturnType<typeof fakeEndpoint>) =>
  new BnfClient({
    config: testConfig({ minIntervalMs: 0 }),
    logger: silentLogger,
    fetchImpl: endpoint.fetchImpl,
  });

/**
 * A `toContain` whose subject is a note, with the text it requires.
 *
 * The subject is matched as well as the call, so an assertion about the
 * rendered text block or about an error code is left where it is: those are
 * checked elsewhere and they are not what a tool writes as a qualification.
 */
const NOTE_ASSERTION =
  /expect\(([^;]*?\bnotes\b[^;]*?)\)\s*\.toContain\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g;

function notePhrasesRequiredBy(source: string): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(NOTE_ASSERTION)) {
    const phrase = match[2];
    if (phrase !== undefined && phrase !== "") {
      found.add(phrase);
    }
  }
  return [...found];
}

/** Every note the seven tools write on a reading that succeeds. */
async function everyNote(): Promise<string> {
  const notes: string[] = [];

  notes.push(
    ...notesOf(
      await runSearchAuthors(client(fakeEndpoint([{ fixture: "authors-search" }])), {
        name: "Arthur Rimbaud",
        limit: 10,
        page: 1,
      }),
    ),
  );

  notes.push(
    ...notesOf(
      await runSearchWorks(client(fakeEndpoint([{ fixture: "works-search" }])), {
        title: "saison enfer",
        limit: 10,
        page: 1,
      }),
    ),
  );

  notes.push(
    ...notesOf(
      await runGetAuthor(client(fakeEndpoint([{ fixture: "author-detail" }])), {
        author_id: "cb100000001",
        include_depictions: false,
      }),
    ),
  );

  notes.push(
    ...notesOf(
      await runGetWork(client(fakeEndpoint([{ fixture: "work-detail" }])), {
        work_id: "cb100000010",
        include_depictions: false,
      }),
    ),
  );

  notes.push(
    ...notesOf(
      await runListEditions(client(fakeEndpoint([{ fixture: "editions" }])), {
        work_id: "cb100000010",
        limit: 20,
        page: 1,
      }),
    ),
  );

  notes.push(
    ...notesOf(
      await runListWorks(client(fakeEndpoint([{ fixture: "author-works" }])), {
        author_id: "cb100000001",
        limit: 10,
        page: 1,
      }),
    ),
  );

  notes.push(
    ...notesOf(
      await runFindDigitised(
        client(fakeEndpoint([{ fixture: "types-person" }, { fixture: "digitised-person" }])),
        { id: "cb100000001", kind: "auto", limit: 20 },
      ),
    ),
  );

  return notes.join("\n");
}

describe("what the live suite quotes of the notes", () => {
  it("reads the phrases the live suite requires of a note", () => {
    const phrases = notePhrasesRequiredBy(readFileSync(liveSuitePath, "utf8"));
    expect(phrases.length).toBeGreaterThan(0);
  });

  it("leaves an assertion about anything but a note where it is", () => {
    const source = [
      'expect(result.content[0]?.text).toContain("Source: data.bnf.fr");',
      'expect((payload.notes as string[]).join(" ")).toContain("kept as published");',
    ].join("\n");
    expect(notePhrasesRequiredBy(source)).toEqual(["kept as published"]);
  });

  it("finds every one of them in a note a tool writes", async () => {
    const written = await everyNote();
    const phrases = notePhrasesRequiredBy(readFileSync(liveSuitePath, "utf8"));

    const unwritten = phrases.filter((phrase) => !written.includes(phrase));
    expect(unwritten).toEqual([]);
  });
});
