#include "../src/semantic.c"
#include "native-language.h"
#include <assert.h>
#include <stdio.h>

void tsmd_free(Document *);
uint16_t *tsmd_input(Document *, uint32_t);
void tsmd_set_text(Document *);

static void check_entries(Semantic *semantic, TSNode node) {
  Document *document = semantic->d;
  bool list = is(node, document->ids.list), item = is(node, document->ids.list_item);
  if (list || item) assert(!container_spread(semantic, node));
  for (uint32_t i = 0; i < ts_node_named_child_count(node); i++)
    check_entries(semantic, ts_node_named_child(node, i));
}
static void check_nested(uint32_t depth, uint32_t length) {
  Document *document = test_document(0);
  uint32_t size = depth * 4 + 5 + length + 1;
  uint16_t *input = tsmd_input(document, size);
  for (uint32_t i = 0; i < depth * 4; i++) input[i] = "- > "[i % 4];
  for (uint32_t i = 0; i < 5; i++) input[depth * 4 + i] = "body "[i];
  for (uint32_t i = depth * 4 + 5; i < size - 1; i++) input[i] = 'x';
  input[size - 1] = '\n';
  tsmd_set_text(document);
  Semantic semantic = {.d = document};
  TSNode list = ts_tree_root_node(document->tree);
  while (!is(list, document->ids.list)) {
    assert(ts_node_named_child_count(list));
    list = ts_node_named_child(list, 0);
  }
  assert(!container_spread(&semantic, list));
  assert(semantic.spreads.count == depth * 3);
  for (uint32_t i = 0; i < semantic.spreads.cap; i++) {
    SpreadEntry entry = semantic.spreads.entries[i];
    if (ts_node_is_null(entry.node)) continue;
    assert(entry.value.end == size - 1);
  }
  check_entries(&semantic, list);
  assert(semantic.spreads.count == depth * 3);
  free(semantic.spreads.entries);
  tsmd_free(document);
}
int main(void) {
  const uint32_t depths[] = {1, 16, 64}, lengths[] = {8192, 131072};
  for (uint32_t i = 0; i < 3; i++) {
    for (uint32_t j = 0; j < 2; j++) check_nested(depths[i], lengths[j]);
  }
  puts("Quote spread: six size/depth cases, one summary per container and reused owner results passed");
  return 0;
}
