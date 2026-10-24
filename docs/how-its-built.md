# Lootjes: how it's built

## Overview

Lootjes is a static web page whose logic is written in Rust and compiled to WebAssembly. It has no server and no database. Seven people in different places each get a personal link that shows only their own three names.

The rules of the draw:

- 7 participants, each draws 3 names.
- Nobody draws themselves.
- Nobody draws the same name twice.
- Every name is drawn exactly 3 times, so everyone also receives 3 presents.

How the pieces fit:

1. **Rust library** (`src/`): the draw algorithm, the ticket format, and the JS bridge.
2. **WebAssembly** (`web/lootjes.wasm`): the Rust code compiled for the browser by `build.sh`.
3. **Web page** (`web/index.html`): plain HTML and JS that loads the wasm, shows the organizer screen, and later the recipient screen.

| File | Role |
| --- | --- |
| `src/lib.rs` | Draw algorithm + `draw` export |
| `src/ticket.rs` | Pack a person's result into a link code and back |
| `src/wasm_api.rs` | Pass strings between JS and wasm |
| `web/wasm.js` | JS half of the bridge: `draw`, `encode`, `decode` |
| `scripts/try-wasm.mjs` | Call the wasm from Node, no browser needed |
| `web/index.html` | The user interface |
| `build.sh` | Build the wasm and copy it into `web/` |

Why personal links instead of saved state: the part of a URL after `#` is never sent to a server. A link like `https://…/#dygAGgR2KR4ADHc3CA8aZjcdDQ` carries the person's result inside itself, so the site can be plain static files.

## The draw algorithm

`draw_into` in `src/lib.rs` fills each person's 3 picks with random greedy choices, and restarts when it gets stuck. For 7 people it practically always succeeds on the first few tries.

One attempt works like this:

1. Every person starts with `left = 3`: how many more times their name may be drawn.
2. Shuffle the order of the givers.
3. For each giver, list the candidates: everyone except themselves with `left > 0`.
4. If there are fewer than 3 candidates, the attempt is stuck, so start over (`continue 'attempt`). There are at most 10,000 attempts.
5. Otherwise shuffle the candidates, sort them so the names with the most `left` come first, take the first 3, and lower their `left`.

Step 5 matters. Picking the names that still need the most draws first avoids ending up with one name that nobody can draw any more.

Randomness comes from `Rng`, a tiny xorshift64* generator. The seed comes from the browser's `crypto.getRandomValues`. JS passes it as two 32-bit halves (`seed_hi`, `seed_lo`), because plain wasm functions are simplest with 32-bit numbers.

The result is `n × k` bytes: `out[giver * k + j]` is the index of giver's j-th name. The `draw` export writes them into the static `RESULT` buffer and returns a pointer, or 0 if no valid draw exists (for example 3 people drawing 3 names each).

The tests check every rule: no self, no duplicates, everyone drawn exactly `k` times. They run 5,000 seeds for 7×3, and other sizes such as 10×3 and 12×5.

## Step 1: the ticket format

A ticket is one person's result: their own name plus the names they drew. `src/ticket.rs` packs it into a short, URL-safe code with `encode` and unpacks it with `decode`. This is plain Rust with no wasm involved, tested with `cargo test`.

Anna's ticket (she drew Bram, Daan and Eva) goes through three stages:

1. **Length-prefixed bytes.** Each name gets one byte in front with its length: `[4]Anna [4]Bram [4]Daan [3]Eva`. Unlike a separator such as `,`, this works whatever characters a name contains.
2. **XOR with the key `sinterklaas`.** Each byte is XOR'd with the next key letter, repeating via `.cycle()`. XOR'ing twice gives back the original, so encode and decode share one `xor` function. This only hides names from a casual glance; it is not encryption.
3. **base64url.** Raw bytes become only `A–Z a–z 0–9 - _`, so the code survives being pasted into WhatsApp. Anna's ticket becomes `dygAGgR2KR4ADHc3CA8aZjcdDQ`.

Things worth knowing:

- `s.len()` counts bytes, not characters. `Zoë` is 4 bytes, because `ë` takes 2 bytes in UTF-8.
- One length byte holds 0–255, so longer names are rejected: `u8::try_from(s.len()).ok()?` makes `encode` return `None`.
- `decode` returns `Option<Ticket>`. Every `?` means "if this fails, return `None`", so bad base64, a truncated link, or invalid UTF-8 never crash the page.
- `std::iter::once(&ticket.name).chain(&ticket.picks)` lets one loop handle the name and the picks. `split_first()` takes the first byte and returns the rest as a slice, with no index bookkeeping.

The five tests cover the round trip, Unicode names, that names are not readable in the code, broken codes, and too-long names.

## Step 2: passing strings between JS and wasm

