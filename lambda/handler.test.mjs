// Run after ./build.sh:   node --test lambda/
// Uses the real wasm decoder, made-up tickets and an in-memory stand-in for S3.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { loadLootjes } from "../web/wasm.js";
import { hashCode } from "./access.mjs";
import { createHandler } from "./handler.mjs";

const lootjes = await loadLootjes(await readFile(new URL("../web/lootjes.wasm", import.meta.url)));

// Anna and Zoë both drew Bram, so they are the two buyers in the claim tests.
const anna = lootjes.encode(["Anna", "Bram", "Daan", "Eva"]);
const bram = lootjes.encode(["Bram", "Anna", "Daan", "Zoë"]);
const zoe = lootjes.encode(["Zoë", "Anna", "Bram", "🎅"]);

const allowedHashes = new Set([anna, bram, zoe].map(hashCode));
const POST = { requestContext: { http: { method: "POST" } } };

// Behaves like S3 with If-Match: a save based on old data is refused.
function memoryStore() {
  let json = JSON.stringify({ lists: {} });
  let version = 0;
  return {
    saves: 0,
    async load() {
      return { state: JSON.parse(json), etag: version };
    },
    async save(state, etag) {
      this.saves++;
      if (etag !== version) return false;
      json = JSON.stringify(state);
      version++;
      return true;
    },
    raw: () => json,
  };
}

function setup({ store = memoryStore(), decode = lootjes.decode } = {}) {
  const handler = createHandler({ decode, allowedHashes, store, claimSecret: "test-secret" });
  const raw = (body, extra = {}) => handler({ ...POST, body, ...extra });
  const post = (body) => raw(JSON.stringify(body));
  const as = (code, action, fields = {}) => post({ code, action, ...fields });
  return { handler, raw, post, as, store };
}

const json = (res) => JSON.parse(res.body);
const bramsItems = (res) => json(res).picks.find((p) => p.name === "Bram").items;

// Bram adds one wish and returns its id.
async function wish({ as }, text = "Sokken") {
  return json(await as(bram, "add", { text })).own.at(-1).id;
}

// --- who is asking -----------------------------------------------------------

test("a sent link gets its own name and picks", async () => {
  const res = await setup().as(anna, "read");
  assert.equal(res.statusCode, 200);
  assert.deepEqual(json(res), {
    name: "Anna",
    own: [],
    picks: ["Bram", "Daan", "Eva"].map((name) => ({ name, items: [] })),
  });
});

test("unicode names survive", async () => {
  const body = json(await setup().as(zoe, "read"));
  assert.equal(body.name, "Zoë");
  assert.deepEqual(body.picks.map((p) => p.name), ["Anna", "Bram", "🎅"]);
});

test("Function URLs may base64 the body", async () => {
  const body = Buffer.from(JSON.stringify({ code: anna, action: "read" })).toString("base64");
  assert.equal((await setup().raw(body, { isBase64Encoded: true })).statusCode, 200);
});

test("a well-formed link that was never sent is refused", async () => {
  // This is how you'd guess a draw: a valid code with someone's real name and made-up picks.
  const forged = lootjes.encode(["Anna", "Bram", "Daan", "Fenna"]);
  assert.ok(lootjes.decode(forged), "the forged code does decode");
  assert.equal((await setup().as(forged, "read")).statusCode, 403);
});

