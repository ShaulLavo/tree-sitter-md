#!/bin/sh
# Native ASan/UBSan builds. The tree-sitter runtime comes from a tree-sitter-x checkout:
# TREE_SITTER_LIB is its lib/ directory.
set -eu
cd "$(dirname "$0")/.."
: "${TREE_SITTER_LIB:=../tree-sitter-x/lib}"
mkdir -p target/c
flags="-g -O1 -fsanitize=address,undefined -fno-omit-frame-pointer -std=c11 -D_POSIX_C_SOURCE=200809L -D_DEFAULT_SOURCE -Isrc -I$TREE_SITTER_LIB/include -I$TREE_SITTER_LIB/src -Igrammar/src -Ivendor/cmark"
runtime="$TREE_SITTER_LIB/src/lib.c grammar/src/parser.c grammar/src/scanner.c grammar/chat/src/parser.c grammar/chat/scanner.c"
clang $flags tests/native.c tests/autolink-cjk.c src/*.c vendor/cmark/*.c $runtime -o target/c/check-native
ASAN_OPTIONS=detect_leaks=1 target/c/check-native
printf 'ASan + UBSan: streaming semantic prefixes, ownership and 2,000 incremental decoration/semantic edits passed\n'
clang $flags tests/presentation-inline.c src/*.c vendor/cmark/*.c $runtime -o target/c/check-presentation-inline
ASAN_OPTIONS=detect_leaks=1 target/c/check-presentation-inline
clang $flags tests/nested-definition-lists.c src/*.c vendor/cmark/*.c $runtime -o target/c/check-nested-definition-lists
ASAN_OPTIONS=detect_leaks=1 target/c/check-nested-definition-lists
clang $flags tests/quote-spread.c $(ls src/*.c | grep -v '^src/semantic\.c$') vendor/cmark/*.c $runtime -o target/c/check-quote-spread
ASAN_OPTIONS=detect_leaks=1 target/c/check-quote-spread
clang $flags tests/presentation-resolver.c vendor/cmark/*.c -o target/c/check-presentation-resolver
ASAN_OPTIONS=detect_leaks=1 target/c/check-presentation-resolver
clang $flags tests/presentation-references.c vendor/cmark/*.c -o target/c/check-presentation-references
ASAN_OPTIONS=detect_leaks=1 target/c/check-presentation-references
clang $flags tests/footnote.c src/*.c vendor/cmark/*.c $runtime -o target/c/check-footnote
ASAN_OPTIONS=detect_leaks=1 target/c/check-footnote
printf 'ASan + UBSan: footnote definitions, references and mapped bodies passed\n'
# The leaf test includes src/leaf.c to reach its static helpers.
clang $flags tests/leaf-map.c $(ls src/*.c | grep -v '^src/leaf\.c$') vendor/cmark/*.c $runtime -o target/c/check-leaf-map
ASAN_OPTIONS=detect_leaks=1 target/c/check-leaf-map
clang $flags tests/allocation.c $(ls src/*.c | grep -v '^src/leaf\.c$') vendor/cmark/*.c $runtime -o target/c/check-allocation
ASAN_OPTIONS=detect_leaks=1 target/c/check-allocation
printf 'ASan + UBSan: supported reserve allocation-abort contract passed\n'
sh scripts/check-cursor.sh
