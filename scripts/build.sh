#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
: "${WASI_SDK:=/work/cache/wasi-sdk-34.0-x86_64-linux}"
: "${OPT:=-O3}"
mkdir -p target/c
exports='tsmd_new tsmd_free tsmd_input tsmd_args tsmd_set_text tsmd_edit tsmd_forget tsmd_define tsmd_commit tsmd_reset tsmd_record tsmd_leaf tsmd_highlights tsmd_count tsmd_text tsmd_length tsmd_out tsmd_row_start tsmd_line_count tsmd_row_of'
flags=''
for name in args_get args_sizes_get fd_close fd_seek fd_write proc_exit random_get; do flags="$flags -Wl,--wrap=__wasi_$name"; done
for name in $exports; do flags="$flags -Wl,--export=$name"; done
"$WASI_SDK/bin/clang" $OPT -flto -nostartfiles -fno-stack-protector -DNDEBUG -std=c11 -D_POSIX_C_SOURCE=200809L \
  -Ivendor/cmark src/*.c vendor/cmark/*.c \
  -Wl,--strip-all -Wl,--no-entry -Wl,--export-memory -Wl,-z,stack-size=1048576 $flags \
  -o tree-sitter-md.wasm
printf 'wasm: %s raw, %s gzip -9\n' "$(wc -c < tree-sitter-md.wasm)" "$(gzip -9nc tree-sitter-md.wasm | wc -c)"
# The block grammar is a standard tree-sitter language, loaded by web-tree-sitter.
npx --no-install tree-sitter build --wasm -o tree-sitter-markdown.wasm grammar
printf 'grammar wasm: %s raw, %s gzip -9\n' "$(wc -c < tree-sitter-markdown.wasm)" "$(gzip -9nc tree-sitter-markdown.wasm | wc -c)"
