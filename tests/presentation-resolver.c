#include "inlines.h"
#include "node.h"

#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static cmark_node *parse(const char *source, int options, cmark_reference_map *map) {
  cmark_node *root = cmark_node_new(CMARK_NODE_PARAGRAPH);
  root->len = strlen(source);
  root->data = malloc(root->len + 1);
  assert(root->data);
  memcpy(root->data, source, root->len + 1);
  root->start_line = root->start_column = 1;
  cmark_parse_inlines(cmark_get_default_mem_allocator(), root, map, options, NULL, NULL);
  free(root->data);
  root->data = NULL;
  root->len = 0;
  assert(cmark_node_check(root, NULL) == 0);
  return root;
}

static void exact_nodes(cmark_node *node) {
  for (; node; node = node->next) {
    assert(node->presentation == CMARK_PRESENTATION_EXACT);
    exact_nodes(node->first_child);
  }
}

static void value(cmark_node *node, const char *expected) {
  assert(node && node->len == (int)strlen(expected));
  assert(!memcmp(node->data, expected, node->len));
}

static void range(cmark_node *node, int start, int end) {
  assert(node && node->source_start == start && node->source_end == end);
}

static void nested(cmark_reference_map *map) {
  cmark_node *root = parse("**outside *inside", CMARK_OPT_PRESENTATION, map);
  cmark_node *strong = root->first_child;
  assert(strong && !strong->next && strong->type == CMARK_NODE_STRONG);
  assert(strong->presentation == CMARK_PRESENTATION_DELIMITER);
  range(strong, 0, 17);
  value(strong->first_child, "outside ");
  cmark_node *emphasis = strong->first_child->next;
  assert(emphasis && !emphasis->next && emphasis->type == CMARK_NODE_EMPH);
  assert(emphasis->presentation == CMARK_PRESENTATION_DELIMITER);
  range(emphasis, 10, 17);
  value(emphasis->first_child, "inside");
  cmark_node_free(root);

  root = parse("***x", CMARK_OPT_PRESENTATION, map);
  assert(root->first_child->type == CMARK_NODE_EMPH);
  assert(root->first_child->first_child->type == CMARK_NODE_STRONG);
  value(root->first_child->first_child->first_child, "x");
  cmark_node_free(root);

  root = parse("**a _b**", CMARK_OPT_PRESENTATION, map);
  assert(root->first_child->type == CMARK_NODE_STRONG);
  exact_nodes(root->first_child);
  cmark_node_free(root);

  root = parse("**[x**", CMARK_OPT_PRESENTATION, map);
  exact_nodes(root->first_child);
  cmark_node_free(root);
}

static void pending(cmark_reference_map *map) {
  cmark_node *root = parse("[label](https://exa", CMARK_OPT_PRESENTATION, map);
  cmark_node *link = root->first_child;
  assert(link && !link->next && link->type == CMARK_NODE_LINK);
  assert(link->presentation == CMARK_PRESENTATION_LINK);
  assert(!link->as.link.url && !link->as.link.title);
  range(link, 0, 19);
  assert(link->label_start == 1 && link->label_end == 6);
  value(link->first_child, "label");
  cmark_node_free(root);

  root = parse("![alt](https://exa", CMARK_OPT_PRESENTATION, map);
  assert(root->first_child->type == CMARK_NODE_IMAGE);
  assert(root->first_child->presentation == CMARK_PRESENTATION_IMAGE);
  assert(!root->first_child->as.link.url && !root->first_child->as.link.title);
  value(root->first_child->first_child, "alt");
  cmark_node_free(root);

  root = parse("[**x", CMARK_OPT_PRESENTATION, map);
  assert(root->first_child->presentation == CMARK_PRESENTATION_LINK);
  assert(root->first_child->first_child->presentation == CMARK_PRESENTATION_DELIMITER);
  cmark_node_free(root);

  root = parse("**[x", CMARK_OPT_PRESENTATION, map);
  assert(root->first_child->presentation == CMARK_PRESENTATION_DELIMITER);
  assert(root->first_child->first_child->presentation == CMARK_PRESENTATION_LINK);
  cmark_node_free(root);
}

static void destination_prefixes(cmark_reference_map *map) {
  const char *sources[] = {
    "[x](", "[x](<unfinished", "[x](url(a", "[x](url \"title",
    "[x](url 'title", "[x](url (title", "[x](url \"title\""
  };
  for (size_t i = 0; i < sizeof(sources) / sizeof(*sources); i++) {
    cmark_node *root = parse(sources[i], CMARK_OPT_PRESENTATION, map);
    assert(root->first_child->presentation == CMARK_PRESENTATION_LINK);
    cmark_node_free(root);
  }
  const char *invalid[] = {"[x](url garbage", "[x](<bad\nmore", "[x](url (nested("};
  for (size_t i = 0; i < sizeof(invalid) / sizeof(*invalid); i++) {
    cmark_node *root = parse(invalid[i], CMARK_OPT_PRESENTATION, map);
    exact_nodes(root->first_child);
    cmark_node_free(root);
  }
}

