// Turns the links that were sent into lambda/config.json (git-ignored).
// Run after ./build.sh:   node scripts/make-lambda-config.mjs ~/lootjes-links.txt
// Prints only counts: no names, no codes, no hashes, so the draw stays secret.

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { hashCode } from "../lambda/access.mjs";
import { loadLootjes } from "../web/wasm.js";

const N = 7, K = 3;
const OUT = new URL("../lambda/config.json", import.meta.url);

function fail(message) {
  console.error(`Stopped: ${message}`);
  process.exit(1);
}

const file = process.argv[2] ?? fail("give the path of the links file.");
const lootjes = await loadLootjes(readFileSync(new URL("../web/lootjes.wasm", import.meta.url)));

// A line may be a full link, or have text in front of it: the code is what follows the last #.
const codes = readFileSync(file, "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => line.slice(line.lastIndexOf("#") + 1));

const tickets = codes.map(lootjes.decode);
const broken = tickets.filter((t) => !t).length;
if (broken) fail(`${broken} line(s) are not valid links.`);
if (codes.length !== N) fail(`expected ${N} links, found ${codes.length}.`);

// The links must be one complete draw, or someone would end up with an empty pick.
const people = new Set(tickets.map(([name]) => name));
if (people.size !== N) fail(`expected ${N} different people, found ${people.size}.`);
if (tickets.some((t) => t.length !== K + 1)) fail(`not everyone drew ${K} names.`);

const drawn = (person) => tickets.filter(([, ...picks]) => picks.includes(person)).length;
if ([...people].some((p) => drawn(p) !== K)) fail(`not everyone is drawn exactly ${K} times.`);

// Keep an existing secret: a new one would make every existing claim impossible to undo.
const claimSecret = existsSync(OUT)
  ? JSON.parse(readFileSync(OUT, "utf8")).claimSecret
  : randomBytes(32).toString("hex");

writeFileSync(OUT, JSON.stringify({ allowedHashes: codes.map(hashCode), claimSecret }), { mode: 0o600 });
console.log(`OK: ${N} links, ${N} people, each drew ${K} names and is drawn ${K} times. Wrote lambda/config.json.`);
