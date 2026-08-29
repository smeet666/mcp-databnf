/**
 * What the README says about the server, held against the server itself.
 *
 * The README is read twice over: by a person, who wants to know what the site
 * holds and what can be asked of it, and by a program installing the server on
 * its own, which needs the package name, every argument and every setting
 * written out. The second reader is the one a test can defend, so these
 * assertions state the agreement between the file and the code rather than the
 * wording of either.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_USER_AGENT, createLogger, loadConfig } from "../../src/config.js";
import { createServer } from "../../src/server.js";

/** The one thing that differs from one repository to the next. */
const ENV_PREFIX = "BNF_";

const ROOT = join(import.meta.dirname, "..", "..");
const readme = readFileSync(join(ROOT, "README.md"), "utf8");
const configSource = readFileSync(join(ROOT, "src", "config.ts"), "utf8");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  name: string;
  version: string;
};

const FRENCH_TITLE = `# ${pkg.name} (français)`;
const splitAt = readme.indexOf(FRENCH_TITLE);
const english = readme.slice(0, splitAt === -1 ? readme.length : splitAt);
const french = splitAt === -1 ? "" : readme.slice(splitAt);

const ENGLISH_SECTIONS = [
  "## Install",
  "### With Docker",
  "### Bundle, without npm",
  "## What you can ask",
  "## Tools",
  "## Configuration",
  "## Errors",
  "## As a library",
  "## Pacing and attribution",
  "## Privacy",
  "## Development",
  "## Contributing",
  "## License",
];

const FRENCH_SECTIONS = [
  "## Installation",
  "### Avec Docker",
  "### Bundle, sans npm",
  "## Ce qu'on peut demander",
  "## Les outils",
  "## Configuration",
  "## Erreurs",
  "## Comme bibliothèque",
  "## Rythme et attribution",
  "## Confidentialité",
  "## Développement",
  "## Contribuer",
  "## Licence",
];

/**
 * Turns of phrase that read as written by a machine rather than by a person,
 * and comparisons with a state the current version never had.
 */
const REFUSED_WORDING: [RegExp, string][] = [
  [/,\s+not\s+/, "the antithetical 'X, not Y'"],
  [/\bnot just\b/i, "'not just'"],
  [/\bn'est pas seulement\b/i, "'n'est pas seulement'"],
  [/\bnon pas\b/i, "'non pas'"],
  [/\bbut rather\b/i, "'but rather'"],
  [
    /\bne (rend|donne|renvoie|fait|dit|porte|compte) pas [^,.]{0,40}, (il|elle|ils|elles)\b/i,
    "a negation set up to carry an affirmation",
  ],
  [
    /\b(returns|gives|carries|says|holds|counts) no [^,.]{0,40}, it\b/i,
    "a negation set up to carry an affirmation",
  ],
  [/\bno longer\b/i, "a comparison with a past state"],
  [/\bpreviously\b/i, "a comparison with a past state"],
  [/\bdésormais\b/i, "a comparison with a past state"],
  [/\bcontrairement à\b/i, "a comparison with a past state"],
  [/\bLLMs?\b/, "the jargon 'LLM'"],
  [/\bagentic\b/i, "the jargon 'agentic'"],
  [/\bprompt engineering\b/i, "the jargon 'prompt engineering'"],
];

const alphabetically = (a: string, b: string) => a.localeCompare(b);

/** The rows of a markdown table whose header opens with the given cell. */
function tableRows(section: string, header: string): string[][] {
  const lines = section.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`| ${header}`));
  if (start === -1) {
    return [];
  }
  const rows: string[][] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) {
      break;
    }
    rows.push(
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
  }
  return rows;
}

/** The `### \`tool\`` blocks of one half, keyed by the tool they name. */
function toolSections(half: string): Map<string, string> {
  const sections = new Map<string, string>();
  let current: string | null = null;
  let body: string[] = [];
  const close = () => {
    if (current !== null) {
      sections.set(current, body.join("\n"));
    }
  };
  for (const line of half.split("\n")) {
    const heading = /^### `([a-z_]+)`\s*$/.exec(line);
    if (heading?.[1]) {
      close();
      current = heading[1];
      body = [];
      continue;
    }
    if (line.startsWith("## ") || (line.startsWith("### ") && current !== null)) {
      close();
      current = null;
      body = [];
      continue;
    }
    if (current !== null) {
      body.push(line);
    }
  }
  close();
  return sections;
}

