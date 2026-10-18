#include "inlines.h"
#include "node.h"

#include <assert.h>
#include <stdlib.h>
#include <string.h>

static cmark_mem *mem;

static cmark_node *parse(const char *source, cmark_reference_map *map,
                          cmark_reference_uses *uses, int options) {
  cmark_node *root = cmark_node_new(CMARK_NODE_PARAGRAPH);
  root->data = (unsigned char *)strdup(source);
  assert(root->data);
  root->len = strlen(source);
  root->start_line = root->start_column = 1;
  cmark_parse_inlines(mem, root, map, options, uses);
  free(root->data); root->data = NULL; root->len = 0;
  assert(cmark_node_check(root, NULL) == 0);
  return root;
}

static void use(const cmark_reference_uses *uses, size_t index,
                  const char *identifier, int start, int end, bool resolved,
                  cmark_reference_form form, bool image) {
  assert(index < uses->count);
  const cmark_reference_use *item = &uses->items[index];
  assert(!strcmp((const char *)item->identifier, identifier));
  assert(item->start == start && item->end == end);
  assert(item->resolved == resolved && item->form == form && item->image == image);
}

static void define(cmark_reference_map *map, const char *label) {
  cmark_chunk name = {(unsigned char *)label, strlen(label)};
  cmark_chunk url = cmark_chunk_literal("/go"), title = cmark_chunk_literal("");
  cmark_reference_create(map, &name, &url, &title);
}

static const char *note(void *context, const unsigned char *label, uint32_t length) {
  return context && length == 1 && label[0] == 'n' ? "n" : NULL;
}

static void rollback(cmark_reference_map *map) {
  cmark_reference_uses uses = {0};
  cmark_node *root = parse("[x][ID]", map, &uses, 0);
  assert(uses.count == 1);
  use(&uses, 0, "id", 0, 7, false, CMARK_REFERENCE_FULL, false);
  cmark_node_free(root);
  assert(!strcmp((const char *)uses.items[0].identifier, "id"));
  cmark_reference_uses_free(mem, &uses);
  assert(!uses.items && !uses.count && !uses.capacity);

  root = parse("![a][id]", map, &uses, CMARK_OPT_PRESENTATION);
  assert(uses.count == 1);
  use(&uses, 0, "id", 0, 8, false, CMARK_REFERENCE_FULL, true);
  cmark_node_free(root); cmark_reference_uses_free(mem, &uses);
}

static void latent(cmark_reference_map *map) {
  cmark_reference_uses uses = {0};
  cmark_node *root = parse("[outer [inner][missing]](/url)", map, &uses, 0);
  assert(root->first_child->type == CMARK_NODE_LINK && !root->first_child->next);
  assert(uses.count == 1);
  use(&uses, 0, "missing", 7, 23, false, CMARK_REFERENCE_FULL, false);
  cmark_node_free(root); cmark_reference_uses_free(mem, &uses);

  root = parse("![alt [inner][id]](/img)", map, &uses, 0);
  assert(root->first_child->type == CMARK_NODE_IMAGE);
  assert(uses.count == 1);
  use(&uses, 0, "id", 6, 17, false, CMARK_REFERENCE_FULL, false);
  cmark_node_free(root); cmark_reference_uses_free(mem, &uses);
}

static void inline_destinations(cmark_reference_map *map) {
  const char *sources[] = {"[label](https://exa", "[label](/url)", "![a](/img)"};
  for (size_t i = 0; i < sizeof(sources) / sizeof(*sources); i++) {
    cmark_reference_uses uses = {0};
    cmark_node *root = parse(sources[i], map, &uses, CMARK_OPT_PRESENTATION);
    assert(uses.count == 0);
    cmark_node_free(root); cmark_reference_uses_free(mem, &uses);
  }
}

