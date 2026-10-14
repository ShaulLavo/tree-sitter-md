#include "resolver.h"
#include <assert.h>
Document *tsmd_new(uint32_t, const TSLanguage *);
const TSLanguage *tree_sitter_markdown(void);
void tsmd_free(Document *);
uint16_t *tsmd_input(Document *, uint32_t);
void tsmd_set_text(Document *);
void tsmd_edit(Document *, uint32_t, uint32_t);
uint32_t tsmd_decorations(Document *, uint32_t, uint32_t);
uint32_t tsmd_semantics(Document *);
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
  }
}
int main(void) {
  Document *incremental = tsmd_new(13, tree_sitter_markdown()), *fresh = tsmd_new(13, tree_sitter_markdown());
  const char *fixtures[] = {
    "- [ ] pending\n- [x](streamdown:incomplete-link)\n- [x] done",
    "> - first\n>\n> ```js\n> ?\n> ```",
    "a|b|c\n:-|--:|-\nx|![?](image)\n",
    "[^a]: **?**\n\n    - nested\n\n    [^b]: `?`\n\n[^a] [^b]\n",
    "&#xD83D; ? \x7f `?` ![?](x) ?\x01 \x01\n\n```\n?\n```\n\n<div>?</div>\n\n$$\n?\n$$",
    "    first\n    "
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
  }
  tsmd_free(incremental);
  tsmd_free(fresh);
  return 0;
}
