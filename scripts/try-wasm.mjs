// Try the wasm exports from Node, without a browser.
// Run after ./build.sh:   node scripts/try-wasm.mjs
import { readFile } from "node:fs/promises";
import { loadLootjes } from "../web/wasm.js";

const lootjes = await loadLootjes(await readFile(new URL("../web/lootjes.wasm", import.meta.url)));

const code = lootjes.encode(["Anna", "Bram", "Daan", "Eva"]);
console.log("code:     ", code);
console.log("decoded:  ", lootjes.decode(code));
console.log("unicode:  ", lootjes.decode(lootjes.encode(["Zoë", "Jürgen", "🎅"])));
console.log("broken:   ", lootjes.decode(code.slice(0, -4)));
console.log("too long: ", lootjes.encode(["x".repeat(300), "Bram"]));
console.log("draw 7x3: ", JSON.stringify(lootjes.draw(7, 3)));
