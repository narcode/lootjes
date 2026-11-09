// The Lambda function: one POST endpoint, JSON in and JSON out.
// The link code is a password now, so never log it and never put it in a URL.

import { authenticate, claimTag } from "./access.mjs";
import { Refused, actions, mutate, viewFor } from "./lists.mjs";

const reply = (statusCode, body) => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

function parseBody(event) {
  try {
    const text = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString() : event.body;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Everything from outside is passed in, so tests can run without AWS.
// `store` has load() -> { state, etag } and save(state, etag) -> false on a conflict.
export function createHandler({ decode, allowedHashes, store, claimSecret }) {
  return async (event) => {
    if (event.requestContext?.http?.method !== "POST") return reply(405, { error: "method" });

    // Every kind of bad request gets the same answer, so a guesser learns nothing from it.
    const body = parseBody(event);
    const ticket = authenticate(body?.code, { decode, allowedHashes });
    if (!ticket) return reply(403, { error: "forbidden" });

    const tag = (id) => claimTag(claimSecret, ticket.name, id);

    try {
      let state;
      if (body.action === "read") {
        ({ state } = await store.load());
      } else if (Object.hasOwn(actions, body.action)) {
        state = await mutate(store, (s) => actions[body.action](s, ticket, body, tag));
      } else {
        return reply(400, { error: "action" });
      }
      return reply(200, viewFor(ticket, state, tag));
    } catch (e) {
      if (e instanceof Refused) return reply(e.status, { error: e.message });
      throw e;
    }
  };
}
