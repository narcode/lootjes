// The Lambda function: one POST endpoint, JSON in and JSON out.
// The link code is a password now, so never log it and never put it in a URL.

import { authenticate } from "./access.mjs";

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

// `decode` and `allowedHashes` are passed in, so tests can run without AWS.
export function createHandler({ decode, allowedHashes }) {
  return async (event) => {
    if (event.requestContext?.http?.method !== "POST") return reply(405, { error: "method" });

    // Every kind of bad request gets the same answer, so a guesser learns nothing from it.
    const body = parseBody(event);
    const ticket = authenticate(body?.code, { decode, allowedHashes });
    if (!ticket) return reply(403, { error: "forbidden" });

    switch (body.action) {
      case "whoami":
        return reply(200, ticket);
      default:
        return reply(400, { error: "action" });
    }
  };
}
