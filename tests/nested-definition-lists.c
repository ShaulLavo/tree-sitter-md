#include "resolver.h"
#include "native-language.h"
#include <assert.h>
#include <stdio.h>

void tsmd_free(Document *);
uint16_t *tsmd_input(Document *, uint32_t);
void tsmd_set_text(Document *);
uint32_t tsmd_semantics(Document *);
uint32_t tsmd_presentation(Document *, uint32_t);
char *tsmd_semantic_out(Document *);
void tsmd_semantic_release(Document *);

static void set_ascii(Document *document, const char *source) {
  uint32_t length = strlen(source);
  uint16_t *input = tsmd_input(document, length);
  for (uint32_t i = 0; i < length; i++) input[i] = (unsigned char)source[i];
  tsmd_set_text(document);
}
static void expect_payload(Document *document, const char *value, bool spread) {
  const char *json = tsmd_semantic_out(document);
  assert(strstr(json, value));
  assert(strstr(json, "\"url\":\"/target\""));
  assert(strstr(json, spread ? "\"spread\":true" : "\"spread\":false"));
  tsmd_semantic_release(document);
}
static void check_modes(Document *document, const char *value, bool spread) {
  assert(tsmd_semantics(document));
  expect_payload(document, value, spread);
  assert(tsmd_presentation(document, 0));
  expect_payload(document, value, spread);
  assert(tsmd_presentation(document, 1));
  expect_payload(document, value, spread);
}
static void check_padding(uint32_t flags) {
  Document *document = test_document(flags);
  set_ascii(document, "- > [x]: /target\n\tcode\n\n[x]");
  check_modes(document, "\"value\":\"  code\"", false);
  TSNode paragraph = ts_node_descendant_for_byte_range(ts_tree_root_node(document->tree), 36, 44);
  while (!is(paragraph, document->ids.paragraph)) paragraph = ts_node_parent(paragraph);
  leaf_build(document, paragraph, PARAGRAPH);
  assert(document->leaf.n == 7);
  assert(!memcmp(document->leaf.text, "  code\n", 7));
  assert(document->leaf.starts.v[0] == 17 && document->leaf.ends.v[0] == 18);
  assert(document->leaf.starts.v[1] == 17 && document->leaf.ends.v[1] == 18);
  assert(document->leaf.starts.v[2] == 18 && document->leaf.ends.v[2] == 19);
  assert(document->source[17] == '\t');
  tsmd_free(document);
}
static void check_spread(uint32_t flags) {
  Document *document = test_document(flags);
  set_ascii(document, "- > [x]: /target\n\n    code\n\n[x]");
  check_modes(document, "\"value\":\"code\"", true);
  set_ascii(document, "> - > [x]: /target\n>\n>     code\n>\n[x]");
  check_modes(document, "\"value\":\"code\"", true);
  set_ascii(document, "- > [x]: /target\n  >\n    code\n\n[x]");
  check_modes(document, "\"value\":\"code\"", false);
  tsmd_free(document);
}
static void check_authored_prefix(uint32_t flags, const char *opening, const char *indent,
                                  const char *expected, uint32_t padding, const char *ending) {
  char source[256];
  snprintf(source, sizeof(source), "%s[x]: /target%s%s[y]: /second%s%s[x] [y]",
           opening, ending, indent, ending, ending);
  Document *document = test_document(flags);
  set_ascii(document, source);
  uint32_t label = (uint32_t)(strstr(source, "[y]") - source);
  TSNode paragraph = ts_node_descendant_for_byte_range(ts_tree_root_node(document->tree),
                                                      label * 2, (label + 1) * 2);
  while (!ts_node_is_null(paragraph) && !is(paragraph, document->ids.paragraph))
    paragraph = ts_node_parent(paragraph);
  assert(!ts_node_is_null(paragraph));
  leaf_build(document, paragraph, PARAGRAPH);
  uint32_t prefix = (uint32_t)strlen(expected), line = (uint32_t)(strstr(source, ending) - source) + strlen(ending);
  assert(document->leaf.n > prefix);
  assert(!memcmp(document->leaf.text, expected, prefix));
  assert(document->leaf.text[prefix] == '[');
  for (uint32_t i = 0; i < padding; i++) {
    assert(document->leaf.starts.v[i] == line);
    assert(document->leaf.ends.v[i] == line + 1);
    assert(document->source[line] == '\t');
  }
  uint32_t authored = label - (prefix - padding);
  for (uint32_t i = padding; i <= prefix; i++) {
    assert(document->leaf.starts.v[i] == authored + i - padding);
    assert(document->leaf.ends.v[i] == authored + i - padding + 1);
  }
  tsmd_free(document);
}
static void check_authored_prefixes(uint32_t flags, const char *ending) {
  check_authored_prefix(flags, "- > ", "\t ", "   ", 2, ending);
  check_authored_prefix(flags, "- > ", "\t\t", "  \t", 2, ending);
  check_authored_prefix(flags, "- - > ", "\t ", " ", 0, ending);
  check_authored_prefix(flags, "- - > ", "\t\t", "\t", 0, ending);
  check_authored_prefix(flags, "> - > ", "\t", "\t", 0, ending);
}
int main(void) {
  const uint32_t flags[] = {0, 1, 8, 9};
  for (uint32_t i = 0; i < sizeof(flags) / sizeof(*flags); i++) {
    check_padding(flags[i]);
    check_spread(flags[i]);
    check_authored_prefixes(flags[i], "\n");
    check_authored_prefixes(flags[i], "\r\n");
  }
  puts("Nested definition lists: virtual tab mapping, separator ownership and exact/open/ended modes passed");
  return 0;
}
