#include "resolver.h"
#include "native-language.h"
#include <assert.h>
#include <stdio.h>

Document *tsmd_new(uint32_t, const TSLanguage *);
const TSLanguage *tree_sitter_markdown(void);
void tsmd_free(Document *);
uint16_t *tsmd_input(Document *, uint32_t);
void tsmd_set_text(Document *);
void tsmd_edit(Document *, uint32_t, uint32_t);
uint32_t tsmd_semantics(Document *);
uint32_t tsmd_presentation(Document *, uint32_t);
char *tsmd_semantic_out(Document *);
void tsmd_semantic_release(Document *);

static void set(Document *document, const uint16_t *source, uint32_t length) {
  memcpy(tsmd_input(document, length), source, length * sizeof(uint16_t));
  tsmd_set_text(document);
}

static void expect_json(Document *document, uint32_t length, const char *expected) {
  const char *actual = tsmd_semantic_out(document);
  if (length != strlen(expected) || strcmp(actual, expected)) {
    fprintf(stderr, "Native presentation mismatch\nexpected %s\nactual   %s\n", expected, actual);
    abort();
  }
  tsmd_semantic_release(document);
}

static void expect_modes(Document *document, const char *root, const char *open_root,
                         const char *metadata) {
  char expected[4096];
  expect_json(document, tsmd_semantics(document), root);
  int length = snprintf(expected, sizeof(expected),
      "{\"input\":\"open\",\"root\":%s,\"provisional\":%s,\"suppressed\":[],\"references\":[]}",
      open_root, metadata);
  assert(length > 0 && (size_t)length < sizeof(expected));
  expect_json(document, tsmd_presentation(document, 0), expected);
  expect_json(document, tsmd_semantics(document), root);
  length = snprintf(expected, sizeof(expected),
      "{\"input\":\"ended\",\"root\":%s,\"provisional\":[],\"suppressed\":[],\"references\":[]}", root);
  assert(length > 0 && (size_t)length < sizeof(expected));
  expect_json(document, tsmd_presentation(document, 1), expected);
}

static void nested_source_mapping(Document *document) {
  const uint16_t source[] = {'>', ' ', '-', ' ', '*', '*', 0xd83d, 0xde00, ' ', '*', 'x'};
  const char *root =
      "{\"type\":\"root\",\"range\":{\"start\":0,\"end\":11},\"children\":["
      "{\"type\":\"quote\",\"range\":{\"start\":0,\"end\":11},\"children\":["
      "{\"type\":\"list\",\"range\":{\"start\":2,\"end\":11},\"ordered\":false,\"start\":null,\"spread\":false,\"items\":["
      "{\"type\":\"listItem\",\"range\":{\"start\":2,\"end\":11},\"spread\":false,\"checked\":null,\"children\":["
      "{\"type\":\"paragraph\",\"range\":{\"start\":4,\"end\":11},\"children\":["
      "{\"type\":\"text\",\"range\":{\"start\":4,\"end\":11},\"value\":\"**😀 *x\"}]}]}]}]}]}";
  const char *open_root =
      "{\"type\":\"root\",\"range\":{\"start\":0,\"end\":11},\"children\":["
      "{\"type\":\"quote\",\"range\":{\"start\":0,\"end\":11},\"children\":["
      "{\"type\":\"list\",\"range\":{\"start\":2,\"end\":11},\"ordered\":false,\"start\":null,\"spread\":false,\"items\":["
      "{\"type\":\"listItem\",\"range\":{\"start\":2,\"end\":11},\"spread\":false,\"checked\":null,\"children\":["
      "{\"type\":\"paragraph\",\"range\":{\"start\":4,\"end\":11},\"children\":["
      "{\"type\":\"strong\",\"range\":{\"start\":4,\"end\":11},\"children\":["
      "{\"type\":\"text\",\"range\":{\"start\":6,\"end\":9},\"value\":\"😀 \"},"
      "{\"type\":\"emphasis\",\"range\":{\"start\":9,\"end\":11},\"children\":["
      "{\"type\":\"text\",\"range\":{\"start\":10,\"end\":11},\"value\":\"x\"}]}]}]}]}]}]}]}";
  const char *metadata =
      "[{\"path\":[\"children\",0,\"children\",0,\"items\",0,\"children\",0,\"children\",0],\"reason\":\"unclosed-delimiter\"},"
      "{\"path\":[\"children\",0,\"children\",0,\"items\",0,\"children\",0,\"children\",0,\"children\",1],\"reason\":\"unclosed-delimiter\"}]";
  set(document, source, sizeof(source) / sizeof(*source));
  expect_modes(document, root, open_root, metadata);
  assert(!memcmp(document->source, source, sizeof(source)));
}