static void literal_payloads(cmark_reference_map *map) {
  cmark_node *root = parse("`x * y  \n", CMARK_OPT_PRESENTATION, map);
  assert(root->first_child->type == CMARK_NODE_CODE);
  assert(root->first_child->presentation == CMARK_PRESENTATION_CODE);
  range(root->first_child, 0, 9);
  value(root->first_child, "x * y   ");
  cmark_node_free(root);

  root = parse("`   ", CMARK_OPT_PRESENTATION, map);
  assert(root->first_child->presentation == CMARK_PRESENTATION_CODE);
  value(root->first_child, "   ");
  cmark_node_free(root);

  root = parse("a $$x * y  \n", CMARK_OPT_PRESENTATION | CMARK_OPT_MATH, map);
  cmark_node *math = root->first_child->next;
  assert(math && !math->next && math->type == CMARK_NODE_INLINE_MATH);
  assert(math->presentation == CMARK_PRESENTATION_MATH);
  range(math, 2, 12);
  value(math, "x * y  \n");
  cmark_node_free(root);

  root = parse("a $$   ", CMARK_OPT_PRESENTATION | CMARK_OPT_MATH, map);
  assert(root->first_child->next->presentation == CMARK_PRESENTATION_MATH);
  value(root->first_child->next, "   ");
  cmark_node_free(root);

  root = parse("**`x  \n", CMARK_OPT_PRESENTATION, map);
  range(root->first_child, 0, 7);
  range(root->first_child->first_child, 2, 7);
  value(root->first_child->first_child, "x   ");
  cmark_node_free(root);

  root = parse("**中文", CMARK_OPT_PRESENTATION | CMARK_OPT_CJK, map);
  assert(root->first_child->type == CMARK_NODE_STRONG);
  range(root->first_child, 0, 8);
  value(root->first_child->first_child, "中文");
  cmark_node_free(root);
}

static void suppression(cmark_reference_map *map) {
  const char *sources[] = {"`", "**", "_", "~~"};
  for (size_t i = 0; i < sizeof(sources) / sizeof(*sources); i++) {
    cmark_node *root = parse(sources[i], CMARK_OPT_PRESENTATION | CMARK_OPT_GFM, map);
    assert(root->first_child->presentation == CMARK_PRESENTATION_SUPPRESSED);
    cmark_node_free(root);
  }
  cmark_node *root = parse("\\*safe* foo_bar", CMARK_OPT_PRESENTATION, map);
  exact_nodes(root->first_child);
  cmark_node_free(root);
}

static void complete_and_exact(cmark_reference_map *map) {
  const char *sources[] = {
    "**outside *inside", "[label](https://exa", "![alt](https://exa", "`x * y",
    "$$x * y", "**", "**x**", "[x](/go)", "![a](/img)", "`x`", "$$x$$"
  };
  for (size_t i = 0; i < sizeof(sources) / sizeof(*sources); i++) {
    cmark_node *root = parse(sources[i], CMARK_OPT_MATH, map);
    exact_nodes(root->first_child);
    cmark_node_free(root);
  }
  cmark_node *root = parse("**outside *inside***", CMARK_OPT_PRESENTATION, map);
  exact_nodes(root->first_child);
  cmark_node_free(root);

  cmark_chunk label = cmark_chunk_literal("x"), url = cmark_chunk_literal("/reference");
  cmark_chunk title = cmark_chunk_literal("");
  cmark_reference_create(map, &label, &url, &title);
  root = parse("[x](unfinished", CMARK_OPT_PRESENTATION, map);
  assert(root->first_child->type == CMARK_NODE_LINK);
  assert(root->first_child->presentation == CMARK_PRESENTATION_EXACT);
  assert(!strcmp((char *)root->first_child->as.link.url, "/reference"));
  cmark_node_free(root);
}

static cmark_node *literal_sequence(cmark_node *node, const char *expected) {
  size_t remaining = strlen(expected);
  while (remaining) {
    assert(node && node->type == CMARK_NODE_TEXT);
    assert(node->len > 0 && (size_t)node->len <= remaining);
    assert(!memcmp(node->data, expected, node->len));
    remaining -= node->len;
    expected += node->len;
    node = node->next;
  }
  return node;
}

static void mixed_delimiters(cmark_reference_map *map) {
  const struct {
    const char *source, *prefix, *text, *suffix;
    int type, start, end;
  } cases[] = {
    {"~_~a_~", "~_", "a_", "", CMARK_NODE_STRIKETHROUGH, 2, 6},
    {"*~~a*~~", "", "~~a", "~~", CMARK_NODE_EMPH, 0, 5},
    {"*~~*a~~*", "", "~~", "a~~*", CMARK_NODE_EMPH, 0, 4}
  };
  for (size_t i = 0; i < sizeof(cases) / sizeof(*cases); i++) {
    cmark_node *root = parse(cases[i].source, CMARK_OPT_CJK | CMARK_OPT_GFM, map);
    cmark_node *span = literal_sequence(root->first_child, cases[i].prefix);
    assert(span && span->type == cases[i].type);
    range(span, cases[i].start, cases[i].end);
    assert(!literal_sequence(span->first_child, cases[i].text));
    assert(!literal_sequence(span->next, cases[i].suffix));
    exact_nodes(root->first_child);
    cmark_node_free(root);
  }
}

int main(void) {
  cmark_reference_map *map = cmark_reference_map_new(cmark_get_default_mem_allocator());
  nested(map);
  pending(map);
  destination_prefixes(map);
  literal_payloads(map);
  suppression(map);
  complete_and_exact(map);
  mixed_delimiters(map);
  cmark_reference_map_free(map);
  puts("native inline presentation: ownership, nesting, destinations, payloads and exact scopes passed");
  return 0;
}
