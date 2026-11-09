// Who is asking, and what may they do? No AWS in here, so it's easy to test.

import { createHash } from "node:crypto";

export const hashCode = (code) => createHash("sha256").update(code).digest("hex");

// Link code -> { name, picks }, or null if it isn't one of the links that were sent.
// The allowlist comes first, so decode only ever sees codes we issued ourselves.
export function authenticate(code, { decode, allowedHashes }) {
  if (typeof code !== "string" || !allowedHashes.has(hashCode(code))) return null;
  const fields = decode(code);
  if (!fields) return null;
  const [name, ...picks] = fields;
  return { name, picks };
}

// What may this ticket do with `owner`'s list?
// `claim` also decides who sees claims, so a list's owner never gets them.
export function permissions(ticket, owner) {
  const isOwner = owner === ticket.name;
  const isBuyer = ticket.picks.includes(owner);
  return { read: isOwner || isBuyer, edit: isOwner, claim: isBuyer };
}