static void footnotes(cmark_reference_map *map) {
  map->lookup_footnote = note;
  cmark_reference_uses uses = {0};
  cmark_node *root = parse("[^n]", map, &uses, CMARK_OPT_FOOTNOTES);
  assert(uses.count == 1);
  use(&uses, 0, "n", 0, 4, false, CMARK_REFERENCE_FOOTNOTE, false);
  cmark_node_free(root); cmark_reference_uses_free(mem, &uses);

  root = parse("[^n][ID]", map, &uses, CMARK_OPT_FOOTNOTES);
  assert(uses.count == 1);
  use(&uses, 0, "id", 0, 8, false, CMARK_REFERENCE_FULL, false);
  cmark_node_free(root); cmark_reference_uses_free(mem, &uses);

  map->footnote_context = map;
  root = parse("[^n]", map, &uses, CMARK_OPT_FOOTNOTES);
  assert(root->first_child->type == CMARK_NODE_FOOTNOTE_REFERENCE);
  assert(uses.count == 1);
  use(&uses, 0, "n", 0, 4, true, CMARK_REFERENCE_FOOTNOTE, false);
  cmark_node_free(root); cmark_reference_uses_free(mem, &uses);
  map->lookup_footnote = NULL; map->footnote_context = NULL;
}

static void invalidated(void) {
  cmark_reference_map *map = cmark_reference_map_new(mem);
  define(map, "d");
  cmark_reference_uses uses = {0};
  cmark_node *root = parse("[a [b](/u) [c]][d]", map, &uses, 0);
  assert(root->first_child->type == CMARK_NODE_TEXT);
  assert(root->first_child->next->type == CMARK_NODE_TEXT);
  assert(uses.count == 2);
  use(&uses, 0, "c", 11, 14, false, CMARK_REFERENCE_SHORTCUT, false);
  use(&uses, 1, "d", 15, 18, true, CMARK_REFERENCE_SHORTCUT, false);
  cmark_node_free(root); cmark_reference_uses_free(mem, &uses);
  cmark_reference_map_free(map);

  map = cmark_reference_map_new(mem); define(map, "c");
  root = parse("[a][b][c]", map, &uses, 0);
  assert(uses.count == 2);
  use(&uses, 0, "b", 0, 6, false, CMARK_REFERENCE_FULL, false);
  use(&uses, 1, "c", 3, 9, true, CMARK_REFERENCE_FULL, false);
  cmark_node_free(root); cmark_reference_uses_free(mem, &uses);
  cmark_reference_map_free(map);
}

static void label_limits(cmark_reference_map *map) {
  size_t length = MAX_LINK_LABEL_LENGTH + 1;
  char *source = malloc(length + 7);
  assert(source);
  source[0] = '[';
  memset(source + 1, 'a', length);
  source[length + 1] = ']'; source[length + 2] = 0;
  cmark_reference_uses uses = {0};
  cmark_node *root = parse(source, map, &uses, 0);
  assert(uses.count == 0);
  cmark_node_free(root); cmark_reference_uses_free(mem, &uses);

  memcpy(source + length + 2, "[id]", 5);
  root = parse(source, map, &uses, 0);
  assert(uses.count == 1);
  use(&uses, 0, "id", 0, length + 6, false, CMARK_REFERENCE_FULL, false);
  cmark_node_free(root); cmark_reference_uses_free(mem, &uses);
  free(source);
}

static void unicode_labels(const char *scalar) {
  size_t width = strlen(scalar);
  char *label = malloc((MAX_LINK_LABEL_LENGTH + 1) * width + 1);
  char *source = malloc((MAX_LINK_LABEL_LENGTH + 1) * width + 3);
  assert(label && source);
  for (size_t count = MAX_LINK_LABEL_LENGTH; count <= MAX_LINK_LABEL_LENGTH + 1; count++) {
    for (size_t i = 0; i < count; i++) memcpy(label + i * width, scalar, width);
    label[count * width] = 0;
    source[0] = '[';
    memcpy(source + 1, label, count * width);
    source[count * width + 1] = ']'; source[count * width + 2] = 0;
    cmark_reference_map *map = cmark_reference_map_new(mem);
    define(map, label);
    cmark_reference_uses uses = {0};
    cmark_node *root = parse(source, map, &uses, 0);
    assert(uses.count == (count == MAX_LINK_LABEL_LENGTH ? 1 : 0));
    if (uses.count) use(&uses, 0, label, 0, count * width + 2, true, CMARK_REFERENCE_SHORTCUT, false);
    cmark_node_free(root); cmark_reference_uses_free(mem, &uses);
    cmark_reference_map_free(map);
  }
  free(label); free(source);
}

int main(void) {
  mem = cmark_get_default_mem_allocator();
  cmark_reference_map *map = cmark_reference_map_new(mem);
  rollback(map); latent(map); inline_destinations(map); footnotes(map); label_limits(map);
  cmark_reference_map_free(map);
  invalidated(); unicode_labels("字"); unicode_labels("🙂");
  return 0;
}
