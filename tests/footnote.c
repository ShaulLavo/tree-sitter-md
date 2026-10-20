#include "footnote.h"

#include <assert.h>

Document *tsmd_new(uint32_t, const TSLanguage *);
void tsmd_free(Document *);
uint16_t *tsmd_input(Document *, uint32_t);
void tsmd_set_text(Document *);
const TSLanguage *tree_sitter_markdown(void);

static void set_text(Document *document, const char *source) {
  uint32_t length = strlen(source);
  uint16_t *input = tsmd_input(document, length);
  for (uint32_t i = 0; i < length; i++) input[i] = (unsigned char)source[i];
  tsmd_set_text(document);
}

static const char *lookup(void *context, const unsigned char *label, uint32_t length) {
  const Footnote *note = footnotes_lookup(context, label, length);
  return note ? note->identifier : NULL;
}

static void check_reference(Document *document, Footnotes *notes, const char *source, const char *url) {
  set_text(document, source); footnotes_scan(notes);
  cmark_reference_map *map = footnotes_definitions(notes);
  cmark_chunk label = {(unsigned char *)"x", 1};
  cmark_reference *reference = cmark_reference_lookup(map, &label);
  assert(reference && !strcmp((char *)reference->url, url));
  cmark_reference_map_free(map);
}

static void inline_references(Document *document, Footnotes *notes) {
  char source[] = "known [^A], unknown [^missing], escaped \\[^a], code `[^a]`.";
  cmark_node *root = cmark_node_new(CMARK_NODE_PARAGRAPH);
  root->data = (unsigned char *)source; root->len = strlen(source);
  document->defs->lookup_footnote = lookup;
  document->defs->footnote_context = notes;
  cmark_parse_inlines(cmark_get_default_mem_allocator(), root, document->defs,
                      CMARK_OPT_GFM | CMARK_OPT_FOOTNOTES, NULL);
  uint32_t found = 0;
  for (cmark_node *node = root->first_child; node; node = node->next) {
    if (node->type != CMARK_NODE_FOOTNOTE_REFERENCE) continue;
    assert(node->source_start == 6 && node->source_end == 10);
    assert(node->len == 1 && node->data[0] == 'a');
    found++;
  }
  assert(found == 1);
  document->defs->lookup_footnote = NULL;
  document->defs->footnote_context = NULL;
  root->data = NULL; root->len = 0; cmark_node_free(root);
}

static void physical_table_body(Document *document, Footnotes *notes, const char *source,
                                const char *body, uint32_t header, uint32_t row) {
  set_text(document, source); footnotes_scan(notes);
  assert(notes->count == 1);
  const Footnote *note = footnotes_at(notes, 0);
  assert(note && note->body->len == strlen(body));
  for (uint32_t i = 0; i < document->len; i++)
    assert(document->source[i] == (unsigned char)source[i]);
  for (uint32_t i = 0; i < note->body->len; i++) {
    assert(note->body->text[i] == (unsigned char)body[i]);
    assert(note->ends.v[i] == note->starts.v[i] + 1);
    assert(document->source[note->starts.v[i]] == note->body->text[i]);
  }
  uint32_t first = body[0] == '\r' && body[1] == '\n' ? 2 : 1;
  assert(note->starts.v[first] == header);
  assert(note->starts.v[note->body->len - 5] == row);
  TSNode section = ts_node_named_child(ts_tree_root_node(note->body->tree), 0);
  assert(is(ts_node_named_child(section, 0), note->body->ids.pipe_table));
}

