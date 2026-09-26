#include "resolver.h"
#include <assert.h>
#include <inttypes.h>
#include <stdio.h>

extern Document *tsmd_new(uint32_t);
extern void tsmd_free(Document *);
extern uint16_t *tsmd_input(Document *, uint32_t);
extern void tsmd_set_text(Document *);
extern void tsmd_edit(Document *, uint32_t, uint32_t);
extern void tsmd_reparse(Document *);
static uint64_t checks, failures;

static bool point_after(TSPoint a, TSPoint b) {
  return a.row > b.row || (a.row == b.row && a.column > b.column);
}
static void check_seek(TSNode parent, uint32_t byte, TSPoint point, bool by_point) {
  TSTreeCursor linear = ts_tree_cursor_new(parent);
  TSNode expected_node = parent;
  int64_t expected = -1, index = 0;
  if (ts_tree_cursor_goto_first_child(&linear)) {
    do {
      TSNode child = ts_tree_cursor_current_node(&linear);
      bool beyond = by_point ? point_after(ts_node_end_point(child), point)
                             : ts_node_end_byte(child) > byte;
      if (beyond) { expected = index; expected_node = child; break; }
      index++;
    } while (ts_tree_cursor_goto_next_sibling(&linear));
  }
  TSTreeCursor seek = ts_tree_cursor_new(parent);
  int64_t actual = by_point ? ts_tree_cursor_goto_first_child_for_point(&seek, point)
                           : ts_tree_cursor_goto_first_child_for_byte(&seek, byte);
  bool matches = actual == expected && ts_node_eq(ts_tree_cursor_current_node(&seek), expected_node);
  bool restores_parent = actual < 0 || (ts_tree_cursor_goto_parent(&seek) &&
                                      ts_node_eq(ts_tree_cursor_current_node(&seek), parent));
  checks++;
  if (!matches || !restores_parent) {
    if (failures < 8)
      fprintf(stderr, "%s seek parent=%s [%u,%u] byte=%u point=%u:%u expected=%" PRId64 " actual=%" PRId64 "\n",
              by_point ? "point" : "byte", ts_node_type(parent), ts_node_start_byte(parent),
              ts_node_end_byte(parent), byte, point.row, point.column, expected, actual);
    failures++;
  }
  ts_tree_cursor_delete(&linear);
  ts_tree_cursor_delete(&seek);
}
static void check_tree(Document *d) {
  TSTreeCursor walk = ts_tree_cursor_new(ts_tree_root_node(d->tree));
  bool done = false;
  while (!done) {
    TSNode n = ts_tree_cursor_current_node(&walk);
    TSPoint point = {0, 0};
    for (uint32_t pos = 0; pos <= d->len; pos++) {
      check_seek(n, pos * 2, point, false);
      check_seek(n, pos * 2 + 1, point, false);
      check_seek(n, 0, point, true);
      TSPoint middle = {point.row, point.column + 1};
      check_seek(n, 0, middle, true);
      if (pos < d->len) {
        if (d->text[pos] == '\n') { point.row++; point.column = 0; }
        else point.column += 2;
      }
    }
    check_seek(n, d->len * 2 + 2, (TSPoint){point.row + 1, 0}, false);
    check_seek(n, 0, (TSPoint){point.row + 1, 0}, true);
    if (ts_tree_cursor_goto_first_child(&walk)) continue;
    while (!ts_tree_cursor_goto_next_sibling(&walk)) {
      if (!ts_tree_cursor_goto_parent(&walk)) { done = true; break; }
    }
  }
  ts_tree_cursor_delete(&walk);
}
static void put_ascii(Document *d, const char *s) {
  uint16_t *input = tsmd_input(d, (uint32_t)strlen(s));
  for (uint32_t i = 0; s[i]; i++) input[i] = (unsigned char)s[i];
}
static void set_ascii(Document *d, const char *s) { put_ascii(d, s); tsmd_set_text(d); }

static void check_sample(Document *d, TSNode parent, uint32_t pos) {
  TSPoint point = {0, 0};
  for (uint32_t i = 0; i < pos; i++) {
    if (d->text[i] == '\n') { point.row++; point.column = 0; }
    else point.column += 2;
  }
  check_seek(parent, pos * 2, point, false);
  check_seek(parent, pos * 2 + 1, point, false);
  check_seek(parent, 0, point, true);
  check_seek(parent, 0, (TSPoint){point.row, point.column + 1}, true);
}