test("every bad request gets the same answer", async () => {
  const { post, raw } = setup();
  const bad = [
    await post({ code: "nonsense", action: "read" }),
    await post({ code: 42, action: "read" }),
    await post({ action: "read" }),
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
  const { as } = setup({ decode: () => assert.fail("decode was called") });
  assert.equal((await as("unknown", "read")).statusCode, 403);
});

test("only POST is accepted", async () => {
  const { handler } = setup();
  assert.equal((await handler({ requestContext: { http: { method: "GET" } } })).statusCode, 405);
});

test("unknown actions are rejected, including inherited object keys", async () => {
  const { as } = setup();
  for (const action of ["explode", "constructor", "toString", undefined]) {
    assert.equal((await as(anna, action)).statusCode, 400, String(action));
  }
});

// --- your own list -----------------------------------------------------------

test("you can add to and remove from your own list", async () => {
  const s = setup();
  const id = await wish(s);
  assert.deepEqual(json(await s.as(bram, "read")).own, [{ id, text: "Sokken" }]);
  assert.deepEqual(json(await s.as(bram, "remove", { id })).own, []);
});

test("bad wishes are refused and not saved", async () => {
  const s = setup();
  for (const text of ["", "   ", 42, undefined, "x".repeat(301)]) {
    assert.equal((await s.as(bram, "add", { text })).statusCode, 400);
  }
  assert.equal(s.store.saves, 0);
});

test("a list has a maximum size", async () => {
  const s = setup();
  for (let i = 0; i < 30; i++) await wish(s, `wens ${i}`);
  assert.equal((await s.as(bram, "add", { text: "één te veel" })).statusCode, 400);
});

test("add always writes to your own list, whatever owner is sent", async () => {
  const s = setup();
  const body = json(await s.as(anna, "add", { text: "Boek", owner: "Bram" }));
  assert.equal(body.own.length, 1);
  assert.deepEqual(bramsItems(await s.as(anna, "read")), []);
});

test("you can't remove someone else's item", async () => {
  const s = setup();
  const id = await wish(s);
  assert.equal((await s.as(anna, "remove", { id })).statusCode, 404);
  assert.equal(bramsItems(await s.as(anna, "read")).length, 1);
});

// --- who sees what -----------------------------------------------------------

test("buyers see their picks' lists, and nobody else's", async () => {
  const s = setup();
  const id = await wish(s);
  assert.equal(bramsItems(await s.as(anna, "read"))[0].id, id);

  // Bram didn't draw himself, so he only sees his list as "own".
  const body = json(await s.as(bram, "read"));
  assert.ok(!body.picks.some((p) => p.name === "Bram"));
});

test("a claim changes nothing at all for the list's owner", async () => {
  const s = setup();
  const id = await wish(s);
  const before = (await s.as(bram, "read")).body;
  assert.equal((await s.as(anna, "claim", { owner: "Bram", id })).statusCode, 200);
  assert.equal((await s.as(bram, "read")).body, before);
});

test("other buyers see that it's taken, not by whom", async () => {
  const s = setup();
  const id = await wish(s);
  await s.as(anna, "claim", { owner: "Bram", id });

  assert.deepEqual(bramsItems(await s.as(anna, "read")), [
    { id, text: "Sokken", claimed: true, mine: true, removed: false },
  ]);
  const res = await s.as(zoe, "read");
  assert.deepEqual(bramsItems(res), [
    { id, text: "Sokken", claimed: true, mine: false, removed: false },
  ]);
  assert.ok(!res.body.includes('"claim"'), "the keyed hash stays on the server");
});

test("the stored data doesn't name the claimer", async () => {
  const s = setup();
  const id = await wish(s);
  await s.as(anna, "claim", { owner: "Bram", id });
  assert.ok(!s.store.raw().includes("Anna"));
});

// --- claiming ----------------------------------------------------------------

test("you can only claim on your picks' lists", async () => {
  const s = setup();
  const id = await wish(s);
  assert.equal((await s.as(bram, "claim", { owner: "Bram", id })).statusCode, 403); // own list
  assert.equal((await s.as(anna, "claim", { owner: "Fenna", id })).statusCode, 403); // not a pick
});

test("claiming twice is harmless", async () => {
  const s = setup();
  const id = await wish(s);
  await s.as(anna, "claim", { owner: "Bram", id });
  assert.equal((await s.as(anna, "claim", { owner: "Bram", id })).statusCode, 200);
});

test("a second buyer is told it's taken", async () => {
  const s = setup();
  const id = await wish(s);
  await s.as(anna, "claim", { owner: "Bram", id });
  const res = await s.as(zoe, "claim", { owner: "Bram", id });
  assert.equal(res.statusCode, 409);
  assert.deepEqual(json(res), { error: "taken" });
});

test("only the claimer can undo a claim", async () => {
  const s = setup();
  const id = await wish(s);
  await s.as(anna, "claim", { owner: "Bram", id });
  assert.equal((await s.as(zoe, "unclaim", { owner: "Bram", id })).statusCode, 403);

  const res = await s.as(anna, "unclaim", { owner: "Bram", id });
  assert.equal(bramsItems(res)[0].claimed, false);
  assert.equal((await s.as(zoe, "claim", { owner: "Bram", id })).statusCode, 200);
});

test("a claim on an item that doesn't exist is refused", async () => {
  const s = setup();
  assert.equal((await s.as(anna, "claim", { owner: "Bram", id: "nope" })).statusCode, 404);
});

// --- removing a claimed item -------------------------------------------------

test("removing a claimed item keeps it for the claimer only", async () => {
  const s = setup();
  const id = await wish(s);
  await s.as(anna, "claim", { owner: "Bram", id });
  const res = await s.as(bram, "remove", { id });

  assert.deepEqual(json(res).own, []); // same as removing an unclaimed item
  assert.deepEqual(bramsItems(await s.as(anna, "read")), [
    { id, text: "Sokken", claimed: true, mine: true, removed: true },
  ]);
  assert.deepEqual(bramsItems(await s.as(zoe, "read")), []);
  assert.equal((await s.as(zoe, "claim", { owner: "Bram", id })).statusCode, 404);
});

test("undoing the claim on a removed item clears it completely", async () => {
  const s = setup();
  const id = await wish(s);
  await s.as(anna, "claim", { owner: "Bram", id });
  await s.as(bram, "remove", { id });
  const res = await s.as(anna, "unclaim", { owner: "Bram", id });
  assert.deepEqual(bramsItems(res), []);
  assert.ok(!s.store.raw().includes("Sokken"));
});

// --- two people at the same moment -------------------------------------------

test("two simultaneous claims: exactly one wins", async () => {
  const s = setup();
  const id = await wish(s);
  const results = await Promise.all([
    s.as(anna, "claim", { owner: "Bram", id }),
    s.as(zoe, "claim", { owner: "Bram", id }),
  ]);
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
});

test("simultaneous claims on different items both stick", async () => {
  const s = setup();
  const first = await wish(s, "Sokken");
  const second = await wish(s, "Boek");
  const results = await Promise.all([
    s.as(anna, "claim", { owner: "Bram", id: first }),
    s.as(zoe, "claim", { owner: "Bram", id: second }),
  ]);
  assert.deepEqual(results.map((r) => r.statusCode), [200, 200]);
  assert.ok(bramsItems(await s.as(anna, "read")).every((x) => x.claimed));
});

test("gives up with 503 if the data keeps changing", async () => {
  const store = { ...memoryStore(), save: async () => false };
  const { as } = setup({ store });
  const res = await as(bram, "add", { text: "Sokken" });
  assert.equal(res.statusCode, 503);
  assert.deepEqual(json(res), { error: "busy" });
});
