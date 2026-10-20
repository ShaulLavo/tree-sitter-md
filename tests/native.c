#include "resolver.h"
#include "autolink.h"
#include "native-language.h"
#include <assert.h>
Document *tsmd_new(uint32_t, const TSLanguage *);
const TSLanguage *tree_sitter_markdown(void);
void tsmd_free(Document *);
uint16_t *tsmd_input(Document *, uint32_t);
void tsmd_set_text(Document *);
void tsmd_edit(Document *, uint32_t, uint32_t);
uint32_t tsmd_decorations(Document *, uint32_t, uint32_t);
uint32_t tsmd_semantics(Document *);
uint32_t tsmd_presentation(Document *, uint32_t);
void tsmd_semantic_release(Document *);

static void set(Document *d, const uint16_t *text, uint32_t length) {
  memcpy(tsmd_input(d, length), text, length * sizeof(uint16_t));
  tsmd_set_text(d);
}
static void semantic_equal(Document *incremental, Document *fresh) {
  uint32_t a = tsmd_semantics(incremental), b = tsmd_semantics(fresh);
  assert(a == b && a > 0);
  assert(incremental->semantic[a] == 0 && fresh->semantic[b] == 0);
  assert(!memcmp(incremental->semantic, fresh->semantic, a));
  tsmd_semantic_release(incremental);
  tsmd_semantic_release(incremental);
  assert(incremental->semantic == NULL && incremental->semantic_len == 0);
}
static void presentation_equal(Document *incremental, Document *fresh) {
  for (uint32_t ended = 0; ended < 2; ended++) {
    uint32_t a = tsmd_presentation(incremental, ended), b = tsmd_presentation(fresh, ended);
    assert(a == b && a > 0);
    assert(!memcmp(incremental->semantic, fresh->semantic, a));
    tsmd_semantic_release(incremental);
  }
}
static void source_equal(Document *d, const uint16_t *source, uint32_t length) {
  assert(d->len == length);
  assert(d->source != d->text);
  assert(!memcmp(d->source, source, length * sizeof(uint16_t)));
  for (uint32_t i = 0; i < length; i++)
    assert(d->text[i] == (source[i] ? source[i] : 0xfffd));
}
static void source_ownership(void) {
  Document *d = test_document(13);
  Document *sibling = test_document(13);
  const uint16_t original[] = {0xfeff, 'a', 0, 0xfffd, '\r', '\n', 0xd83d};
  set(d, original, 7);
  source_equal(d, original, 7);
  tsmd_input(d, 1)[0] = 0xde00;
  tsmd_edit(d, 7, 7);
  const uint16_t paired[] = {0xfeff, 'a', 0, 0xfffd, '\r', '\n', 0xd83d, 0xde00};
  source_equal(d, paired, 8);
  tsmd_input(d, 1)[0] = 0;
  tsmd_edit(d, 3, 7);
  const uint16_t replaced[] = {0xfeff, 'a', 0, 0, 0xde00};
  source_equal(d, replaced, 5);
  set(sibling, original, 7);
  set(d, original, 0);
  source_equal(d, original, 0);
  tsmd_free(d);
  source_equal(sibling, original, 7);
  tsmd_input(sibling, 1)[0] = 'z';
  tsmd_edit(sibling, 0, 7);
  const uint16_t final[] = {'z'};
  source_equal(sibling, final, 1);
  tsmd_free(sibling);
}
static void deep_case(Document *document, uint32_t depth, const char *prefix) {
  uint16_t text[2048];
  uint32_t length = 0, width = strlen(prefix);
  for (uint32_t at = 0; at < depth * width; at++) text[length++] = prefix[at % width];
  text[length++] = 'x';
  set(document, text, length);
  assert(tsmd_semantics(document) > 0);
  tsmd_semantic_release(document);
  assert(tsmd_presentation(document, 0) > 0);
  tsmd_semantic_release(document);
  assert(tsmd_presentation(document, 1) > 0);
  tsmd_semantic_release(document);
}
static void deep_nesting(void) {
  Document *document = test_document(13);
  const uint32_t depths[] = {180, 199, 200, 201, 256};
  const char *prefixes[] = {"> ", "- ", "> - "};
  for (uint32_t i = 0; i < sizeof(depths) / sizeof(depths[0]); i++) {
    for (uint32_t prefix = 0; prefix < sizeof(prefixes) / sizeof(prefixes[0]); prefix++)
      deep_case(document, depths[i], prefixes[prefix]);
  }
  tsmd_free(document);
}