static void pending_destination(Document *document) {
  const uint16_t source[] = {'[', 'a', ']', '(', '/', 'd', 'e', 's', 't'};
  const char *root =
      "{\"type\":\"root\",\"range\":{\"start\":0,\"end\":9},\"children\":["
      "{\"type\":\"paragraph\",\"range\":{\"start\":0,\"end\":9},\"children\":["
      "{\"type\":\"text\",\"range\":{\"start\":0,\"end\":9},\"value\":\"[a](/dest\"}]}]}";
  const char *open_root =
      "{\"type\":\"root\",\"range\":{\"start\":0,\"end\":9},\"children\":["
      "{\"type\":\"paragraph\",\"range\":{\"start\":0,\"end\":9},\"children\":["
      "{\"type\":\"pendingLink\",\"range\":{\"start\":0,\"end\":9},\"children\":["
      "{\"type\":\"text\",\"range\":{\"start\":1,\"end\":2},\"value\":\"a\"}]}]}]}";
  const char *metadata = "[{\"path\":[\"children\",0,\"children\",0],\"reason\":\"unclosed-link\"}]";
  set(document, source, sizeof(source) / sizeof(*source));
  expect_modes(document, root, open_root, metadata);
}

static void trailing_quote_owner(void) {
  Document *document = test_document(5);
  const uint16_t source[] = {'-', ' ', '>', ' ', '\t', '$', '$', 'm', 'e', 't', 'a', '\r', '\n', ' ', ' ', '>'};
  const char *root =
      "{\"type\":\"root\",\"range\":{\"start\":0,\"end\":16},\"children\":["
      "{\"type\":\"list\",\"range\":{\"start\":0,\"end\":16},\"ordered\":false,\"start\":null,\"spread\":false,\"items\":["
      "{\"type\":\"listItem\",\"range\":{\"start\":0,\"end\":16},\"spread\":false,\"checked\":null,\"children\":["
      "{\"type\":\"quote\",\"range\":{\"start\":2,\"end\":16},\"children\":["
      "{\"type\":\"code\",\"range\":{\"start\":4,\"end\":11},\"value\":\"$$meta\",\"language\":null,\"meta\":null,\"fence\":\"indented\"}]}]}]}]}";
  set(document, source, 16);
  expect_modes(document, root, root, "[]");
  set(document, source, 0);
  for (uint32_t i = 0; i < 16; i++) {
    tsmd_input(document, 1)[0] = source[i];
    tsmd_edit(document, i, i);
  }
  expect_modes(document, root, root, "[]");
  tsmd_free(document);
}

