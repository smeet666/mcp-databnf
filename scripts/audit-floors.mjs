#!/usr/bin/env node
/**
 * Audits the lowest versions the manifest accepts, rather than the ones the
 * lockfile installs.
 *
 * The published archive carries no lockfile, so a consumer resolves against the
 * ranges alone. `npm audit` reads the installed tree and reports that tree, so a
 * floor naming a version with a known advisory passes it in silence. This
 * resolves every direct range to its lowest published match, builds a tree from
 * those, and audits it.
 *
 * Only the production dependencies are read, since those are what a consumer
 * resolves. A development tool is declared at one exact version, so what it
 * declares is what it installs and `npm audit` judges it already.
 *
 * Transitive dependencies are resolved as npm resolves them, since only the
 * direct ranges are ours to move.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const SEVERITY_ORDER = ["critical", "high", "moderate", "low", "info"];

/** Runs npm and hands back stdout, with the registry noise dropped. */
function npm(args, options = {}) {
  return execFileSync("npm", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    ...options,
  });
}

/**
 * The lowest published version satisfying a range.
 *
 * `npm view <name>@<range> version --json` answers an ascending array when
 * several versions match and a bare string when one does.
 */
function floorOf(name, range) {
  const answer = JSON.parse(npm(["view", `${name}@${range}`, "version", "--json"]));
  const versions = Array.isArray(answer) ? answer : [answer];
  if (versions.length === 0) {
    throw new Error(`no published version satisfies ${name}@${range}`);
  }
  return versions[0];
}

const declared = JSON.parse(npm(["pkg", "get", "dependencies"]));

const floors = {};
for (const [name, range] of Object.entries(declared)) {
  floors[name] = floorOf(name, range);
  const moved = floors[name] === range ? "" : `  (${range})`;
  console.log(`  ${name}@${floors[name]}${moved}`);
}

const work = mkdtempSync(join(tmpdir(), "audit-floors-"));
let report;
try {
  writeFileSync(
    join(work, "package.json"),
    `${JSON.stringify({ name: "floors", version: "0.0.0", dependencies: floors }, null, 2)}\n`,
  );
  npm(["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: work,
  });
  try {
    report = JSON.parse(npm(["audit", "--json"], { cwd: work }));
  } catch (failure) {
    // npm audit exits non-zero the moment it finds something, and its report is
    // still on stdout.
    report = JSON.parse(failure.stdout);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

const found = Object.values(report.vulnerabilities ?? {}).filter(
  (entry) => entry.severity !== "info",
);
if (found.length === 0) {
  console.log("\nNo advisory against the lowest versions these ranges accept.");
  process.exit(0);
}

found.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
console.error(`\n${found.length} package(s) carry an advisory at the accepted floor:\n`);
for (const entry of found) {
  console.error(`  ${entry.severity.padEnd(9)} ${entry.name}  range ${entry.range}`);
  for (const via of entry.via) {
    if (typeof via === "object") {
      console.error(`            ${via.title}`);
    }
  }
  const fix = entry.fixAvailable;
  if (fix && typeof fix === "object") {
    console.error(`            raise the floor to ${fix.version} or later`);
  }
}
console.error("\nRaise the floor of the range in package.json to a version the advisory clears.");
process.exit(1);
