#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p target/c
flags='-g -O1 -fsanitize=address,undefined -fno-omit-frame-pointer -std=c11 -D_POSIX_C_SOURCE=200809L -D_DEFAULT_SOURCE -Isrc -Ivendor/cmark'
clang $flags tests/native.c src/*.c vendor/cmark/*.c -o target/c/check-native
ASAN_OPTIONS=detect_leaks=1 target/c/check-native
# The leaf test includes src/leaf.c to reach its static helpers.
clang $flags tests/leaf-map.c $(ls src/*.c | grep -v '^src/leaf\.c$') vendor/cmark/*.c -o target/c/check-leaf-map
ASAN_OPTIONS=detect_leaks=1 target/c/check-leaf-map
