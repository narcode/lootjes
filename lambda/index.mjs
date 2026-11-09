// Lambda's entry point: connects the handler to the real wasm, config and S3.
// lambda/package.sh copies this next to wasm.mjs, lootjes.wasm and config.json.

import { readFile } from "node:fs/promises";
import { S3Client } from "@aws-sdk/client-s3"; // preinstalled in Lambda's Node runtime

import { createHandler } from "./handler.mjs";
import { s3Store } from "./s3-store.mjs";
import { loadLootjes } from "./wasm.mjs";

const read = (file) => readFile(new URL(file, import.meta.url));

const config = JSON.parse(await read("./config.json"));
const lootjes = await loadLootjes(await read("./lootjes.wasm"));

export const handler = createHandler({
  decode: lootjes.decode,
  allowedHashes: new Set(config.allowedHashes),
  claimSecret: config.claimSecret,
  store: s3Store({ client: new S3Client({}), bucket: process.env.BUCKET, key: "wishlists.json" }),
});
