#include "resolver.h"
#include <assert.h>
Document *tsmd_new(uint32_t, const TSLanguage *);
const TSLanguage *tree_sitter_markdown(void);
void tsmd_free(Document *);
uint16_t *tsmd_input(Document *, uint32_t);
void tsmd_set_text(Document *);
void tsmd_edit(Document *, uint32_t, uint32_t);
uint32_t tsmd_decorations(Document *, uint32_t, uint32_t);

static void set(Document *d, const uint16_t *text, uint32_t length) {
  memcpy(tsmd_input(d, length), text, length * sizeof(uint16_t));
  tsmd_set_text(d);
}
int main(void) {
  Document *incremental = tsmd_new(1, tree_sitter_markdown()), *fresh = tsmd_new(1, tree_sitter_markdown());
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
    uint16_t inserted = "*[]~`\\>\n abc:"[seed % 14];
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
  }
  tsmd_free(incremental);
  tsmd_free(fresh);
  return 0;
}
