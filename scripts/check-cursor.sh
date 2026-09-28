#!/bin/sh
# Native ASan/UBSan builds. The tree-sitter runtime comes from a tree-sitter-x checkout:
# TREE_SITTER_LIB is its lib/ directory.
set -eu
cd "$(dirname "$0")/.."
: "${TREE_SITTER_LIB:=../tree-sitter-x/lib}"
mkdir -p target/c
flags="-g -O1 -fsanitize=address,undefined -fno-omit-frame-pointer -std=c11 -D_POSIX_C_SOURCE=200809L -D_DEFAULT_SOURCE -Isrc -I$TREE_SITTER_LIB/include -I$TREE_SITTER_LIB/src -Igrammar/src -Ivendor/cmark"
runtime="$TREE_SITTER_LIB/src/lib.c grammar/src/parser.c grammar/src/scanner.c"
clang $flags tests/cursor-seek.c src/*.c vendor/cmark/*.c $runtime -o target/c/check-cursor
ASAN_OPTIONS=detect_leaks=1 target/c/check-cursor