int main(void) {
  Document *document = tsmd_new(1, tree_sitter_markdown());
  set_text(document, "[^A]: first\n\n[^b]: second\n[^a]: ignored\n");
  Footnotes *footnotes = footnotes_new(document);
  footnotes_scan(footnotes);
  assert(footnotes->count == 3);
  const Footnote *first = footnotes_lookup(footnotes, (const unsigned char *)"a", 1);
  assert(first && first->start == 0 && first->body_start > first->start);
  assert(footnotes_lookup(footnotes, (const unsigned char *)"A", 1) == first);
  assert(footnotes_lookup(footnotes, (const unsigned char *)"missing", 7) == NULL);
  assert(footnotes_contains(footnotes, first->start, first->end));
  inline_references(document, footnotes);
  set_text(document, "[^a]: first\nmore\n\nend\n");
  footnotes_scan(footnotes);
  assert(footnotes->count == 1);
  first = footnotes_at(footnotes, 0);
  assert(first && first->body_end > first->body_start + 5);
  assert(first->body->len == strlen("first\nmore\n\n"));
  for (uint32_t i = 0; i < first->body->len; i++)
    assert(first->body->text[i] == document->text[first->starts.v[i]]);
  set_text(document, "[^a]: first\n\n    - one\n    - two\n\n    last\n\nend");
  footnotes_scan(footnotes);
  first = footnotes_at(footnotes, 0);
  assert(first && first->body && first->body->len == strlen("first\n\n- one\n- two\n\nlast\n\n"));
  TSNode root = ts_tree_root_node(first->body->tree);
  TSNode section = ts_node_named_child(root, 0);
  assert(ts_node_named_child_count(section) == 3);
  assert(is(ts_node_named_child(section, 1), first->body->ids.list));
  set_text(document, "[^a]:\n\n    first\n");
  footnotes_scan(footnotes);
  assert(footnotes->count == 1);
  assert(footnotes_at(footnotes, 0)->body->len == strlen("\n\nfirst\n"));
  set_text(document, "> [^a]: first\n>     more\n\n[^a]");
  footnotes_scan(footnotes);
  assert(footnotes->count == 1);
  assert(footnotes_at(footnotes, 0)->body->len == strlen("first\nmore\n"));
  set_text(document, "- [^a]: first\n      more\n\n[^a]");
  footnotes_scan(footnotes);
  assert(footnotes->count == 1);
  assert(footnotes_at(footnotes, 0)->body->len >= strlen("first\nmore\n"));
  set_text(document, "- > [^a]: first\n  >     more\n  >\n  >     last\n");
  footnotes_scan(footnotes);
  assert(footnotes->count == 1);
  assert(footnotes_at(footnotes, 0)->body->len == strlen("first\nmore\n\nlast\n"));
  set_text(document, "[^a b]: url\n\n```\n[^a]: code\n```\n\n    [^b]: code");
  footnotes_scan(footnotes);
  assert(footnotes->count == 0);
  set_text(document, "[^a]: # head\nmore");
  footnotes_scan(footnotes);
  assert(footnotes->count == 1);
  assert(footnotes_at(footnotes, 0)->body->len == strlen("# head\n"));
  set_text(document, "[^a]: first\n    ---\nmore");
  footnotes_scan(footnotes);
  assert(footnotes_at(footnotes, 0)->body->len == strlen("first\n---\n"));
  set_text(document, "[^a]: first\n\n    [^b]: nested\n\n[^b]");
  footnotes_scan(footnotes);
  first = footnotes_at(footnotes, 0);
  assert(first && first->nested && first->nested->count == 1);
  const Footnote *nested = footnotes_lookup(footnotes, (const unsigned char *)"b", 1);
  assert(nested && nested == footnotes_at(first->nested, 0));
  assert(first->starts.v[nested->start] == 17);
  set_text(document, "[^a]: note\n\n[ordinary]: /url\n\n[ordinary]");
  footnotes_scan(footnotes);
  cmark_reference_map *filtered = footnotes_definitions(footnotes);
  cmark_chunk ordinary = {(unsigned char *)"ordinary", 8};
  cmark_chunk caret = {(unsigned char *)"^a", 2};
  assert(cmark_reference_lookup(filtered, &ordinary));
  assert(!cmark_reference_lookup(filtered, &caret));
  cmark_reference_map_free(filtered);
  set_text(document, "[a] [^a]\n\n[a]: /ordinary\n[^a]: note");
  footnotes_scan(footnotes);
  filtered = footnotes_definitions(footnotes);
  cmark_chunk ordinary_again = {(unsigned char *)"a", 1};
  assert(cmark_reference_lookup(filtered, &ordinary_again));
  cmark_reference_map_free(filtered);
  check_reference(document, footnotes, "[x]\n\n[^a]: note\n\n    [x]: /inside", "/inside");
  check_reference(document, footnotes, "[x]\n\n[^a]: note\n\n    [x]: /inside\n\n[x]: /later", "/inside");
  check_reference(document, footnotes, "[x]\n\n[x]: /earlier\n\n[^a]: note\n\n    [x]: /inside", "/earlier");
  check_reference(document, footnotes, "[x]\n\n[^a]: note\n\n    [^b]: nested\n\n        [x]: /deep\n\n[x]: /later", "/deep");
  check_reference(document, footnotes, "[x]: /?a=&amp;amp;\n\n[^a]: note", "/?a=&amp;");
  first = footnotes_at(footnotes, 0);
  uint32_t mapped_start, mapped_end;
  assert(footnotes_map_range(first->nested, first->body->len, first->body->len, &mapped_start, &mapped_end));
  assert(mapped_start == mapped_end);
  set_text(document, "[^a]:"); footnotes_scan(footnotes);
  first = footnotes_at(footnotes, 0);
  assert(first && first->body->len == 0);
  assert(footnotes_map_range(first->nested, 0, 0, &mapped_start, &mapped_end));
  assert(mapped_start == mapped_end);
  const uint16_t wide[] = {'[', '^', 0xc4, ']', ':', ' ', 0xd83d, 0xde00, '\n'};
  memcpy(tsmd_input(document, 9), wide, sizeof(wide)); tsmd_set_text(document);
  footnotes_scan(footnotes);
  assert(footnotes->count == 1);
  first = footnotes_lookup(footnotes, (const unsigned char *)"\xc3\xa4", 2);
  assert(first && first->identifier_len == 2);
  assert(first->body->text[0] == 0xd83d && first->body->text[1] == 0xde00);
  assert(first->starts.v[0] == 6 && first->ends.v[1] == 8);
  physical_table_body(document, footnotes,
    "x[^a]\n\n[^a]:\n    | a | b |\n    |---|---|\n      | c |",
    "\n| a | b |\n|---|---|\n  | c |", 17, 47);
  physical_table_body(document, footnotes,
    "x[^a]\r\r[^a]:\r    | a | b |\r    |---|---|\r      | c |",
    "\r| a | b |\r|---|---|\r  | c |", 17, 47);
  physical_table_body(document, footnotes,
    "x[^a]\r\n\r\n[^a]:\r\n    | a | b |\r\n    |---|---|\r\n      | c |",
    "\r\n| a | b |\r\n|---|---|\r\n  | c |", 20, 52);
  physical_table_body(document, footnotes,
    "x[^a]\r\n\r[^a]:\n    | a | b |\r\n    |---|---|\r      | c |",
    "\n| a | b |\r\n|---|---|\r  | c |", 18, 49);
  document->gfm = false;
  footnotes_scan(footnotes);
  assert(footnotes->count == 0);
  footnotes_free(footnotes);
  tsmd_free(document);
  return 0;
}