function backticked(cell: string): string {
  return cell.replace(/`/g, "").trim();
}

let tools: { name: string; inputSchema: { properties?: Record<string, unknown> } }[] = [];

beforeAll(async () => {
  const server = createServer({
    config: loadConfig({}),
    logger: createLogger("silent"),
    fetchImpl: (async () => Response.json({})) as unknown as typeof fetch,
  });
  const client = new Client({ name: "test", version: "0.0.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  const listed = await client.listTools();
  tools = listed.tools as typeof tools;
  await server.close();
});

describe("the two halves", () => {
  it("are both there, English first", () => {
    expect(splitAt).toBeGreaterThan(0);
    expect(english).toContain(`# ${pkg.name}\n`);
  });

  it("each carry every section, in the same order", () => {
    for (const [half, sections, language] of [
      [english, ENGLISH_SECTIONS, "English"],
      [french, FRENCH_SECTIONS, "French"],
    ] as const) {
      let previous = -1;
      for (const section of sections) {
        const at = half.indexOf(`\n${section}\n`);
        expect(at, `${language} half is missing "${section}"`).toBeGreaterThan(-1);
        expect(at, `${language} half has "${section}" out of order`).toBeGreaterThan(previous);
        previous = at;
      }
    }
  });

  it("link to each other through anchors that exist", () => {
    const anchor = `${pkg.name}-français`;

    expect(english).toContain(`(#${anchor})`);
    expect(readme).toContain(`<a name="${anchor}"></a>`);
    expect(french).toContain(`(#${pkg.name})`);
  });
});

describe("what a reader is told to run", () => {
  it("names the package this repository publishes", () => {
    for (const half of [english, french]) {
      expect(half).toContain(`npx -y ${pkg.name}`);
      expect(half).toContain("claude mcp add");
    }
  });

  it("names the image tag of the version being published", () => {
    for (const half of [english, french]) {
      expect(half).toContain(`ghcr.io/smeet666/${pkg.name}:${pkg.version}`);
    }
  });

  it("points at the bundle of the latest release", () => {
    for (const half of [english, french]) {
      expect(half).toContain("/releases/latest");
    }
  });
});

describe("the tools", () => {
  it("each have a section of their own, in both halves", () => {
    const registered = tools.map((tool) => tool.name).sort(alphabetically);

    for (const [half, language] of [
      [english, "English"],
      [french, "French"],
    ] as const) {
      const documented = [...toolSections(half).keys()].sort(alphabetically);
      expect(documented, `the ${language} half documents another set of tools`).toEqual(registered);
    }
  });

  it("document every argument their schema declares, and no other", () => {
    for (const [half, language] of [
      [english, "English"],
      [french, "French"],
    ] as const) {
      const sections = toolSections(half);
      for (const tool of tools) {
        const section = sections.get(tool.name) ?? "";
        const declared = Object.keys(tool.inputSchema.properties ?? {}).sort(alphabetically);
        const documented = tableRows(section, "Argument")
          .map((row) => backticked(row[0] ?? ""))
          .sort(alphabetically);
        expect(documented, `${tool.name} in the ${language} half`).toEqual(declared);
      }
    }
  });
});

describe("the settings", () => {
  it("are the ones the code reads, and all of them", () => {
    const pattern = new RegExp(`\\b(${ENV_PREFIX}[A-Z_]+)\\b`, "g");
    const read = [...configSource.matchAll(pattern)].map((match) => match[1] as string);

    for (const half of [english, french]) {
      const announced = tableRows(half.slice(half.indexOf("## Configuration")), "Variable").map(
        (row) => backticked(row[0] ?? ""),
      );
      expect([...new Set(announced)].sort(alphabetically)).toEqual(
        [...new Set(read)].sort(alphabetically),
      );
    }
  });

  it("announce the value that changes nothing when it is set", () => {
    const untouched = loadConfig({});
    const rows = tableRows(english.slice(english.indexOf("## Configuration")), "Variable");

    for (const row of rows) {
      const name = backticked(row[0] ?? "");
      const announced = backticked(row[1] ?? "");
      // A default the table states in prose, or as a dash, is not a value to set.
      if (!(row[1] ?? "").includes("`")) {
        continue;
      }
      if (name === `${ENV_PREFIX}USER_AGENT`) {
        expect(untouched.userAgent).toBe(DEFAULT_USER_AGENT);
        continue;
      }
      expect(loadConfig({ [name]: announced }), `${name} announces ${announced}`).toEqual(
        untouched,
      );
    }
  });
});

describe("the wording", () => {
  it("carries none of the turns of phrase this project refuses", () => {
    for (const [pattern, what] of REFUSED_WORDING) {
      const found = pattern.exec(readme);
      expect(found, `README.md carries ${what}: "${found?.[0] ?? ""}"`).toBeNull();
    }
  });
});