static void many_documents(void) {
  Document *documents[64];
  char *snapshots[64];
  const uint16_t source[] = {'[', 'x', ']', '[', 'i', 'd', ']', '\n', '\n', '*', '*', 'x', 0, 0xd83d};
  for (uint32_t i = 0; i < 64; i++) {
    documents[i] = test_document(13);
    set(documents[i], source, sizeof(source) / sizeof(source[0]));
    assert(tsmd_presentation(documents[i], 0) > 0);
    snapshots[i] = strdup(documents[i]->semantic);
    assert(snapshots[i]);
  }
  for (uint32_t i = 0; i < 63; i++) {
    uint32_t length = documents[i]->len;
    tsmd_input(documents[i], 1)[0] = 0xde00;
    tsmd_edit(documents[i], length, length);
    assert(tsmd_presentation(documents[i], 0) > 0);
    assert(strcmp(documents[i]->semantic, snapshots[i]));
    tsmd_free(documents[i]);
    assert(tsmd_presentation(documents[i + 1], 0) > 0);
    assert(!strcmp(documents[i + 1]->semantic, snapshots[i + 1]));
  }
  tsmd_free(documents[63]);
  for (uint32_t i = 0; i < 64; i++) free(snapshots[i]);
}
static uint16_t source_unit(unsigned char c) {
  if (c == '?') return 0xd83d;
  if (c == '\x01') return 0xde00;
  if (c == '\x7f') return 0xfffd;
  return c;
}
static void semantic_prefixes(Document *incremental, Document *fresh, const char *source) {
  uint16_t text[1024];
  uint32_t length = strlen(source);
  assert(length < 1024);
  for (uint32_t i = 0; i < length; i++) text[i] = source_unit(source[i]);
  set(incremental, text, 0);
  for (uint32_t i = 0; i < length; i++) {
    tsmd_input(incremental, 1)[0] = text[i];
    tsmd_edit(incremental, i, i);
    set(fresh, text, i + 1);
    semantic_equal(incremental, fresh);
    presentation_equal(incremental, fresh);
  }
}
static void ordinary_text_runs(void) {
  const char *fixtures[] = {"wwwwwwwwwwww", "WWW.invalid", "::::::::::::",
    "https://example.test/a", "x www.example.test/a"};
  for (uint32_t i = 0; i < sizeof(fixtures) / sizeof(fixtures[0]); i++) {
    cmark_node *root = cmark_node_new(CMARK_NODE_PARAGRAPH);
    cmark_reference_map *refs = cmark_reference_map_new(cmark_get_default_mem_allocator());
    root->data = (unsigned char *)fixtures[i]; root->len = strlen(fixtures[i]);
    root->start_line = 1; root->start_column = 1;
    cmark_parse_inlines(cmark_get_default_mem_allocator(), root, refs, CMARK_OPT_GFM, NULL);
    assert(root->first_child && root->first_child->type == CMARK_NODE_TEXT);
    assert(!root->first_child->next && root->first_child->len == root->len);
    root->data = NULL; root->len = 0;
    cmark_node_free(root); cmark_reference_map_free(refs);
  }
}
static void table_block_case(Document *d, const char *source, uint32_t rows) {
  uint16_t text[256];
  uint32_t length = strlen(source);
  assert(length < 256);
  for (uint32_t i = 0; i < length; i++) text[i] = (unsigned char)source[i];
  if (text[length - 1] == '?') text[length - 1] = 0xd83e;
  set(d, text, length);
  TSNode section = ts_node_named_child(ts_tree_root_node(d->tree), 0);
  assert(ts_node_named_child_count(section) == 1);
  TSNode table = ts_node_named_child(section, 0);
  assert(!strcmp(ts_node_type(table), "pipe_table"));
  assert(ts_node_named_child_count(table) == rows + 1);
  source_equal(d, text, length);
}
static void table_blocks(void) {
  Document *d = test_document(13);
  table_block_case(d, "`>a | b |\n|---|---|\n **see\r\n_ded", 3);
  table_block_case(d, "`>a | b |\r\n|---|---|\r\n **see\r\n_ded", 3);
  table_block_case(d, "``a|b\n-|-", 1);
  table_block_case(d, "a|b\n-|-\n[x]: /url\nc|d\n-|-", 4);
  table_block_case(d, "| a | b |\n|---|---|\n[x]:* [x]: /target\n| a | *b |\n|---|---|\n*/```\n&?", 6);
  tsmd_free(d);
}
static void append_fence(uint16_t *text, uint32_t *length, char marker, uint32_t count) {
  for (uint32_t i = 0; i < count; i++) text[(*length)++] = marker;
}
static void append_ascii(uint16_t *text, uint32_t *length, const char *source) {
  while (*source) text[(*length)++] = (unsigned char)*source++;
}
static void long_fence_case(Document *d, char marker, uint32_t count) {
  uint16_t *text = malloc((count * 3 + 32) * sizeof(uint16_t));
  assert(text);
  uint32_t length = 0;
  append_fence(text, &length, marker, count);
  append_ascii(text, &length, "a|b\n-|-\n");
  append_fence(text, &length, marker, count - 1);
  append_ascii(text, &length, "\nbody\n");
  append_fence(text, &length, marker, count);
  append_ascii(text, &length, "\ntail");
  set(d, text, length);
  TSNode section = ts_node_named_child(ts_tree_root_node(d->tree), 0);
  assert(ts_node_named_child_count(section) == 2);
  assert(!strcmp(ts_node_type(ts_node_named_child(section, 0)), "fenced_code_block"));
  assert(!strcmp(ts_node_type(ts_node_named_child(section, 1)), "paragraph"));
  source_equal(d, text, length);
  free(text);
}
static void long_fences(void) {
  Document *d = test_document(13);
  const uint32_t lengths[] = {3, 255, 256, 257, 258, 259, 512, 65536};
  for (unsigned i = 0; i < sizeof(lengths) / sizeof(lengths[0]); i++) {
    long_fence_case(d, '`', lengths[i]);
    long_fence_case(d, '~', lengths[i]);
  }
  tsmd_free(d);
}
static void gfm_domains(void) {
  const struct { const char *source; bool valid; } cases[] = {
    {"https://examarget", false},
    {"https://examarget/a.b", false},
    {"https://examarget:8080/a.b", false},
    {"https://foo_bar.test/a", false},
    {"https://éxam_ple.test/a", false},
    {"https://ex🧑‍💻am_ple.test/a", false},
    {"https://foo.test_/", false},
    {"https://a.b", true},
    {"https://foo_bar.example.test/a", true},
    {"https://éxam_ple.example.test/a", true},
  };
  for (size_t i = 0; i < sizeof(cases) / sizeof(*cases); i++) {
    size_t begin = 0, end = 0;
    const char *source = cases[i].source;
    bool matched = tsmd_gfm_autolink_match((const uint8_t *)source, strlen(source),
                                          5, &begin, &end, false);
    assert(matched == cases[i].valid);
  }
}