static void check_sampled_tree(Document *d) {
  TSTreeCursor walk = ts_tree_cursor_new(ts_tree_root_node(d->tree));
  uint32_t visited = 0;
  bool done = false;
  while (!done) {
    TSNode node = ts_tree_cursor_current_node(&walk);
    if (visited < 2 || visited % 257 == 0) {
      check_sample(d, node, 0);
      check_sample(d, node, ts_node_start_byte(node) / 2);
      check_sample(d, node, ts_node_end_byte(node) / 2);
      check_sample(d, node, d->len);
      check_sample(d, node, d->len / 10);
      check_sample(d, node, d->len / 2);
      check_sample(d, node, d->len * 95 / 100);
    }
    visited++;
    if (ts_tree_cursor_goto_first_child(&walk)) continue;
    while (!ts_tree_cursor_goto_next_sibling(&walk)) {
      if (!ts_tree_cursor_goto_parent(&walk)) { done = true; break; }
    }
  }
  ts_tree_cursor_delete(&walk);
}

static void check_large_document(uint32_t gfm) {
  const char block[] = "> outer\n> > nested\n> >\n> > - item\n> >\n> >   continued\n\n";
  const uint32_t block_len = sizeof(block) - 1, repeats = 500;
  char *text = malloc(block_len * repeats + sizeof("end\n"));
  for (uint32_t i = 0; i < repeats; i++) memcpy(text + i * block_len, block, block_len);
  memcpy(text + block_len * repeats, "end\n", sizeof("end\n"));
  Document *d = tsmd_new(gfm);
  set_ascii(d, text);
  check_sampled_tree(d);
  TSNode section = ts_node_named_child(ts_tree_root_node(d->tree), 0);
  assert(ts_node_child_count(section) == repeats + 1);
  for (uint32_t i = 0; i < repeats; i += 7)
    check_sample(d, section, (i + 1) * block_len - 1);
  put_ascii(d, "\n");
  tsmd_edit(d, block_len * 250, block_len * 250);
  check_sampled_tree(d);
  tsmd_reparse(d);
  check_sampled_tree(d);
  tsmd_free(d);
  free(text);
}

int main(void) {
  const char *fixtures[] = {
    "", "\n", "plain", "one\n\ntwo\n\nthree\n",
    "# Heading\n\nfirst\n\n## Nested\n\nlast\n\n",
    "> quote\n>\n> next\n\ntrailing\n\n",
    "- first\n\n  second\n\n- last\n\n",
    "| a | b |\n| - | - |\n| x | y |\n\nend\n",
    "```js\nconst x = 1;\n```\n\nlast\n",
    "one\r\n\r\ntwo\r\n", "\tcode\n\nparagraph\n",
    "[ref]\n>[ref]:o"
  };
  for (uint32_t gfm = 0; gfm < 2; gfm++) {
    Document *d = tsmd_new(gfm);
    for (uint32_t i = 0; i < sizeof(fixtures) / sizeof(fixtures[0]); i++) {
      set_ascii(d, fixtures[i]); check_tree(d);
      tsmd_reparse(d); check_tree(d);
    }
    set_ascii(d, "[ref]\n>[ref]:o");
    put_ascii(d, "\n"); tsmd_edit(d, 6, 7); check_tree(d);
    put_ascii(d, ">"); tsmd_edit(d, 6, 7); check_tree(d);
    uint16_t unicode[] = {0x05e9, 0x05dc, 0x05d5, 0x05dd, ' ', 0xd83d, 0xde42, '\n', '\n', 'x', '\n'};
    memcpy(tsmd_input(d, sizeof(unicode) / sizeof(unicode[0])), unicode, sizeof(unicode));
    tsmd_set_text(d); check_tree(d); tsmd_reparse(d); check_tree(d);
    tsmd_free(d);
  }
  printf("cursor seek oracle: %" PRIu64 " comparisons, %" PRIu64 " failures\n", checks, failures);
  uint64_t small_checks = checks, small_failures = failures;
  for (uint32_t gfm = 0; gfm < 2; gfm++) check_large_document(gfm);
  printf("large nested cursor oracle: %" PRIu64 " comparisons, %" PRIu64 " failures\n",
         checks - small_checks, failures - small_failures);
  return failures ? 1 : 0;
}
