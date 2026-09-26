#include "resolver.h"
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
static void free_leaf(Leaf *l) { free(l->text); free(l->starts.v); free(l->ends.v); }
int main(void) {
  uint32_t seed=11;
  uint16_t text[1024];
  Document actual={0},expected={0};actual.text=text;expected.text=text;
  const uint16_t specials[]={0,9,10,13,32,127,128,255,0x5d0,0x4e2d,0xd800,0xdbff,0xdc00,0xdfff,0xffff};
  for (uint32_t round=0;round<20000;round++) {
    for(uint32_t j=0;j<1024;j++) {
      seed=seed*1664525+1013904223;
      text[j]=(seed%5) ? (uint16_t)(32+seed%95) : specials[seed%15];
    }
    uint32_t a=seed%256,b=a+((seed>>9)%(1025-a));
    leaf_single(&actual,a,b);
    expected.leaf.n=expected.leaf.starts.n=expected.leaf.ends.n=0;
    bool line_start=true;
    slow_lines(&expected,a,b,&line_start);
    word(&expected.leaf.starts,b);
    assert(actual.leaf.n==expected.leaf.n);
    assert(actual.leaf.starts.n==expected.leaf.starts.n);
    assert(actual.leaf.ends.n==expected.leaf.ends.n);
    if(actual.leaf.n) assert(!memcmp(actual.leaf.text,expected.leaf.text,actual.leaf.n));
    assert(!memcmp(actual.leaf.starts.v,expected.leaf.starts.v,actual.leaf.starts.n*sizeof(uint32_t)));
    if(actual.leaf.ends.n) assert(!memcmp(actual.leaf.ends.v,expected.leaf.ends.v,actual.leaf.ends.n*sizeof(uint32_t)));
  }
  free_leaf(&actual.leaf);free_leaf(&expected.leaf);
  puts("20,000 UTF-16 slices: UTF-8 bytes and every start/end mapping identical to scalar oracle");
}
