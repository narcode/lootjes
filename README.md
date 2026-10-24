# Lootjes trekken

[![Built with Claude Code](https://img.shields.io/badge/built%20with-Claude%20Code-D97757?logo=claude&logoColor=white)](https://claude.com/claude-code)
[![Rust](https://img.shields.io/badge/Rust-WebAssembly-654FF0?logo=webassembly&logoColor=white)](https://www.rust-lang.org)

A small Sinterklaas lootjes app. Each of 7 people draws 3 names: nobody gets themselves, nobody gets a name twice, and everyone is drawn exactly 3 times. The draw runs in the browser as Rust compiled to WebAssembly. Every person gets a private link that carries only their own names, so there's no server and no database.

Built step by step with an AI coding agent ([Claude Code](https://claude.com/claude-code))

```sh
rustup target add wasm32-unknown-unknown   # once
./build.sh
python3 -m http.server -d web 8000         # open http://localhost:8000
```

How it's built: [docs/how-its-built.md](docs/how-its-built.md)
