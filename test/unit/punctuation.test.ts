/**
 * The one character this project's writing rules forbid outright.
 *
 * An em dash reads as this server's own punctuation wherever it lands: in a
 * comment, in a description a model is handed, and in the credit line every
 * answer ends with. A comma, a colon, parentheses or a separate sentence
 * replaces it everywhere, so the rule is worth more than a habit.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "..", "..", "src");

/**
 * Where the character is the data rather than the punctuation.
 *
 * Each entry names why the file carries it, so an exception stays an exception.
 */
const ALLOWED: Record<string, string> = {};

function everyFile(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return everyFile(path);
    }
    return path.endsWith(".ts") ? [path] : [];
  });
}

describe("the em dash", () => {
  it("is written nowhere under src", () => {
    const carrying = everyFile(SRC)
      .filter((path) => readFileSync(path, "utf8").includes("—"))
      .map((path) => path.slice(SRC.length + 1).replaceAll("\\", "/"))
      .filter((relative) => ALLOWED[relative] === undefined);

    expect(carrying, "an em dash is punctuation this project replaces").toEqual([]);
  });
});
