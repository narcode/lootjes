// The wishlist rules. State is one JSON document:
//   { lists: { Bram: [{ id, text, claim?, removed? }] } }
// `claim` is a keyed hash, so the stored data doesn't say who is buying what.

import { randomUUID } from "node:crypto";

const MAX_TEXT = 300;
const MAX_ITEMS = 30;
const MAX_TRIES = 5;

/** A request we understood but won't do. Becomes an HTTP error, and nothing is saved. */
export class Refused extends Error {
  constructor(status, reason) {
    super(reason);
    this.status = status;
  }
}

// A pick's list and one item on it. The only way to reach another person's list.
function findForBuyer(state, ticket, { owner, id }) {
  if (!ticket.picks.includes(owner)) throw new Refused(403, "forbidden");
  const list = state.lists[owner] ?? [];
  const item = list.find((x) => x.id === id);
  if (!item) throw new Refused(404, "gone");
  return { list, item };
}

// Each action changes `state` in place. add and remove have no `owner` field:
// they always use the ticket's own list, so editing someone else's can't be expressed.
export const actions = {
  add(state, ticket, { text }) {
    const clean = typeof text === "string" ? text.trim() : "";
    if (!clean || clean.length > MAX_TEXT) throw new Refused(400, "text");
    const list = (state.lists[ticket.name] ??= []);
    if (list.filter((x) => !x.removed).length >= MAX_ITEMS) throw new Refused(400, "full");
    list.push({ id: randomUUID(), text: clean });
  },

  remove(state, ticket, { id }) {
    const list = state.lists[ticket.name] ?? [];
    const item = list.find((x) => x.id === id && !x.removed);
    if (!item) throw new Refused(404, "gone");
    // Someone may have bought it already: keep it so the buyer gets told.
    if (item.claim) item.removed = true;
    else list.splice(list.indexOf(item), 1);
  },

  claim(state, ticket, request, tag) {
    const { item } = findForBuyer(state, ticket, request);
    if (item.removed) throw new Refused(404, "gone");
    if (item.claim && item.claim !== tag(item.id)) throw new Refused(409, "taken");
    item.claim = tag(item.id);
  },

  unclaim(state, ticket, request, tag) {
    const { list, item } = findForBuyer(state, ticket, request);
    if (!item.claim) return;
    if (item.claim !== tag(item.id)) throw new Refused(403, "forbidden");
    delete item.claim;
    if (item.removed) list.splice(list.indexOf(item), 1);
  },
};

// Load, change, save only if nobody saved in between; otherwise start over from
// the fresh data. Re-running `change` is what makes the second claimer get "taken".
export async function mutate(store, change) {
  for (let i = 0; i < MAX_TRIES; i++) {
    const { state, etag } = await store.load();
    change(state);
    if (await store.save(state, etag)) return state;
  }
  throw new Refused(503, "busy");
}

// What this ticket may see. Fields are copied one by one, so a new stored field
// stays private unless it's added here, and the owner's items can't carry claims.
export function viewFor(ticket, state, tag) {
  const items = (owner) => state.lists[owner] ?? [];
  return {
    name: ticket.name,
    own: items(ticket.name)
      .filter((x) => !x.removed)
      .map(({ id, text }) => ({ id, text })),
    picks: ticket.picks.map((name) => ({
      name,
      items: items(name)
        .filter((x) => !x.removed || x.claim === tag(x.id))
        .map((x) => ({
          id: x.id,
          text: x.text,
          claimed: Boolean(x.claim),
          mine: x.claim === tag(x.id),
          removed: Boolean(x.removed),
        })),
    })),
  };
}
