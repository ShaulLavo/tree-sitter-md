#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
: "${WASI_SDK:=/work/cache/wasi-sdk-34.0-x86_64-linux}"
mkdir -p target/c
flags=''
for name in tsmd_new tsmd_free tsmd_input tsmd_set_text tsmd_edit tsmd_reparse tsmd_decorations tsmd_folds tsmd_injections tsmd_out tsmd_row_start tsmd_line_count tsmd_highlights; do
 flags="$flags -Wl,--export=$name"
done
"$WASI_SDK/bin/clang" -O3 -DNDEBUG -fPIC -nostdlib -std=c11 -D_POSIX_C_SOURCE=200809L \
 -Ivendor/cmark -Igrammar/src -Ivendor/tree-sitter/include \
 src/*.c vendor/cmark/*.c grammar/src/parser.c grammar/src/scanner.c \
 -shared -Wl,--strip-all -Wl,--no-entry -Wl,--allow-undefined -Wl,--export=tree_sitter_markdown $flags \
 -o target/c/resolver-side.wasm
