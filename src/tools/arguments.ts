/**
 * How a tool's arguments are declared, and what happens to one that is not.
 *
 * An argument this server does not declare is a question it cannot answer.
 * Reading it and dropping it produces an answer computed on the defaults, which
 * a caller reads as the answer to what they asked. So an undeclared argument is
 * refused, and the refusal names it and offers the declared name when one is
 * close enough to be the one that was meant.
 */

import { z } from "zod";

/** The code a caller branches on when the arguments cannot produce a request. */
const INVALID_INPUT = "invalid_input";

/** Declare a tool's arguments, refusing anything outside the declaration. */
export function strictInput<Shape extends z.ZodRawShape>(shape: Shape) {
  const declared = Object.keys(shape);

  return z.strictObject(shape, {
    error: (issue) =>
      issue.code === "unrecognized_keys" ? unknownArgumentMessage(issue.keys, declared) : undefined,
  });
}

function unknownArgumentMessage(keys: readonly string[], declared: readonly string[]): string {
  const named = keys
    .map((key) => {
      const near = nearestArgument(key, declared);
      return near ? `'${key}' (did you mean '${near}'?)` : `'${key}'`;
    })
    .join(", ");

  return (
    `[${INVALID_INPUT}] Unknown ${keys.length > 1 ? "arguments" : "argument"} ${named}. ` +
    `This tool takes: ${declared.join(", ")}.`
  );
}

/**
 * The declared name a caller most plausibly meant, when there is one.
 *
 * Three readings, ordered by how much each claims: the same name written
 * differently, a name that opens or closes the other, and a name a couple of
 * typing slips away. Anything further is left unnamed, because a suggestion
 * that misses sends a caller to an argument answering a different question.
 */
function nearestArgument(key: string, declared: readonly string[]): string | undefined {
  const flatten = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const flat = flatten(key);
  if (flat.length === 0) return undefined;

  const sameName = declared.find((name) => flatten(name) === flat);
  if (sameName) return sameName;

  // Either name may be the longer one: a caller can qualify a name this tool
  // keeps plain, or shorten one it spells out.
  const overlapping = declared.find((name) => {
    const other = flatten(name);
    const [shorter, longer] = other.length < flat.length ? [other, flat] : [flat, other];
    // Two characters in common say nothing; three start to.
    return shorter.length >= 3 && (longer.startsWith(shorter) || longer.endsWith(shorter));
  });
  if (overlapping) return overlapping;

  let closest: string | undefined;
  let shortest = Number.POSITIVE_INFINITY;
  for (const name of declared) {
    const distance = editDistance(flat, flatten(name));
    if (distance < shortest) {
      shortest = distance;
      closest = name;
    }
  }

  // Up to a third of the name may differ. Past that the match is a guess.
  return shortest <= Math.max(1, Math.floor(flat.length / 3)) ? closest : undefined;
}

/**
 * Single-character insertions, deletions and substitutions between two words.
 *
 * One row of the matrix is kept at a time. The cell above comes from walking
 * that row, and the two other neighbours a cell needs, the one to its left and
 * the one diagonally above it, are carried forward from the step before, so
 * every value the walk uses is one it has just computed.
 */
function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  let distance = right.length;

  for (let row = 1; row <= left.length; row += 1) {
    const current: number[] = [row];
    let diagonal = row - 1;
    let leftward = row;

    for (const [column, above] of previous.entries()) {
      if (column === 0) {
        continue;
      }
      const substitution = diagonal + (left[row - 1] === right[column - 1] ? 0 : 1);
      const cell = Math.min(substitution, above + 1, leftward + 1);
      current.push(cell);
      diagonal = above;
      leftward = cell;
    }

    previous = current;
    distance = leftward;
  }

  return distance;
}
