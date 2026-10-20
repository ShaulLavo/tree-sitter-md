#include "resolver.h"
#include <assert.h>
#include <stdio.h>

static void check(uint16_t *source, uint32_t length, bool cjk, uint32_t from) {
  Document document = {0};
  document.text = source;
  document.len = length;
  leaf_single(&document, 0, length);
  assert(document.leaf.source == source);
  cmark_reference_map *defs = cmark_reference_map_new(cmark_get_default_mem_allocator());
  Words records = {0};
  Labels deps = {0};
  inline_resolve(&document.leaf, PARAGRAPH, true, cjk, false, defs, &records, &deps);
  uint32_t found = 0;
  for (uint32_t i = 0; i < records.n; i += 4) {
    if (records.v[i + 2] != STRONG) continue;
    assert(records.v[i] == from && records.v[i + 1] == 11);
    found++;
  }
  assert(found == 1);
  cmark_reference_map_free(defs);
  for (uint32_t i = 0; i < deps.n; i++) free(deps.v[i]);
  free(deps.v);
  free(records.v);
  free(document.leaf.text);
  free(document.leaf.starts.v);
  free(document.leaf.ends.v);
}

int main(void) {
  uint16_t source[] = {'*', '*', 'a', '/', '*', '*', '*', '*', 'b', '*', '*', 0xd83e, 0xddd1};
  for (uint32_t cjk = 0; cjk < 2; cjk++) {
    source[11] = 0xd83e;
    check(source, 12, cjk, 0);
    check(source, 13, cjk, 6);
    source[11] = 0xddd1;
    check(source, 12, cjk, 0);
    source[11] = 0xfffd;
    check(source, 12, cjk, 6);
  }
  puts("UTF16 attention source context: high, low, pair, authored FFFD, CJK on/off passed");
}
