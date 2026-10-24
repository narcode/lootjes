#!/bin/sh
# Build the wasm and drop it next to index.html.
set -e
cd "$(dirname "$0")"
cargo build --release --lib --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/lootjes.wasm web/
echo "Klaar. Start met: python3 -m http.server -d web 8000"
