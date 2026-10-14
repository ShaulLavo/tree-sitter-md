#!/bin/sh
# Builds tree-sitter-md.wasm as an extension for tree-sitter-x: a side module, like a
# grammar, that calls tree-sitter's C API and libc from the host runtime it is loaded into.
set -eu
cd "$(dirname "$0")/.."
: "${WASI_SDK:?Set WASI_SDK to the extracted WASI SDK 34 directory}"
: "${OPT:=-O3}"
exports='tsmd_new tsmd_free tsmd_input tsmd_set_text tsmd_edit tsmd_reparse tsmd_decorations tsmd_folds tsmd_injections tsmd_out tsmd_row_start tsmd_line_count tsmd_highlights tsmd_semantics tsmd_semantic_out tsmd_semantic_release'
flags=''
for name in $exports; do flags="$flags -Wl,--export=$name"; done
"$WASI_SDK/bin/clang" --target=wasm32-wasip1 -fPIC -shared -nostdlib $OPT -fno-exceptions -fvisibility=hidden \
  -DNDEBUG -std=c11 -D_POSIX_C_SOURCE=200809L \
  -Ivendor/tree-sitter/include -Ivendor/cmark -Isrc \
  src/*.c vendor/cmark/*.c \
  -Wl,--allow-undefined -Wl,--no-entry -Wl,--strip-all $flags \
  -o tree-sitter-md.wasm
printf 'wasm: %s raw, %s gzip -9\n' "$(wc -c < tree-sitter-md.wasm)" "$(gzip -9nc tree-sitter-md.wasm | wc -c)"
# Build the grammar with the same WASI toolchain as the resolver.
"$WASI_SDK/bin/clang" --target=wasm32-wasip1 -fPIC -shared -nostdlib $OPT \
  -DNDEBUG -std=c11 -D_POSIX_C_SOURCE=200809L -Igrammar/src -Ivendor/cmark grammar/src/parser.c grammar/src/scanner.c vendor/cmark/*.c \
  -Wl,--allow-undefined -Wl,--no-entry -Wl,--strip-all \
  -Wl,--export=tree_sitter_markdown -o tree-sitter-markdown.wasm
printf 'grammar wasm: %s raw, %s gzip -9\n' "$(wc -c < tree-sitter-markdown.wasm)" "$(gzip -9nc tree-sitter-markdown.wasm | wc -c)"
