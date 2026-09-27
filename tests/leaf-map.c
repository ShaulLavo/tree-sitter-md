// Included directly so the test can drive the static multi-segment path.
#include "../src/leaf.c"
#include <assert.h>
#include <stdio.h>
// Scalar baseline is the independent mapping oracle.
static void slow_character(Leaf *l, uint32_t c, uint32_t a, uint32_t b) {
  uint8_t bytes[4];
  int n = 1;
  if (c < 0x80)
    bytes[0] = c;
  else if (c < 0x800) {
    n = 2;
    bytes[0] = 0xc0 | (c >> 6);
    bytes[1] = 0x80 | (c & 63);
  } else if (c < 0x10000) {
    n = 3;
    bytes[0] = 0xe0 | (c >> 12);
    bytes[1] = 0x80 | ((c >> 6) & 63);
    bytes[2] = 0x80 | (c & 63);
  } else {
    n = 4;
    bytes[0] = 0xf0 | (c >> 18);
    bytes[1] = 0x80 | ((c >> 12) & 63);
    bytes[2] = 0x80 | ((c >> 6) & 63);
    bytes[3] = 0x80 | (c & 63);
  }
  reserve((void **)&l->text, &l->cap, l->n + n + 1, 1);
  memcpy(l->text + l->n, bytes, n);
  l->n += n;
  l->text[l->n] = 0;
  for (int i = 0; i < n; i++) {
    word(&l->starts, a);
    word(&l->ends, b);
  }
}
static void slow_lines(Document *d, uint32_t a, uint32_t b, bool *line_start) {
  while (a < b) {
    uint32_t c = d->text[a], n = 1;
    if (*line_start && (c == ' ' || c == '\t')) {
      a++;
      continue;
    }
    *line_start = false;
    if (c >= 0xd800 && c < 0xdc00 && a + 1 < b && d->text[a + 1] >= 0xdc00 &&
        d->text[a + 1] < 0xe000) {
      c = 0x10000 + ((c - 0xd800) << 10) + (d->text[a + 1] - 0xdc00);
      n = 2;
    }
    if (c >= 0xd800 && c < 0xe000)
      c = 0xfffd;
    if (!c)
      c = 0xfffd;
    slow_character(&d->leaf, c, a, a + n);
    a += n;
    if (c == '\n')
      *line_start = true;
  }
}
static void free_leaf(Leaf *l) {
  free(l->text);
  free(l->starts.v);
  free(l->ends.v);
}
static void same(Leaf *actual, Leaf *expected) {
  assert(actual->n == expected->n);
  assert(actual->starts.n == expected->starts.n);
  assert(actual->ends.n == expected->ends.n);
  if (actual->n)
    assert(!memcmp(actual->text, expected->text, actual->n + 1));
  if (actual->starts.n)
    assert(!memcmp(actual->starts.v, expected->starts.v, actual->starts.n * sizeof(uint32_t)));
  if (actual->ends.n)
    assert(!memcmp(actual->ends.v, expected->ends.v, actual->ends.n * sizeof(uint32_t)));
}
static uint32_t next(uint32_t *seed) {
  *seed = *seed * 1664525 + 1013904223;
  return *seed >> 8;
}
// Mode 0 is pure ASCII so long multi-line fast runs occur; mode 1 has rare
// non-ASCII lines; mode 2 falls back to the scalar loop every few characters.
static void fill(uint16_t *text, uint32_t n, uint32_t mode, uint32_t *seed) {
  const uint16_t ascii[] = {9, 10, 10, 13, 32, 32, 127};
  const uint16_t specials[] = {0,   9,     10,     13,     32,     127,    128,   255,
                               0x5d0, 0x4e2d, 0xd83d, 0xde00, 0xd800, 0xdbff, 0xdc00, 0xdfff, 0xffff};
  uint32_t rare[] = {0, 200, 5};
  for (uint32_t j = 0; j < n; j++) {
    uint32_t k = next(seed);
    if (mode && !(k % rare[mode]))
      text[j] = specials[(k >> 8) % (sizeof(specials) / sizeof(*specials))];
    else if (k % 4)
      text[j] = 32 + (k >> 8) % 95;
    else
      text[j] = ascii[(k >> 8) % (sizeof(ascii) / sizeof(*ascii))];
  }
}
int main(void) {
  uint32_t seed = 11;
  static uint16_t text[4096];
  Document actual = {0}, expected = {0};
  actual.text = expected.text = text;
  for (uint32_t round = 0; round < 30000; round++) {
    fill(text, 4096, round % 3, &seed);
    uint32_t a = next(&seed) % 256, b = a + next(&seed) % (4097 - a);
    leaf_single(&actual, a, b);
    leaf_clear(&expected.leaf);
    bool line_start = true;
    slow_lines(&expected, a, b, &line_start);
    word(&expected.leaf.starts, b);
    same(&actual.leaf, &expected.leaf);
  }
  // leaf_build converts a block in segments separated by continuation markers
  // and carries line_start across them.
  for (uint32_t round = 0; round < 30000; round++) {
    fill(text, 4096, round % 3, &seed);
    uint32_t count = 2 + next(&seed) % 14, a = next(&seed) % 64;
    bool actual_start = true, expected_start = true;
    leaf_clear(&actual.leaf);
    leaf_clear(&expected.leaf);
    for (uint32_t i = 1; i < count; i++) {
      uint32_t b = a + next(&seed) % 256;
      push_lines(&actual, a, b, &actual_start);
      slow_lines(&expected, a, b, &expected_start);
      assert(actual_start == expected_start);
      a = b + next(&seed) % 4;
    }
    same(&actual.leaf, &expected.leaf);
  }
  free_leaf(&actual.leaf);
  free_leaf(&expected.leaf);
  puts("Leaf map: 30,000 slices and 30,000 segmented blocks identical to scalar oracle");
}
