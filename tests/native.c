#include "resolver.h"
#include <assert.h>
#include <stdio.h>
// The block tree lives in web-tree-sitter, so this test stands in for it with a
// splitter: paragraphs are runs of non-blank lines, a paragraph starting with '#'
// is an ATX heading, and a line starting with two backticks opens or closes a
// fence, which changes blocks far from an edit the way the grammar does. It drives
// the same entry points js/index.js uses and checks that incremental edits agree
// with a fresh document.
Document *tsmd_new(uint32_t);
void tsmd_free(Document *);
uint16_t *tsmd_input(Document *, uint32_t);
uint32_t *tsmd_args(Document *, uint32_t);
void tsmd_set_text(Document *);
void tsmd_edit(Document *, uint32_t, uint32_t);
void tsmd_forget(Document *, uint32_t, uint32_t);
void tsmd_define(Document *);
void tsmd_commit(Document *);
void tsmd_reset(Document *);
void tsmd_leaf(Document *, uint32_t);
uint32_t tsmd_highlights(Document *);

typedef struct {
  uint32_t start, end;
} Block;

static bool blank_line(const uint16_t *text, uint32_t a, uint32_t b) {
  for (uint32_t i = a; i < b; i++)
    if (text[i] != ' ' && text[i] != '\t' && text[i] != '\r' && text[i] != '\n')
      return false;
  return true;
}
static uint32_t split(const uint16_t *text, uint32_t length, Block *out) {
  uint32_t count = 0, at = 0;
  bool open = false, fenced = false;
  while (at < length) {
    uint32_t end = at;
    while (end < length && text[end] != '\n')
      end++;
    if (end < length)
      end++;
    bool fence = end - at >= 2 && text[at] == '`' && text[at + 1] == '`';
    fenced ^= fence;
    if (fence || fenced || blank_line(text, at, end))
      open = false;
    else if (open)
      out[count - 1].end = end;
    else {
      out[count++] = (Block){at, end};
      open = true;
    }
    at = end;
  }
  return count;
}
static uint32_t kind_of(Document *d, Block b) { return d->text[b.start] == '#' ? ATX : PARAGRAPH; }
static void shape(Document *d, Block b, uint32_t at) {
  uint32_t *args = tsmd_args(d, at + 5);
  args[at] = b.start;
  args[at + 1] = b.end;
  args[at + 2] = b.start;
  args[at + 3] = b.end;
  args[at + 4] = 0;
}
static void define(Document *d, const Block *blocks, uint32_t count, uint32_t from, uint32_t to) {
  for (uint32_t i = 0; i < count; i++) {
    Block b = blocks[i];
    if (b.end < from || b.start > to || kind_of(d, b) != PARAGRAPH || d->text[b.start] != '[')
      continue;
    shape(d, b, 0);
    tsmd_define(d);
  }
}
static uint32_t decorate(Document *d, const Block *blocks, uint32_t count) {
  tsmd_reset(d);
  for (uint32_t i = 0; i < count; i++) {
    uint32_t *args = tsmd_args(d, 8);
    args[0] = blocks[i].start;
    args[1] = blocks[i].end;
    args[2] = 0;
    shape(d, blocks[i], 3);
    tsmd_leaf(d, kind_of(d, blocks[i]));
  }
  return d->out.n;
}
static void set(Document *d, const uint16_t *text, uint32_t length, Block *blocks) {
  memcpy(tsmd_input(d, length), text, length * sizeof(uint16_t));
  tsmd_set_text(d);
  define(d, blocks, split(text, length, blocks), 0, length);
  tsmd_commit(d);
}
static bool contains(const Block *blocks, uint32_t count, Block b) {
  for (uint32_t i = 0; i < count; i++)
    if (blocks[i].start == b.start && blocks[i].end == b.end)
      return true;
  return false;
}
static void widen(uint32_t *from, uint32_t *to, Block b) {
  *from = b.start < *from ? b.start : *from;
  *to = b.end > *to ? b.end : *to;
}
// Maps a block of the edited text back to the text before the edit.
static Block unshift(Block b, uint32_t at, uint32_t stop, int64_t delta) {
  if (b.start >= at + (stop - at) + delta && delta)
    return (Block){b.start - delta, b.end - delta};
  return b;
}
static void same(Document *a, Document *b) {
  assert(a->out.n == b->out.n);
  if (a->out.n)
    assert(!memcmp(a->out.v, b->out.v, a->out.n * sizeof(uint32_t)));
}
int main(void) {
  Document *incremental = tsmd_new(1), *fresh = tsmd_new(1);
  static uint16_t text[8192];
  static Block blocks[8192];
  uint32_t length = 0, seed = 7;
  // The first two steps turn "zz" into a fence opener, which must retract the
  // definitions after it although they lie outside the edit.
  const char *source = "[x] **bold** ~~strike~~ `code` www.example.org\n\nzz\n\n[x]: /first\n"
                       "[x]: /second\n\n# Title *em*\n\n[y]: /y\n";
  for (const char *p = source; *p; p++)
    text[length++] = *p;
  set(incremental, text, length, blocks);
  static Block previous[8192];
  uint32_t previous_count = split(text, length, previous);
  const uint16_t alphabet[] = {'*', '[', ']', '~', '`', '`', '\\', '>', '\n', '\n', ' ', 'a', 'b', ':',
                               '/', '#', '<', 0xd83d, 0xde00, 0x5d0};
  for (uint32_t step = 0; step < 4000; step++) {
    seed = seed * 1664525 + 1013904223;
    uint32_t at = seed % (length + 1), stop = at, n = 1;
    uint16_t inserted = alphabet[(seed >> 16) % (sizeof(alphabet) / sizeof(*alphabet))];
    if (step < 2) {
      at = strstr(source, "zz") - source + step;
      stop = at + 1;
      inserted = '`';
    } else if (step % 3 == 0 && at < length) {
      stop++;
      n = 0;
    }
    if (length + n >= 8000)
      n = 0;
    uint16_t *input = tsmd_input(incremental, n);
    if (n)
      input[0] = inserted;
    tsmd_edit(incremental, at, stop);
    memmove(text + at + n, text + stop, (length - stop) * sizeof(uint16_t));
    if (n)
      text[at] = inserted;
    length += n - (stop - at);
    // Stands in for the tree's changed ranges: every block that moved, appeared
    // or disappeared, plus the edit itself.
    uint32_t count = split(text, length, blocks), from = at, to = at + n;
    int64_t delta = (int64_t)n - (stop - at);
    for (uint32_t i = 0; i < previous_count; i++) {
      Block b = previous[i];
      if (b.start >= stop)
        b = (Block){b.start + delta, b.end + delta};
      else if (b.end > at)
        b = (Block){at, at};
      if (!contains(blocks, count, b))
        widen(&from, &to, b);
    }
    for (uint32_t i = 0; i < count; i++) {
      bool touches = blocks[i].end + 1 >= at && blocks[i].start <= at + n + 1;
      if (touches || !contains(previous, previous_count, unshift(blocks[i], at, stop, delta)))
        widen(&from, &to, blocks[i]);
    }
    memcpy(previous, blocks, count * sizeof(Block));
    previous_count = count;
    tsmd_forget(incremental, from, to);
    define(incremental, blocks, count, from, to);
    tsmd_commit(incremental);
    decorate(incremental, blocks, count);
    set(fresh, text, length, blocks);
    decorate(fresh, blocks, count);
    same(incremental, fresh);
    tsmd_highlights(incremental);
    tsmd_highlights(fresh);
    same(incremental, fresh);
  }
  tsmd_free(incremental);
  tsmd_free(fresh);
  printf("ASan + UBSan: 4,000 incremental edits agree with fresh documents\n");
  return 0;
}
