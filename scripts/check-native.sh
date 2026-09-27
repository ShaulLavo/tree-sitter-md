#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p target/c
clang -g -O1 -fsanitize=address,undefined -fno-omit-frame-pointer -std=c11 -D_POSIX_C_SOURCE=200809L -D_DEFAULT_SOURCE \
 -Isrc -Ivendor/tree-sitter/include -Ivendor/tree-sitter/src -Igrammar/src -Ivendor/cmark \
 tests/native.c src/*.c vendor/cmark/*.c vendor/tree-sitter/src/lib.c grammar/src/parser.c grammar/src/scanner.c \
 -o target/c/check-native
ASAN_OPTIONS=detect_leaks=1 target/c/check-native
printf 'ASan + UBSan: 2,000 incremental edits passed\n'
# The leaf test includes src/leaf.c to reach its static helpers.
clang -g -O1 -fsanitize=address,undefined -fno-omit-frame-pointer -std=c11 -D_POSIX_C_SOURCE=200809L -D_DEFAULT_SOURCE \
 -Isrc -Ivendor/tree-sitter/include -Ivendor/tree-sitter/src -Igrammar/src -Ivendor/cmark \
 tests/leaf-map.c $(ls src/*.c | grep -v '^src/leaf\.c$') vendor/cmark/*.c vendor/tree-sitter/src/lib.c grammar/src/parser.c grammar/src/scanner.c \
 -o target/c/check-leaf-map
ASAN_OPTIONS=detect_leaks=1 target/c/check-leaf-map
sh scripts/check-cursor.sh