A wasm function can only take and return numbers, so a string is passed as a pointer and a length into memory that both sides share. `src/wasm_api.rs` implements this by hand, which is exactly what the `wasm-bindgen` tool generates automatically in larger projects.

The shared memory is wasm's **linear memory**: one big byte array. In JS it is `wasm.memory.buffer`; in Rust it is simply all of the program's memory.

**JS → Rust (the input)**

1. `TextEncoder` turns `"Anna\nBram\nDaan\nEva"` into 19 UTF-8 bytes.
2. `ptr = wasm.alloc(19)` asks Rust to reserve 19 bytes and returns their position.
3. JS copies the bytes in: `new Uint8Array(memory.buffer, ptr, 19).set(bytes)`.
4. `wasm.encode_ticket(ptr, 19)` is called with just two numbers.
5. `wasm.dealloc(ptr, 19)` gives the memory back.

JS must use `alloc` rather than writing anywhere, because the memory belongs to Rust's allocator. Writing to a random spot could overwrite Rust's own data. On the Rust side, `read_str` turns `(ptr, len)` into a `&str` with `slice::from_raw_parts`. This is `unsafe`, because Rust cannot check the pointer, so the `SAFETY` comment states the promise.

**Rust → JS (the output)**

A function returns one number, but JS needs a pointer and a length. Rust stores the answer in the static `OUT` buffer and returns its length, or -1 on error. JS then reads `len` bytes at `out_ptr()`. The rule is to copy the result right away, because the next call overwrites `OUT`.

```js
function callWithString(fn, text) {
  const input = new TextEncoder().encode(text);
  const ptr = wasm.alloc(input.length);
  new Uint8Array(wasm.memory.buffer, ptr, input.length).set(input);
  const len = fn(ptr, input.length);
  wasm.dealloc(ptr, input.length);
  if (len < 0) return null;
  return new TextDecoder().decode(
    new Uint8Array(wasm.memory.buffer, wasm.out_ptr(), len));
}
```

**Gotchas**

- **`Mutex` around `OUT`.** wasm runs on one thread here, but Rust requires every global to be thread-safe. A `Mutex` satisfies that at almost no cost.
- **`memory.buffer` can be replaced.** When wasm memory grows, the old `ArrayBuffer` in JS becomes invalid. Create the `Uint8Array` view after the call, never before.
- **`dealloc` needs the same `len` as `alloc`.** Rust's allocator wants the size when freeing too, hence `layout(len)` in both.
- **Names travel joined by `\n`.** Input fields cannot contain a newline, so it is a safe separator.

The string handling, base64 and `Mutex` grew the `.wasm` from 33 KB to 61 KB.

## Step 3: organizer view with the sack animation

The organizer types 7 names and taps "Trek de lootjes!". The name cards fly into Sinterklaas' sack, the sack shakes, and then 7 personal links pop up one by one. The organizer only sees links, never who drew whom.

**Files**

- `web/wasm.js`: the JS half of the bridge, moved out of the page so the browser and `scripts/try-wasm.mjs` share it. `loadLootjes(bytes)` returns `{ draw, encode, decode }` and hides all pointer handling.
- `web/index.html`: the organizer screen, the animations, and an empty recipient screen for step 4.

**Order matters: draw first, animate after.** The click handler draws and encodes everything before any animation starts, so nothing can fail halfway through the show.

**The Web Animations API**

`element.animate(keyframes, options)` is the JS version of CSS `@keyframes`. It returns an `Animation`, whose `.finished` promise resolves when it ends. That makes sequencing with `await` easy:

```js
await flyIntoSack(inputs); // all 7 cards in parallel (Promise.all), staggered with `delay`
await shakeSack();         // starts only when every card has landed
renderLinks(state);        // rows pop in one after another
```

The animation helpers use a few tricks:

- **Flying cards.** For each input, a fixed-position copy is placed exactly over it (`getBoundingClientRect`). It's then moved with `translate` to the sack's opening. The middle keyframe at `offset: 0.5` lifts it 60px, which makes the path an arc rather than a straight line.
- **`fill` mode.** `"forwards"` keeps the last keyframe after the animation ends. The shake uses `"none"` so the sack snaps back. The rows use `"backwards"` so they stay invisible during their delay instead of flashing in first.
- **Bouncy pop.** `cubic-bezier(.3, 1.6, .6, 1)` overshoots past 1, so a row grows slightly too big and settles back.
- **Reduced motion.** If the device has "reduce motion" turned on, `animate()` resolves immediately and everything appears without movement.

**Copy and share.** `navigator.clipboard.writeText` copies the link. It needs https or localhost, so there's a `prompt()` fallback. On phones, `navigator.share` opens the share menu (WhatsApp etc.), and the "Deel" button only appears where that exists.

