#include "inlines.h"
#include "node.h"
#include <stdlib.h>
#include <string.h>

// Shares the host allocator and accepts a pointer into the host's linear memory.
int tsmd_probe_inline(char *text, unsigned length) {
  cmark_node *root = cmark_node_new(CMARK_NODE_PARAGRAPH);
  root->data = (unsigned char *)text;
  root->len = length;
  cmark_reference_map *refs = cmark_reference_map_new(cmark_get_default_mem_allocator());
  cmark_parse_inlines(cmark_get_default_mem_allocator(), root, refs, 0);
  int count = 0;
  for (cmark_node *n = root->first_child; n; n = n->next)
    if (n->type == CMARK_NODE_STRONG)
      count++;
  root->data = NULL;
  root->len = 0;
  cmark_node_free(root);
  cmark_reference_map_free(refs);
  return count;
}
