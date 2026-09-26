#!/bin/sh
# Build the wasm module and copy it to the package root. Needs clang (wasm32 target) and llvm-ar.
set -eu
cd "$(dirname "$0")/.."
: "${RUSTUP_HOME:=/work/cache/rustup}"
: "${CARGO_HOME:=/work/cache/cargo}"
export RUSTUP_HOME CARGO_HOME PATH="$CARGO_HOME/bin:$PATH"
cargo build --release --lib --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/tree_sitter_md.wasm tree-sitter-md.wasm
cargo build --release --bin tsmd
printf 'tree-sitter-md.wasm: %s bytes, %s gzip -9\n' "$(wc -c < tree-sitter-md.wasm)" "$(gzip -9c tree-sitter-md.wasm | wc -c)"
