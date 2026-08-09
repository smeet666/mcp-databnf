/**
 * One real query per route, run against data.bnf.fr.
 *
 * The unit tests read generated fixtures, so they cannot notice that the BnF
 * renamed a predicate or that the endpoint stopped answering in JSON: the day
 * that happens they stay green while the published server is broken for
 * everyone. This suite is what notices, and the nightly canary is where it runs.
 *
 * It is opt-in because data.bnf.fr is a service a public institution pays for,
 * and a test suite has no business adding load to it on every push. Set
 * BNF_LIVE=1 to run it.
 *
 * The assertions are about shape rather than about content. A catalogue changes:
 * a record gains an alignment, a work gains an edition, and a test asserting a
 * count would fail on a normal Tuesday. What must not change is that a person
 * lookup answers with a person, that a search that does not rank still says so,
 * and that an absence still arrives as an absence carrying a code.
 */

import { describe, expect, it } from "vitest";
import { BnfClient } from "../../src/bnf/client.js";
import { runFindDigitised } from "../../src/tools/findDigitised.js";
import { runGetAuthor } from "../../src/tools/getAuthor.js";
import { runGetWork } from "../../src/tools/getWork.js";
import { runListEditions } from "../../src/tools/listEditions.js";
import { runListWorks } from "../../src/tools/listWorks.js";
import { runSearchAuthors } from "../../src/tools/searchAuthors.js";
import { runSearchWorks } from "../../src/tools/searchWorks.js";

const live = process.env.BNF_LIVE === "1" ? describe : describe.skip;

/** Arthur Rimbaud: the BnF keeps two authority records for him. */
const RIMBAUD = "cb119219976";
/** Une saison en enfer, an established work with digitised editions. */
const SAISON = "cb11970626n";

const client = new BnfClient();

const structured = (result: { structuredContent?: Record<string, unknown> }) => {
  expect(result.structuredContent).toBeDefined();
  return result.structuredContent as Record<string, unknown>;
};

const show = (label: string, result: { content: Array<{ text: string }> }) => {
  if (process.env.BNF_SHOW === "1") {
    process.stderr.write(`\n──────── ${label}\n${result.content[0]?.text ?? ""}\n`);
  }
};

live("data.bnf.fr, live", () => {
  it("search_authors returns both Rimbaud records rather than choosing one", async () => {
    const result = await runSearchAuthors(client, { name: "Arthur Rimbaud", limit: 10, page: 1 });
    show("search_authors", result);
    const payload = structured(result);
    const authors = payload.authors as Array<{ id: string; name: string | null }>;

    expect(authors.length).toBeGreaterThan(0);
    expect(authors.map((author) => author.id)).toContain(RIMBAUD);
    // The second heading is what makes disambiguation a real problem here.
    expect(authors.filter((author) => author.name === "Arthur Rimbaud").length).toBeGreaterThan(1);
    expect(payload.retrieved_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.content[0]?.text).toContain("Source: data.bnf.fr");
    expect(result.content[0]?.text).toContain("retrieved ");
  });

  it("get_author reads the dates, the places and the alignments", async () => {
    const result = await runGetAuthor(client, { author_id: RIMBAUD, include_depictions: false });
    show("get_author", result);
    const author = structured(result).author as Record<string, unknown>;

    expect(author.name).toBe("Arthur Rimbaud");
    expect(author.birth_year).toBe(1854);
    expect(author.death_year).toBe(1891);
    expect(author.birth_place).toContain("Charleville");
    expect(author.death_place).toContain("Marseille");
    const sameAs = author.same_as as Record<string, string[]>;
    expect(Object.keys(sameAs)).toContain("viaf");
    expect(Object.keys(sameAs)).toContain("idref");
  });

  it("search_works finds works and says the order is not a ranking", async () => {
    const result = await runSearchWorks(client, { title: "saison enfer", limit: 10, page: 1 });
    show("search_works", result);
    const payload = structured(result);
    const works = payload.works as Array<{ id: string; status: string }>;

    expect(works.length).toBeGreaterThan(0);
    expect((payload.notes as string[]).join(" ")).toContain("does not score");
    for (const work of works) expect(["established", "provisional"]).toContain(work.status);
  });

  it("get_work tells an established record from a provisional one", async () => {
    const result = await runGetWork(client, { work_id: SAISON, include_depictions: false });
    show("get_work", result);
    const work = structured(result).work as Record<string, unknown>;

    expect(work.status).toBe("established");
    expect(work.title).toContain("saison");
    expect(work.expression_count).toBeGreaterThan(0);
    expect((work.creators as Array<{ id: string }>).map((c) => c.id)).toContain(RIMBAUD);
  });

  it("list_editions returns imprints, and links a digitised copy without opening it", async () => {
    const result = await runListEditions(client, { work_id: SAISON, limit: 20, page: 1 });
    show("list_editions", result);
    const payload = structured(result);
    const editions = payload.editions as Array<{
      publisher: string | null;
      digitised: Array<{ url: string }>;
    }>;

    expect(editions.length).toBeGreaterThan(0);
    expect(editions.some((edition) => edition.publisher !== null)).toBe(true);
    const links = editions.flatMap((edition) => edition.digitised);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link.url).toContain("gallica.bnf.fr");
  });

  it("find_digitised gathers links for a person and reports what they are", async () => {
    const result = await runFindDigitised(client, { id: RIMBAUD, kind: "auto", limit: 20 });
    show("find_digitised", result);
    const payload = structured(result);

    expect(payload.kind).toBe("person");
    const links = payload.links as Array<{ url: string; role: string }>;
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link.url).toContain("gallica.bnf.fr");
    expect((payload.notes as string[]).join(" ")).toContain("never requests gallica.bnf.fr");
  });

  it("list_works walks from a person to the works credited to them, and says what the link misses", async () => {
    const result = await runListWorks(client, { author_id: RIMBAUD, limit: 10, page: 1 });
    show("list_works", result);
    const payload = structured(result);
    const works = payload.works as Array<{ id: string; status: string; forms: string[] }>;

    expect(works.length).toBeGreaterThan(0);
    for (const work of works) expect(["established", "provisional"]).toContain(work.status);
    const notes = (payload.notes as string[]).join(" ");
    expect(notes).toContain("not a bibliography");
    expect(notes).toContain("cannot be narrowed");
    expect(Object.keys(payload)).not.toContain("total");
  });

  it("an identifier the BnF describes nowhere comes back as an absence, not as an empty record", async () => {
    const result = await runGetAuthor(client, {
      author_id: "cb000000000",
      include_depictions: false,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("[not_found]");
  });
});
