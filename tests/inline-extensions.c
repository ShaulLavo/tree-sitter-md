#include "node.h"
#include "inlines.h"
#include "references.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct { const char *source; int flags; const char *expected; } InlineCase;
static const InlineCase cases[] = {
#include "inline-vectors.inc"
  {"p [^known] q", 4, "T{p }F{KNOWN}T{ q}"},
  {"p \\[^known] q", 4, "T{p [^known] q}"},
  {"p `[^known]` q", 4, "T{p }C{[^known]}T{ q}"},
  {"p [^unknown] q", 4, "T{p [^unknown] q}"},
  {"p [\\^known] q", 4, "T{p [^known] q}"},
  {"p [^known] q", 0, "T{p [^known] q}"},
  {"p ![^known] q", 4, "T{p !}F{KNOWN}T{ q}"},
  {"p ![^known] q", 0, "T{p ![^known] q}"},
  {"p [ordinary][^known] q", 4, "T{p [ordinary]}F{KNOWN}T{ q}"},
  {"p ![image][^known] q", 4, "T{p ![image]}F{KNOWN}T{ q}"},
};

static const char *lookup_footnote(void *context, const unsigned char *label, uint32_t length) {
  assert(context == cases);
  return length == 5 && !memcmp(label, "known", 5) ? "KNOWN" : NULL;
}

static char tag(cmark_node *node) {
  switch (node->type) {
  case CMARK_NODE_TEXT: return 'T';
  case CMARK_NODE_EMPH: return 'E';
  case CMARK_NODE_STRONG: return 'S';
  case CMARK_NODE_STRIKETHROUGH: return 'D';
  case CMARK_NODE_CODE: return 'C';
  case CMARK_NODE_INLINE_MATH: return 'M';
  case CMARK_NODE_FOOTNOTE_REFERENCE: return 'F';
  case CMARK_NODE_SOFTBREAK: return 'N';
  case CMARK_NODE_LINEBREAK: return 'B';
  case CMARK_NODE_HTML_INLINE: return 'H';
  case CMARK_NODE_LINK: return 'L';
  case CMARK_NODE_IMAGE: return 'I';
  default: abort();
  }
}
static void describe(cmark_node *node, cmark_strbuf *out);
static cmark_node *describe_one(cmark_node *node, cmark_strbuf *out) {
  cmark_strbuf_putc(out, tag(node));
  cmark_strbuf_putc(out, '{');
  if (node->type == CMARK_NODE_TEXT) {
    do {
      cmark_strbuf_put(out, node->data, node->len);
      node = node->next;
    } while (node && node->type == CMARK_NODE_TEXT);
    cmark_strbuf_putc(out, '}');
    return node;
  }
  if (node->data)
    cmark_strbuf_put(out, node->data, node->len);
  describe(node->first_child, out);
  cmark_strbuf_putc(out, '}');
  return node->next;
}
static void describe(cmark_node *node, cmark_strbuf *out) {
  while (node)
    node = describe_one(node, out);
}
static void ranges(cmark_node *node, const char *source) {
  for (; node; node = node->next) {
    assert(node->source_start >= 0 && node->source_start <= node->source_end);
    assert((uint32_t)node->source_end <= strlen(source));
    if (node->type == CMARK_NODE_INLINE_MATH)
      assert(source[node->source_start] == '$' && source[node->source_end - 1] == '$');
    if (node->type == CMARK_NODE_FOOTNOTE_REFERENCE)
      assert(source[node->source_start] == '[' && source[node->source_end - 1] == ']');
    ranges(node->first_child, source);
  }
}
static cmark_node *parse(const char *source, int flags) {
  cmark_mem *mem = cmark_get_default_mem_allocator();
  cmark_reference_map *map = cmark_reference_map_new(mem);
  map->lookup_footnote = lookup_footnote;
  map->footnote_context = (void *)cases;
  cmark_node *node = cmark_node_new(CMARK_NODE_PARAGRAPH);
  node->start_line = node->start_column = 1;
  node->len = strlen(source);
  node->data = mem->realloc(NULL, node->len + 1);
  memcpy(node->data, source, node->len + 1);
  int options = CMARK_OPT_GFM | CMARK_OPT_SOURCEPOS;
  if (flags & 1) options |= CMARK_OPT_CJK;
  if (flags & 2) options |= CMARK_OPT_MATH;
  if (flags & 4) options |= CMARK_OPT_FOOTNOTES;
  cmark_parse_inlines(mem, node, map, options, NULL, NULL);
  mem->free(node->data);
  node->data = NULL;
  node->len = 0;
  cmark_reference_map_free(map);
  ranges(node->first_child, source);
  return node;
}
static void check_case(const InlineCase *item) {
  cmark_node *node = parse(item->source, item->flags);
  cmark_strbuf actual = CMARK_BUF_INIT(cmark_get_default_mem_allocator());
  describe(node->first_child, &actual);
  if (strcmp((char *)actual.ptr, item->expected)) {
    fprintf(stderr, "Inline mismatch for %s\nexpected %s\nactual   %s\n", item->source, item->expected, actual.ptr);
    abort();
  }
  cmark_strbuf_free(&actual);
  cmark_node_free(node);
}
static void check_long_sequences(void) {
  cmark_strbuf source = CMARK_BUF_INIT(cmark_get_default_mem_allocator());
  for (uint32_t length = 2; length < 512; length++) {
    for (uint32_t i = 0; i < length; i++)
      cmark_strbuf_putc(&source, '$');
    cmark_strbuf_putc(&source, 'x');
  }
  cmark_node *node = parse((char *)source.ptr, 2);
  assert(node->first_child && !node->first_child->first_child);
  cmark_node_free(node);
  cmark_strbuf_free(&source);
}
int main(void) {
  for (size_t i = 0; i < sizeof(cases) / sizeof(*cases); i++)
    check_case(&cases[i]);
  check_long_sequences();
  printf("%zu inline vectors and adversarial dollar lengths passed\n", sizeof(cases) / sizeof(*cases));
  return 0;
}
