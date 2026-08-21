/**
 * What an answer states about the record it read, beside what it returns.
 *
 * A field name, a caveat and a count are read as claims. A count named as a
 * total is read as a total, a caveat about links is read as an answer holding
 * links, and two fields carrying one sentence are read as two sources agreeing.
 * These hold each of those to what the catalogue actually said.
 */

import { describe, expect, it, vi } from "vitest";
import { BnfClient } from "../../src/bnf/client.js";
import { runFindDigitised } from "../../src/tools/findDigitised.js";
import { runGetAuthor } from "../../src/tools/getAuthor.js";
import { getWorkOutput, runGetWork } from "../../src/tools/getWork.js";
import { runListEditions } from "../../src/tools/listEditions.js";
import {
  FIXED_NOW,
  fakeEndpoint,
  notesOf,
  payloadOf,
  silentLogger,
  testConfig,
  textOf,
} from "./helpers.js";
import type { Reply } from "./helpers.js";

const on = (replies: Reply[]) => {
  const endpoint = fakeEndpoint(replies);
  return {
    endpoint,
    client: new BnfClient({
      config: testConfig(),
      logger: silentLogger,
      fetchImpl: endpoint.fetchImpl,
    }),
  };
};

/** Runs a call that sends more than one request, on a pinned clock. */
async function paced<T>(call: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ now: FIXED_NOW });
  try {
    const pending = call();
    await vi.runAllTimersAsync();
    return await pending;
  } finally {
    vi.useRealTimers();
  }
}

/** find_digitised reads what the address is before it follows a path. */
function digitisedForPerson() {
  const { client } = on([{ fixture: "types-person" }, { fixture: "digitised-person" }]);
  return paced(() => runFindDigitised(client, { id: "cb100000001", kind: "auto", limit: 40 }));
}

describe("addresses the catalogue aligns a record with", () => {
  it("says this server neither builds them nor opens them", async () => {
    const { client } = on([{ fixture: "author-detail" }]);
    const result = await runGetAuthor(client, {
      author_id: "cb100000001",
      include_depictions: false,
    });

    const notes = notesOf(result).join(" ");
    expect(notes).toContain("as the catalogue publishes them");
    expect(notes).toContain("does not open them");
  });

  it("passes an accented address on exactly as the catalogue publishes it", async () => {
    const { client } = on([{ fixture: "author-detail" }]);
    const result = await runGetAuthor(client, {
      author_id: "cb100000001",
      include_depictions: false,
    });

    const author = payloadOf(result).author as { same_as: Record<string, string[]> };
    expect(author.same_as.wikipedia).toEqual([
      "http://fr.wikipedia.org/wiki/Camille_Ardouin_%28po%C3%A8te%29",
    ]);
  });
});

describe("find_digitised", () => {
  it("names its counters for the links it returned", async () => {
    const result = await digitisedForPerson();
    const payload = payloadOf(result);

    expect(payload.counts).toBeUndefined();
    expect(payload.links_returned_by_role).toEqual({ reproduction: 1, ocr: 1, depiction: 2 });
  });

  it("says which addresses ask for a rendering rather than the document", async () => {
    const result = await digitisedForPerson();
    const links = payloadOf(result).links as Record<string, unknown>[];

    const document = links.find(
      (link) => link.url === "https://gallica.bnf.fr/ark:/12148/bpt6k90000030",
    );
    const thumbnail = links.find(
      (link) => link.url === "https://gallica.bnf.fr/ark:/12148/btv1b90000001.thumbnail",
    );

    expect(document!.rendering).toBeNull();
    expect(thumbnail!.rendering).toBe("thumbnail");
    expect(notesOf(result).join(" ")).toContain("rendering of a document rather than the document");
  });
});

describe("get_author", () => {
  it("reads one text stated under two fields as one statement", async () => {
    const { client } = on([{ fixture: "author-detail" }]);
    const result = await runGetAuthor(client, {
      author_id: "cb100000001",
      include_depictions: false,
    });

    expect(notesOf(result).join(" ")).toContain(
      "states the same text under 'biographical_information' and 'occupation'",
    );
  });

  it("keeps the Gallica caveat off an answer carrying no link", async () => {
    const { client } = on([{ fixture: "author-detail" }]);
    const quiet = await runGetAuthor(client, {
      author_id: "cb100000001",
      include_depictions: false,
    });
    expect(notesOf(quiet).join(" ")).not.toContain("never requests gallica.bnf.fr");

    const { client: second } = on([{ fixture: "author-detail" }]);
    const full = await runGetAuthor(second, {
      author_id: "cb100000001",
      include_depictions: true,
    });
    expect(notesOf(full).join(" ")).toContain("never requests gallica.bnf.fr");
  });
});

describe("get_work", () => {
  it("keeps the Gallica caveat off an answer carrying no link", async () => {
    const { client } = on([{ fixture: "work-detail" }]);
    const quiet = await runGetWork(client, { work_id: "cb100000010", include_depictions: false });
    expect(notesOf(quiet).join(" ")).not.toContain("never requests gallica.bnf.fr");

    const { client: second } = on([{ fixture: "work-detail" }]);
    const full = await runGetWork(second, { work_id: "cb100000010", include_depictions: true });
    expect(notesOf(full).join(" ")).toContain("never requests gallica.bnf.fr");
  });

  it("says the alignments it carries are the catalogue's own and unopened", async () => {
    const { client } = on([{ fixture: "work-detail" }]);
    const result = await runGetWork(client, { work_id: "cb100000010", include_depictions: false });

    const notes = notesOf(result).join(" ");
    expect(notes).toContain("as the catalogue publishes them");
    expect(notes).toContain("does not open them");
  });

  it("says what a null catalogue_url is", () => {
    const description = getWorkOutput.shape.work.shape.catalogue_url.description ?? "";
    expect(description).toContain("states none");
  });
});

describe("the types an identifier is refused under", () => {
  it("are the ones the address itself answers with, whichever tool asked", async () => {
    // A detail query gathers the classes of the heading beside those of the
    // thing, so a refusal built from it names a longer list than the one the
    // address answers with, and two tools then describe one record differently.
    const { client, endpoint } = on([{ fixture: "author-name-only" }, { fixture: "types-person" }]);
    const result = await paced(() =>
      runGetWork(client, { work_id: "cb100000005", include_depictions: false }),
    );

    expect(textOf(result)).toContain("http://xmlns.com/foaf/0.1/Person");
    expect(textOf(result)).not.toContain("skos/core#Concept");
    expect(endpoint.requests).toHaveLength(2);
  });
});

describe("list_editions", () => {
  it("says what the cataloguer's square brackets mean", async () => {
    const { client } = on([{ fixture: "editions" }]);
    const result = await runListEditions(client, { work_id: "cb100000010", limit: 25, page: 1 });

    const notes = notesOf(result).join(" ");
    expect(notes).toContain("Square brackets");
    expect(notes).toContain("[s.n.]");

    const editions = payloadOf(result).editions as Record<string, unknown>[];
    const undated = editions.find((edition) => edition.id === "cb100000032");
    expect(undated!.publisher).toBe("[s.n.]");
    expect(undated!.place).toBe("[S.l.]");
  });
});
