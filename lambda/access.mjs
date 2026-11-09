// Who is asking, and what may they do? No AWS in here, so it's easy to test.

import { createHash, createHmac } from "node:crypto";

export const hashCode = (code) => createHash("sha256").update(code).digest("hex");

// Proves "this person claimed this item" without storing who it was. Needs the secret,
// because a plain hash of a name could be undone by trying the 7 names. The item id
// is mixed in, so one person's claims can't be linked to each other.
export const claimTag = (secret, name, id) =>
  createHmac("sha256", secret).update(`${name}\n${id}`).digest("hex");

// Link code -> { name, picks }, or null if it isn't one of the links that were sent.
// The allowlist comes first, so decode only ever sees codes we issued ourselves.
export function authenticate(code, { decode, allowedHashes }) {
  if (typeof code !== "string" || !allowedHashes.has(hashCode(code))) return null;
  const fields = decode(code);
  if (!fields) return null;
  const [name, ...picks] = fields;
  return { name, picks };
}
