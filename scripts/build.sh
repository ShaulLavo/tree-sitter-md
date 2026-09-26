#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
: "${WASI_SDK:=/work/cache/wasi-sdk-34.0-x86_64-linux}"
: "${OPT:=-O3}"
mkdir -p target/c
exports='tsmd_new tsmd_free tsmd_input tsmd_set_text tsmd_edit tsmd_reparse tsmd_decorations tsmd_folds tsmd_injections tsmd_out tsmd_row_start tsmd_line_count tsmd_highlights'
flags=''
for name in args_get args_sizes_get fd_close fd_seek fd_write proc_exit random_get; do flags="$flags -Wl,--wrap=__wasi_$name"; done
for name in $exports; do flags="$flags -Wl,--export=$name"; done
"$WASI_SDK/bin/clang" $OPT -flto -nostartfiles -fno-stack-protector -DNDEBUG -std=c11 -D_POSIX_C_SOURCE=200809L \
  -Ivendor/tree-sitter/include -Ivendor/tree-sitter/src -Igrammar/src -Ivendor/cmark \
  src/*.c vendor/cmark/*.c vendor/tree-sitter/src/lib.c grammar/src/parser.c grammar/src/scanner.c \
  -Wl,--strip-all -Wl,--no-entry -Wl,--export-memory -Wl,-z,stack-size=1048576 $flags \
  -o tree-sitter-md.wasm
printf 'wasm: %s raw, %s gzip -9\n' "$(wc -c < tree-sitter-md.wasm)" "$(gzip -9nc tree-sitter-md.wasm | wc -c)"
