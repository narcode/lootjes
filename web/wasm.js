// The JS side of the bridge to lootjes.wasm (Rust side: src/wasm_api.rs).
// Used by index.html in the browser and by scripts/try-wasm.mjs in Node.

export async function loadLootjes(bytes) {
  const { instance } = await WebAssembly.instantiate(bytes);
  const wasm = instance.exports;

  // JS string -> wasm memory, call fn(ptr, len), wasm memory -> JS string.
  function callWithString(fn, text) {
    const input = new TextEncoder().encode(text); // JS string -> UTF-8 bytes
    const ptr = wasm.alloc(input.length);
    new Uint8Array(wasm.memory.buffer, ptr, input.length).set(input);
    const len = fn(ptr, input.length);
    wasm.dealloc(ptr, input.length);
    if (len < 0) return null;
    // Read the view only now: memory.buffer can be replaced when wasm grows its memory.
    return new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, wasm.out_ptr(), len));
  }

  return {
    // Returns picks[giver] = [index, index, …], or null if no valid draw exists.
    draw(n, k) {
      const [hi, lo] = crypto.getRandomValues(new Uint32Array(2));
      const ptr = wasm.draw(n, k, hi, lo);
      if (!ptr) return null;
      const flat = Array.from(new Uint8Array(wasm.memory.buffer, ptr, n * k));
      return Array.from({ length: n }, (_, g) => flat.slice(g * k, g * k + k));
    },
    // ["Anna", "Bram", "Daan", "Eva"] -> link code, or null.
    encode: (names) => callWithString(wasm.encode_ticket, names.join("\n")),
    // link code -> ["Anna", "Bram", "Daan", "Eva"], or null if the code is broken.
    decode: (code) => callWithString(wasm.decode_ticket, code)?.split("\n") ?? null,
  };
}
