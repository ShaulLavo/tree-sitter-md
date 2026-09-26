/* Isolated tests of the real scanner's allocation and serialization contract. */
#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static size_t realloc_calls;
static void *poison_malloc(size_t size) {
    void *p = malloc(size);
    if (!p) abort();
    memset(p, 0xa5, size);
    return p;
}
static void *counted_realloc(void *p, size_t size) {
    realloc_calls++;
    void *q = realloc(p, size);
    if (!q && size) abort();
    return q;
}
#define malloc poison_malloc
#define realloc counted_realloc
#include "scanner.c"
#undef realloc
#undef malloc
#ifndef EXPECT_REUSE
#define EXPECT_REUSE 0
#endif
#define CHECK(x) do { if (!(x)) { fprintf(stderr, "check failed: %s (line %d)\n", #x, __LINE__); exit(1); } } while (0)
static uint32_t random32(uint32_t *seed) {
    *seed = *seed * UINT32_C(1664525) + UINT32_C(1013904223);
    return *seed;
}
int main(void) {
    const uint32_t seeds[] = {1, 7, 8675309};
    size_t checks = 0, total_reallocs = 0;
    for (size_t run = 0; run < sizeof(seeds) / sizeof(seeds[0]); run++) {
        Scanner *s = tree_sitter_markdown_external_scanner_create();
        CHECK(s->open_blocks.capacity == 0);
        CHECK(s->open_blocks.size == 0);
        uint32_t seed = seeds[run];
        for (size_t step = 0; step < 100000; step++) {
            Block blocks[128];
            size_t depth = random32(&seed) % 129;
            Scanner expected = {0};
            expected.open_blocks.items = blocks;
            expected.open_blocks.size = depth;
            expected.state = random32(&seed) & 0x13;
            expected.matched = depth ? random32(&seed) % (depth + 1) : 0;
            expected.indentation = random32(&seed) % 20;
            expected.column = random32(&seed) % 4;
            expected.fenced_code_block_delimiter_length = random32(&seed) % 250;
            for (size_t i = 0; i < depth; i++) blocks[i] = random32(&seed) % (ANONYMOUS + 1);
            char input[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
            char output[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
            unsigned length = serialize(&expected, input);
            CHECK(length <= sizeof(input));
            size_t capacity = s->open_blocks.capacity;
            Block *pointer = s->open_blocks.items;
            size_t calls = realloc_calls;
            deserialize(s, input, length);
            CHECK(s->open_blocks.size == depth);
            CHECK(s->open_blocks.capacity >= depth);
            unsigned actual = serialize(s, output);
            CHECK(actual == length && memcmp(input, output, length) == 0);
            if (EXPECT_REUSE && depth <= capacity) {
                CHECK(s->open_blocks.capacity == capacity);
                CHECK(s->open_blocks.items == pointer);
                CHECK(realloc_calls == calls);
            }
            if (step % 17 == 0) {
                capacity = s->open_blocks.capacity;
                pointer = s->open_blocks.items;
                calls = realloc_calls;
                deserialize(s, NULL, 0);
                CHECK(s->open_blocks.size == 0);
                actual = serialize(s, output);
                CHECK(actual == 5);
                for (unsigned i = 0; i < actual; i++) CHECK(output[i] == 0);
                if (EXPECT_REUSE) {
                    CHECK(s->open_blocks.capacity == capacity);
                    CHECK(s->open_blocks.items == pointer);
                    CHECK(realloc_calls == calls);
                }
                for (unsigned i = 0; i < 10; i++) push_block(s, BLOCK_QUOTE);
                for (unsigned i = 0; i < 10; i++) CHECK(pop_block(s) == BLOCK_QUOTE);
                CHECK(s->open_blocks.size == 0);
            }
            checks++;
        }
        total_reallocs += realloc_calls;
        realloc_calls = 0;
        tree_sitter_markdown_external_scanner_destroy(s);
    }
    printf("{\"state_checks\":%zu,\"seeds\":3,\"expect_reuse\":%d,\"realloc_calls\":%zu}\n", checks, EXPECT_REUSE, total_reallocs);
    return 0;
}