int main(void) {
  gfm_domains();
  long_fences();
  table_blocks();
  ordinary_text_runs();
  source_ownership();
  deep_nesting();
  many_documents();
  Document *incremental = test_document(13), *fresh = test_document(13);
  const char *fixtures[] = {
    "- [ ] pending\n- [x](streamdown:incomplete-link)\n- [x] done",
    "> - first\n>\n> ```js\n> ?\n> ```",
    "a|b|c\n:-|--:|-\nx|![?](image)\n",
    "`>a | b |\n|---|---|\n **see\r\n_ded",
    "a|b\r\n-|-\r\n[x]: /url\r\nc|d\r\n-|-",
    "[^a]: **?**\n\n    - nested\n\n    [^b]: `?`\n\n[^a] [^b]\n",
    "&#xD83D; ? \x7f `?` ![?](x) ?\x01 \x01\n\n```\n?\n```\n\n<div>?</div>\n\n$$\n?\n$$",
    "    first\n    ",
    "[late][id] ![alt][id] [^n]\n\n[id]: /first\n[id]: /second\n\n[^n]: note",
    "> - [ ]\n> - x\n> -",
    "Title\n---\n\n| a | b |\n| --- | --- |\n| c | d |",
    "$$same *line*\nnext\n$$",
    "A **see(https://exa.test**mple.test/a)ded** message.\n\n",
    "**www.example.test/a**b** **https://example.test/a\\*b**",
    "**www.** **www.!** **www.?**",
    "[https://example.test/a](target) **[https://example.test/a](target)**"
  };
  for (uint32_t i = 0; i < sizeof(fixtures) / sizeof(fixtures[0]); i++)
    semantic_prefixes(incremental, fresh, fixtures[i]);
  uint16_t text[8192];
  uint32_t length = 0, seed = 7;
  const char *source =
      "[x] **bold** ~~strike~~ `code` www.example.org\n\n[x]: /first\n[x]: /second\n";
  for (const char *p = source; *p; p++)
    text[length++] = *p;
  set(incremental, text, length);
  for (uint32_t step = 0; step < 2000; step++) {
    seed = seed * 1664525 + 1013904223;
    uint32_t at = seed % (length + 1), stop = at;
    const uint16_t alphabet[] = {'*', '[', ']', '~', '`', '\\', '>', '\n', ' ', 'a', 'b', 'c', ':', '\t', '\r', 0, 0xd83d, 0xde00, 0xfffd, 0x4e2d};
    uint16_t inserted = alphabet[seed % (sizeof(alphabet) / sizeof(alphabet[0]))];
    uint32_t n = 1;
    if (step % 3 == 0 && at < length) {
      stop++;
      n = 0;
    }
    uint16_t *input = tsmd_input(incremental, n);
    if (n)
      input[0] = inserted;
    tsmd_edit(incremental, at, stop);
    memmove(text + at + n, text + stop, (length - stop) * sizeof(uint16_t));
    if (n)
      text[at] = inserted;
    length += n - (stop - at);
    set(fresh, text, length);
    uint32_t a = tsmd_decorations(incremental, 0, length), b = tsmd_decorations(fresh, 0, length);
    assert(a == b);
    if (a)
      assert(!memcmp(incremental->out.v, fresh->out.v, a * sizeof(uint32_t)));
    semantic_equal(incremental, fresh);
    presentation_equal(incremental, fresh);
  }
  tsmd_free(incremental);
  tsmd_free(fresh);
  return 0;
}