static void continuation_leaf(uint32_t flags, const char *opening, const char *prefix,
                              uint32_t padding, const char *ending) {
  char source[64], expected[64];
  snprintf(source, sizeof(source), "%s`a%s%sb`", opening, ending, prefix);
  uint32_t length = strlen(source), tab = (uint32_t)(strchr(source, '\t') - source);
  uint16_t input[64];
  for (uint32_t i = 0; i < length; i++) input[i] = (unsigned char)source[i];
  Document *document = test_document(flags);
  set(document, input, length);
  uint32_t content = (uint32_t)(strchr(source, '`') - source);
  TSNode paragraph = ts_node_descendant_for_byte_range(ts_tree_root_node(document->tree),
                                                      content * 2, (content + 1) * 2);
  while (!ts_node_is_null(paragraph) && !is(paragraph, document->ids.paragraph))
    paragraph = ts_node_parent(paragraph);
  assert(!ts_node_is_null(paragraph));
  leaf_build(document, paragraph, PARAGRAPH);
  snprintf(expected, sizeof(expected), "`a%s%*sb`", ending, (int)padding, "");
  assert(document->leaf.n == strlen(expected));
  assert(!strcmp(document->leaf.text, expected));
  uint32_t offset = 2 + strlen(ending);
  for (uint32_t i = 0; i < padding; i++) {
    assert(document->leaf.starts.v[offset + i] == tab);
    assert(document->leaf.ends.v[offset + i] == tab + 1);
    assert(document->source[tab] == '\t');
  }
  assert(!memcmp(document->source, input, length * sizeof(*input)));
  tsmd_free(document);
}

static void continuation_leaves(uint32_t flags, const char *ending) {
  continuation_leaf(flags, "- ", "\t", 2, ending);
  continuation_leaf(flags, "> ", ">\t", 2, ending);
  continuation_leaf(flags, "  > ", "  >\t", 0, ending);
  continuation_leaf(flags, "   > ", "   >\t", 3, ending);
}

static void compacted_leaf(uint32_t flags, const char *source, const char *expected,
                            uint32_t retained_tab) {
  uint32_t length = strlen(source);
  uint16_t input[128];
  for (uint32_t i = 0; i < length; i++) input[i] = (unsigned char)source[i];
  Document *document = test_document(flags);
  set(document, input, length);
  TSNode paragraph = ts_node_descendant_for_byte_range(ts_tree_root_node(document->tree), 4, 6);
  while (!ts_node_is_null(paragraph) && !is(paragraph, document->ids.paragraph))
    paragraph = ts_node_parent(paragraph);
  assert(!ts_node_is_null(paragraph));
  leaf_build(document, paragraph, PARAGRAPH);
  assert(document->leaf.n == strlen(expected));
  assert(!strcmp(document->leaf.text, expected));
  uint32_t at = 2;
  for (uint32_t i = 0; i < document->leaf.n; i++) {
    if (source[at] == '\t' && at != retained_tab) at++;
    uint32_t origin = document->leaf.starts.v[i];
    assert(origin == at);
    assert(document->leaf.ends.v[i] == at + 1);
    if (at != retained_tab || document->leaf.text[i + 1] != ' ') at++;
  }
  assert(at == length);
  assert(!memcmp(document->source, input, length * sizeof(*input)));
  tsmd_free(document);
}

static void compacted_leaves(uint32_t flags) {
  compacted_leaf(flags, "- a\n\tb", "a\nb", 0);
  compacted_leaf(flags, "- `a\n\tb", "`a\nb", 0);
  compacted_leaf(flags, "- \\`a\n\tb`", "\\`a\nb`", 0);
  compacted_leaf(flags, "- <x title=\"`a\n\tb`\">", "<x title=\"`a\nb`\">", 0);
  compacted_leaf(flags, "- a\n\tb and `c\n\td`\n\te", "a\nb and `c\n  d`\ne", 14);
}

int main(void) {
  const uint32_t flags[] = {1, 9};
  const char *endings[] = {"\n", "\r\n", "\r"};
  for (uint32_t i = 0; i < 2; i++) {
    for (uint32_t j = 0; j < 3; j++) continuation_leaves(flags[i], endings[j]);
    compacted_leaves(flags[i]);
  }
  trailing_quote_owner();
  Document *nested = test_document(13);
  Document *link = test_document(13);
  nested_source_mapping(nested);
  pending_destination(link);
  nested_source_mapping(nested);
  tsmd_free(link);
  nested_source_mapping(nested);
  tsmd_free(nested);
  puts("Native provisional nesting, UTF-16 container mapping, pending destination and exact-mode independence passed");
  return 0;
}
