#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
: "${WASI_SDK:=/work/cache/wasi-sdk-34.0-x86_64-linux}"
mkdir -p target/c
"$WASI_SDK/bin/clang" -O3 -DNDEBUG -fPIC -nostdlib -std=c11 -D_POSIX_C_SOURCE=200809L \
 -Ivendor/cmark -Igrammar/src experiments/side-module/probe.c vendor/cmark/*.c grammar/src/parser.c grammar/src/scanner.c \
 -shared -Wl,--strip-all -Wl,--no-entry -Wl,--allow-undefined -Wl,--export=tree_sitter_markdown -Wl,--export=tsmd_probe_inline \
 -o target/c/side-probe.wasm
