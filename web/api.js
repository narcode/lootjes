// Talks to the wishlist Lambda (lambda/handler.mjs). The URL can be public: without
// one of the links that were sent, every request is refused.

const API_URL = "https://3shtmii6wnspmievu2kcj36khm0dlfeh.lambda-url.eu-central-1.on.aws/";

// Returns { view } on success or { error } otherwise; it never throws, so a backend
// problem can't break the lootjes reveal. The code goes in the body: it's a password now.
export async function api(code, action, fields = {}) {
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, action, ...fields }),
    });
    const body = await res.json().catch(() => null);
    return res.ok ? { view: body } : { error: body?.error ?? "server" };
  } catch {
    return { error: "network" };
  }
}
