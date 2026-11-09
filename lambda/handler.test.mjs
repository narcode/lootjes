// Run after ./build.sh:   node --test lambda/
// Uses the real wasm decoder and made-up tickets. Needs no AWS and no real links.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { loadLootjes } from "../web/wasm.js";
import { hashCode, permissions } from "./access.mjs";
import { createHandler } from "./handler.mjs";

const lootjes = await loadLootjes(await readFile(new URL("../web/lootjes.wasm", import.meta.url)));

const anna = lootjes.encode(["Anna", "Bram", "Daan", "Eva"]);
const zoe = lootjes.encode(["Zoë", "Anna", "Bram", "🎅"]);

const allowedHashes = new Set([anna, zoe].map(hashCode));
const handler = createHandler({ decode: lootjes.decode, allowedHashes });

const raw = (body, extra = {}) => handler({ requestContext: { http: { method: "POST" } }, body, ...extra });
const post = (body) => raw(JSON.stringify(body));
const json = (res) => JSON.parse(res.body);

test("a sent link is recognised", async () => {
  const res = await post({ code: anna, action: "whoami" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(json(res), { name: "Anna", picks: ["Bram", "Daan", "Eva"] });
});

test("unicode names survive", async () => {
  const res = await post({ code: zoe, action: "whoami" });
  assert.deepEqual(json(res), { name: "Zoë", picks: ["Anna", "Bram", "🎅"] });
});

test("Function URLs may base64 the body", async () => {
  const body = Buffer.from(JSON.stringify({ code: anna, action: "whoami" })).toString("base64");
  assert.equal((await raw(body, { isBase64Encoded: true })).statusCode, 200);
});

test("a well-formed link that was never sent is refused", async () => {
  // This is how you'd guess a draw: a valid code with someone's real name and made-up picks.
  const forged = lootjes.encode(["Anna", "Bram", "Daan", "Fenna"]);
  assert.ok(lootjes.decode(forged), "the forged code does decode");
  const res = await post({ code: forged, action: "whoami" });
  assert.equal(res.statusCode, 403);
});

test("every bad request gets the same answer", async () => {
  const bad = [
    await post({ code: "nonsense", action: "whoami" }),
    await post({ code: 42, action: "whoami" }),
    await post({ action: "whoami" }),
    await post(null),
    await raw("{not json"),
    await raw(undefined),
  ];
  for (const res of bad) {
    assert.equal(res.statusCode, 403);
    assert.deepEqual(json(res), { error: "forbidden" });
  }
});

test("unknown codes never reach the decoder", async () => {
  const noDecode = () => assert.fail("decode was called");
  const guarded = createHandler({ decode: noDecode, allowedHashes });
  const res = await guarded({
    requestContext: { http: { method: "POST" } },
    body: JSON.stringify({ code: "unknown", action: "whoami" }),
  });
  assert.equal(res.statusCode, 403);
});

test("only POST is accepted", async () => {
  const res = await handler({ requestContext: { http: { method: "GET" } } });
  assert.equal(res.statusCode, 405);
});

test("an unknown action is rejected", async () => {
  assert.equal((await post({ code: anna, action: "explode" })).statusCode, 400);
});

test("permissions follow the ticket", () => {
  const ticket = { name: "Anna", picks: ["Bram", "Daan", "Eva"] };
  assert.deepEqual(permissions(ticket, "Anna"), { read: true, edit: true, claim: false });
  assert.deepEqual(permissions(ticket, "Bram"), { read: true, edit: false, claim: true });
  assert.deepEqual(permissions(ticket, "Fenna"), { read: false, edit: false, claim: false });
});
