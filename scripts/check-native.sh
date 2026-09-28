#!/bin/sh
# Native ASan/UBSan builds. The tree-sitter runtime comes from a tree-sitter-x checkout:
# TREE_SITTER_LIB is its lib/ directory.
set -eu
cd "$(dirname "$0")/.."
: "${TREE_SITTER_LIB:=../tree-sitter-x/lib}"
mkdir -p target/c
flags="-g -O1 -fsanitize=address,undefined -fno-omit-frame-pointer -std=c11 -D_POSIX_C_SOURCE=200809L -D_DEFAULT_SOURCE -Isrc -I$TREE_SITTER_LIB/include -I$TREE_SITTER_LIB/src -Igrammar/src -Ivendor/cmark"
runtime="$TREE_SITTER_LIB/src/lib.c grammar/src/parser.c grammar/src/scanner.c"
clang $flags tests/native.c src/*.c vendor/cmark/*.c $runtime -o target/c/check-native
ASAN_OPTIONS=detect_leaks=1 target/c/check-native
printf 'ASan + UBSan: 2,000 incremental edits passed\n'
# The leaf test includes src/leaf.c to reach its static helpers.
clang $flags tests/leaf-map.c $(ls src/*.c | grep -v '^src/leaf\.c$') vendor/cmark/*.c $runtime -o target/c/check-leaf-map
ASAN_OPTIONS=detect_leaks=1 target/c/check-leaf-map
sh scripts/check-cursor.sh