**Remembered links.** The organizer's browser stores `{ names, codes }` in `localStorage`, so a refresh shows the links again. The draw itself lives only inside the links.

## Step 4: recipient view, where the lootjes are drawn

When the page opens with a `#code`, it decodes the ticket and shows "Hoi Anna!" with a "Trek je lootjes!" button. One tap shakes the sack, all three folded papers fly out one right after another, and after a short pause they flip over one by one to show the names. Then pepernoten and confetti rain down. A broken code shows "Oeps!" with a request to ask the organizer for the link again.

**The click sequence** reads like a film script again:

```js
await shakeSack(4);
await pullPapers(picks); // all fly out (staggered) → pause → flip one by one
// then show the outro and rain()
```

The button is disabled as soon as it's tapped, so a double tap can't start the show twice.

**Staggering.** `pullPapers` starts the three flights together with `Promise.all`, each with `delay: i * 250`. The flips do the same with `delay: i * 450`. `fill: "both"` keeps a waiting paper invisible at the sack until its delay is over.

**The FLIP technique** (First, Last, Invert, Play) for the flying papers. All three papers are added to the layout at once, so no paper's final spot shifts while another is still flying. The page measures where each one is. The animation starts offset back at the sack (`translate(dx, dy) scale(0.1)`) and plays towards `transform: "none"`, which is its real spot. The browser's layout decides where the paper ends up, so there's no position to calculate by hand. With reduced motion on, the paper simply appears in place.

**The 3D flip** uses only CSS structure:

- `.paper` has `perspective: 600px`, which sets how deep the 3D looks.
- `.inner` has `transform-style: preserve-3d`, so its children live in the same 3D space.
- Both faces have `backface-visibility: hidden`. The back face starts at `rotateY(180deg)`, so it's hidden until `.inner` turns 180°.

The flip is a Web Animation on `.inner`. Afterwards, the class `flipped` sets the same end state in CSS, so the name is also visible when animations are off.

**Pepernoten and confetti.** `rain()` creates 80 small fixed-position elements at the top: brown circles with a radial gradient, or coloured rectangles. Each falls `110vh` with a random drift, spin, speed and delay, and removes itself when its animation's `.finished` resolves. `fill: "backwards"` keeps each one off-screen until its delay is over.

**Safety.** The names come from a link, which anyone can craft. They are put on the page with `textContent`, never `innerHTML`, so a "name" like `<img onerror=…>` shows as plain text instead of running code.

**Pasting a link in the same tab** only changes the part after `#`, which doesn't reload the page. A `hashchange` listener reloads it, so the right screen shows.

## Building and running

One script builds the wasm, and any static file server can serve the page. The only extra tooling is Rust's wasm target, no `wasm-pack` or `trunk`.

One-time setup:

```sh
rustup target add wasm32-unknown-unknown
```

Rust can compile for many platforms ("targets"), but `rustup` only installs the standard library for your own machine (e.g. `aarch64-apple-darwin`). This command downloads it for WebAssembly. Target names read `architecture-vendor-os`: `wasm32` is WebAssembly with 32-bit pointers, and `unknown-unknown` means no specific vendor and **no operating system**. In the browser the Rust code has no files, threads or clock of its own; everything else comes through JS. That's why the random seed comes from `crypto.getRandomValues` in JS. (`wasm32-wasip1` is the variant with a system interface, for running wasm outside the browser.)

Every build:

```sh
cargo test                      # run the Rust tests natively
./build.sh                      # build web/lootjes.wasm
node scripts/try-wasm.mjs       # try the exports without a browser
python3 -m http.server -d web 8000
```

Then open http://localhost:8000. A browser will not load a `.wasm` file from `file://`, so a local server is needed.

What makes the crate build for wasm, in `Cargo.toml`:

- `crate-type = ["cdylib", "rlib"]`: `cdylib` produces the `.wasm` file, and `rlib` lets `cargo test` use the code natively.
- `#[unsafe(no_mangle)] pub extern "C" fn …`: keeps the function name as-is so JS can find it in `instance.exports`.
- Release profile with `opt-level = "s"`, `lto = true` and `panic = "abort"` keeps the file small.

`web/lootjes.wasm` is a build output and is listed in `.gitignore` for now. That changes in step 5, when the built file must be committed for GitHub Pages.

## What's next

Steps 3–5 turn the working Rust pieces into the actual app. Each step is reviewed before the next one starts.

- [x] **Step 3: organizer view.** Cards fly into the sack, the sack shakes, and 7 personal links pop up with copy and share buttons.
- [x] **Step 4: recipient view.** One tap on "Trek je lootjes!": the sack shakes, three papers fly out and flip one by one, then pepernoten and confetti rain down.
- [ ] **Step 5: online.** Host the `web/` folder on GitHub Pages. You do the commits and the push yourself; I only suggest the commands.
